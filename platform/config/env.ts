import { z } from "zod";

/**
 * Validated environment configuration (CLAUDE.md §18.1, §23).
 *
 * A missing or malformed required variable is a HARD failure at boot — never a
 * silent default. Discovering a misconfiguration at startup is cheap;
 * discovering it when a user hits the feature is not.
 *
 * Modules must import `serverEnv` / `publicEnv` from here rather than reading
 * `process.env` directly, so every variable has exactly one validated definition.
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

/** Variables that are safe to expose to the browser. */
const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: urlString("NEXT_PUBLIC_SUPABASE_URL"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

/** Server-only variables. Never reference these from a Client Component. */
const serverSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  APP_URL: urlString("APP_URL"),
  APP_ENV: z.enum(["development", "preview", "production"]).default("development"),
  STORAGE_BUCKET: z.string().min(1).default("techvault-documents"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type PublicEnv = z.infer<typeof publicSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

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
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
  if (!parsed.success) fail("public", parsed.error);
  return parsed.data;
}

function readServerEnv(): ServerEnv {
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) fail("server", parsed.error);
  return parsed.data;
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
  return serverEnv().APP_ENV === "production";
}
