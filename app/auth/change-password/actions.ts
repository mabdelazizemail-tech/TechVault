"use server";

import { redirect } from "next/navigation";
import { isAppError, ValidationError } from "@/lib/errors";
import { getPasswordChangeActor } from "@/platform/auth/current-user";
import { createServerSupabaseClient } from "@/platform/auth/supabase/server";
import { changeOwnPassword } from "@/platform/iam/services/password-service";
import { logger, newCorrelationId } from "@/platform/observability/logger";

/**
 * Changing one's own password (ADR-034). The service proves the current password
 * with Supabase Auth; this action only translates the outcome. It is the one action
 * an account holding a temporary password may call — which is why it builds its
 * actor with `getPasswordChangeActor` rather than `getActor`.
 */

/** Only failures come back: success ends the session and redirects to sign-in. */
export type ChangePasswordResult = {
  ok: false;
  message: string;
  fieldErrors?: Record<string, string[]>;
};

export async function changeOwnPasswordAction(
  input: unknown,
): Promise<ChangePasswordResult> {
  try {
    await changeOwnPassword(await getPasswordChangeActor(), input);
  } catch (error) {
    if (isAppError(error)) {
      return {
        ok: false,
        message: error.message,
        ...(error instanceof ValidationError && Object.keys(error.fieldErrors).length > 0
          ? { fieldErrors: error.fieldErrors }
          : {}),
      };
    }
    const traceId = newCorrelationId();
    logger.error("Password change failed", {
      module: "iam",
      operation: "iam.user.passwordChange",
      traceId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      message: `Your password could not be changed. Reference: ${traceId}`,
    };
  }

  // Every session of the account was ended at the sign-in service; this clears the
  // cookies in this browser too, then the sign-in page explains what happened.
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login?reason=password-changed");
}
