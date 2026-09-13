import { z } from "zod";

/**
 * Validated environment configuration (CLAUDE.md §18.1, §23).
 *
 * A missing or malformed required variable is a HARD failure at boot — never a
 * silent default. Discovering a misconfiguration at startup is cheap; discovering
 * it when a user hits the feature is not.
 *
 * Modules must import `serverEnv` / `publicEnv` from here rather than reading
 * `process.env` directly, so every variable has exactly one validated definition.
 * Consumers receive semantic names (`supabaseUrl`, `supabaseKey`) rather than the
 * raw variable names, so a provider rename touches this file alone.
 */

/**
 * `URL.canParse` is not enough on its own: it accepts "localhost:3000", reading
 * "localhost" as the scheme. An absolute http(s) URL is what callers need, so
 * check the protocol explicitly.
 */
function isHttpUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:";
}

const urlString = (field: string) =>
  z
    .string()
    .min(1, `${field} is required`)
    .refine(isHttpUrl, `${field} must be an absolute http(s) URL`);

const secret = z.string().min(1).optional();

/**
 * Browser-safe variables.
 *
 * Supabase issues two generations of client key: the current
 * `sb_publishable_…` (NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) and the legacy JWT
 * anon key (NEXT_PUBLIC_SUPABASE_ANON_KEY). Both are accepted because both are
 * still in circulation and Supabase's own templates disagree; the publishable key
 * wins when both are set.
 */
const publicSchema = z
  .object({
    NEXT_PUBLIC_SUPABASE_URL: urlString("NEXT_PUBLIC_SUPABASE_URL"),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: secret,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: secret,
  })
  .refine(
    (values) =>
      values.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY !== undefined ||
      values.NEXT_PUBLIC_SUPABASE_ANON_KEY !== undefined,
    {
      error:
        "Set NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (preferred) or " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY (legacy projects).",
      path: ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"],
    },
  );

/** Server-only variables. Never reference these from a Client Component. */
const serverSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1).optional(),
  APP_URL: urlString("APP_URL"),
  APP_ENV: z.enum(["development", "preview", "production"]).default("development"),
  STORAGE_BUCKET: z.string().min(1).default("techvault-documents"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  /**
   * The privileged key that bypasses every policy. OPTIONAL, and deliberately so:
   * nothing in TechVault uses it today, and requiring a credential we do not need
   * would push people into pasting the most dangerous secret in the project into
   * every environment "because the app asked for it" (CLAUDE.md §18.1).
   *
   * Make it required only in the change that genuinely needs it — admin user
   * provisioning is the likely first caller — and say so here.
   */
  SUPABASE_SECRET_KEY: secret,
  SUPABASE_SERVICE_ROLE_KEY: secret,
});

/** What consumers get. Semantic names, not environment-variable names. */
export type PublicEnv = {
  supabaseUrl: string;
  supabaseKey: string;
};

export type ServerEnv = {
  databaseUrl: string;
  directUrl: string | null;
  appUrl: string;
  appEnv: "development" | "preview" | "production";
  storageBucket: string;
  logLevel: "debug" | "info" | "warn" | "error";
  /** Null when not configured — which is the normal case today. */
  supabaseSecretKey: string | null;
};

function fail(scope: string, error: z.ZodError): never {
  // Report WHICH variables are wrong, never their values — an env error message
  // is a prime accidental-secret-disclosure route.
  const fields = error.issues
    .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
  throw new Error(
    `Invalid ${scope} environment configuration:\n${fields}\n\n` +
      `See .env.local.example for the full list of required variables.`,
  );
}

/**
 * Next.js inlines `process.env.NEXT_PUBLIC_*` at build time only for statically
 * analysable member expressions, so these must be written out literally rather
 * than looped over.
 */
function readPublicEnv(): PublicEnv {
  const parsed = publicSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
  if (!parsed.success) fail("public", parsed.error);

  const key =
    parsed.data.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    parsed.data.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // The refinement above guarantees one is present; this satisfies the type
  // checker without an assertion.
  if (key === undefined) {
    throw new Error("Supabase client key missing after validation.");
  }

  return { supabaseUrl: parsed.data.NEXT_PUBLIC_SUPABASE_URL, supabaseKey: key };
}

function readServerEnv(): ServerEnv {
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) fail("server", parsed.error);

  return {
    databaseUrl: parsed.data.DATABASE_URL,
    directUrl: parsed.data.DIRECT_URL ?? null,
    appUrl: parsed.data.APP_URL,
    appEnv: parsed.data.APP_ENV,
    storageBucket: parsed.data.STORAGE_BUCKET,
    logLevel: parsed.data.LOG_LEVEL,
    supabaseSecretKey:
      parsed.data.SUPABASE_SECRET_KEY ?? parsed.data.SUPABASE_SERVICE_ROLE_KEY ?? null,
  };
}

let cachedPublic: PublicEnv | undefined;
let cachedServer: ServerEnv | undefined;

export function publicEnv(): PublicEnv {
  cachedPublic ??= readPublicEnv();
  return cachedPublic;
}

export function serverEnv(): ServerEnv {
  if (typeof window !== "undefined") {
    throw new Error(
      "serverEnv() was called in the browser. Server-only configuration must " +
        "never reach a client bundle — move this call to a Server Component, " +
        "Server Action, or route handler.",
    );
  }
  cachedServer ??= readServerEnv();
  return cachedServer;
}

export function isProduction(): boolean {
  return serverEnv().appEnv === "production";
}
