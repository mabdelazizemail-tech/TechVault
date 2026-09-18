import { createClient } from "@supabase/supabase-js";
import {
  type AppError,
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { publicEnv, serverEnv } from "@/platform/config/env";
import { logger } from "@/platform/observability/logger";

/**
 * Privileged operations on Supabase Auth accounts (CLAUDE.md §11.1, ADR-019).
 *
 * The only code in TechVault that uses the Supabase secret key. It runs on the
 * server only: the key comes from server configuration (never a `NEXT_PUBLIC_`
 * variable) and a client is built per call, so no privileged client lives in
 * shared state. Nothing here authorises anything — the callers are IAM services
 * that have already checked the administrator's permissions. Provider errors are
 * logged with their code and converted into typed, user-safe errors; a raw
 * provider message never reaches the browser.
 */

const NOT_CONFIGURED =
  "Account administration is not configured on this server. Add SUPABASE_SECRET_KEY " +
  "to the server environment to create, re-address or delete sign-in accounts.";

/** Long enough to be permanent; lifted with "none" when the account is reactivated. */
const PERMANENT_BAN = "876000h";

/** Whether the secret key is present, so the UI can explain what is unavailable. */
export function isAccountAdminConfigured(): boolean {
  return serverEnv().supabaseSecretKey !== null;
}

function adminApi() {
  if (typeof window !== "undefined") {
    throw new Error("Supabase account administration must never run in the browser.");
  }
  const secretKey = serverEnv().supabaseSecretKey;
  if (secretKey === null) throw new BusinessRuleError(NOT_CONFIGURED);

  return createClient(publicEnv().supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }).auth.admin;
}

type ProviderError = { message: string; code?: string; status?: number };

function safeError(operation: string, error: ProviderError): AppError {
  logger.error("Supabase Auth operation failed", {
    module: "iam",
    operation,
    errorCode: error.code ?? null,
    httpStatus: error.status ?? null,
    errorMessage: error.message,
  });

  switch (error.code) {
    case "email_exists":
    case "user_already_exists":
      return new ConflictError(
        "A sign-in account with this email address already exists.",
      );
    case "weak_password":
      return new ValidationError("That password is too weak.", {
        "setup.password": ["Choose a longer password that is harder to guess."],
      });
    case "email_address_invalid":
      return new ValidationError("Enter a valid email address.", {
        email: ["Enter a valid email address."],
      });
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return new BusinessRuleError(
        "The sign-in service's email limit has been reached. Wait a while, then try again.",
      );
    case "user_not_found":
      return new NotFoundError("sign-in account");
    default:
      return new BusinessRuleError(
        "The sign-in service could not complete this request. Try again shortly.",
      );
  }
}

/** Where emailed invitation and reset links land. Must be in Supabase's redirect allow list. */
function setPasswordUrl(): string {
  return new URL("/auth/set-password", serverEnv().appUrl).toString();
}

export type NewAccount = {
  email: string;
  fullName: string;
  /** "invite" emails a link to choose a password; "password" sets a temporary one. */
  method: "invite" | "password";
  password?: string;
};

export async function createAccount(input: NewAccount): Promise<{ id: string }> {
  const admin = adminApi();
  const metadata = { full_name: input.fullName };

  const { data, error } =
    input.method === "invite"
      ? await admin.inviteUserByEmail(input.email, {
          data: metadata,
          redirectTo: setPasswordUrl(),
        })
      : await admin.createUser({
          email: input.email,
          password: input.password,
          email_confirm: true,
          user_metadata: metadata,
        });

  if (error !== null) throw safeError("auth.admin.createAccount", error);
  return { id: data.user.id };
}

export async function updateAccountEmail(id: string, email: string): Promise<void> {
  const { error } = await adminApi().updateUserById(id, { email, email_confirm: true });
  if (error !== null) throw safeError("auth.admin.updateEmail", error);
}

/** A banned account cannot sign in or refresh its session at the provider. */
export async function setAccountBanned(id: string, banned: boolean): Promise<void> {
  const { error } = await adminApi().updateUserById(id, {
    ban_duration: banned ? PERMANENT_BAN : "none",
  });
  if (error !== null) throw safeError("auth.admin.setBanned", error);
}

export async function deleteAccount(id: string): Promise<void> {
  const { error } = await adminApi().deleteUser(id);
  // An account that is already gone is the outcome we wanted.
  if (error !== null && error.code !== "user_not_found" && error.status !== 404) {
    throw safeError("auth.admin.deleteAccount", error);
  }
}

/**
 * Gives an account a temporary password chosen by an administrator. The caller
 * has already marked the account as needing a new password, so the holder cannot
 * use the app with it beyond choosing their own (ADR-034).
 */
export async function setAccountPassword(id: string, password: string): Promise<void> {
  const { error } = await adminApi().updateUserById(id, { password });
  if (error === null) return;
  if (error.code === "weak_password") {
    throw new ValidationError("That password is too weak.", {
      password: ["Choose a longer password that is harder to guess."],
    });
  }
  throw safeError("auth.admin.setPassword", error);
}

/**
 * Changes an account holder's own password, proving they know the current one.
 *
 * Needs only the publishable key. A throwaway client signs in with the current
 * password — the proof — and sets the new one on that fresh session, which also
 * satisfies Supabase's "recent sign-in" rule for password changes. Every session of
 * the account is then ended, the browser's included, so a stolen session cannot
 * outlive the change; the holder signs in again with the new password.
 */
export async function changePasswordWithCurrent(
  email: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const env = publicEnv();
  const client = createClient(env.supabaseUrl, env.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const signIn = await client.auth.signInWithPassword({
    email,
    password: currentPassword,
  });
  if (signIn.error !== null) {
    if (signIn.error.code === "invalid_credentials") {
      throw new ValidationError("Your current password is not correct.", {
        currentPassword: ["This is not your current password."],
      });
    }
    if (signIn.error.code === "over_request_rate_limit" || signIn.error.status === 429) {
      throw new BusinessRuleError(
        "Too many attempts. Wait a few minutes, then try again.",
      );
    }
    throw safeError("auth.changePassword.verify", signIn.error);
  }

  const update = await client.auth.updateUser({ password: newPassword });
  if (update.error !== null) {
    // The proof session must not linger when the change fails.
    await client.auth.signOut({ scope: "local" });
    if (update.error.code === "weak_password") {
      throw new ValidationError("That password is too weak.", {
        newPassword: ["Choose a longer password that is harder to guess."],
      });
    }
    if (update.error.code === "same_password") {
      throw new ValidationError("Choose a different password.", {
        newPassword: ["Choose a password you have not used for this account before."],
      });
    }
    throw safeError("auth.changePassword.update", update.error);
  }

  const signOut = await client.auth.signOut({ scope: "global" });
  if (signOut.error !== null) {
    // The password has changed; failing to end the other sessions is logged, not
    // fatal — the holder is signed out of this browser either way.
    logger.warn("Could not end every session after a password change", {
      module: "iam",
      operation: "auth.changePassword.signOut",
      errorCode: signOut.error.code ?? null,
    });
  }
}

/**
 * Sends Supabase's standard password-reset email. Needs only the publishable key.
 *
 * Implicit flow: the link is opened by the account holder, often on another
 * device, so a PKCE verifier stored for whoever requested the reset would never
 * match.
 */
export async function sendPasswordReset(email: string): Promise<void> {
  const env = publicEnv();
  const client = createClient(env.supabaseUrl, env.supabaseKey, {
    auth: {
      flowType: "implicit",
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const { error } = await client.auth.resetPasswordForEmail(email, {
    redirectTo: setPasswordUrl(),
  });
  if (error !== null) throw safeError("auth.passwordReset", error);
}
