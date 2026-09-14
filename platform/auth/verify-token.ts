import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/platform/observability/logger";

/**
 * Local verification of the Supabase session token (ADR-018).
 *
 * `proxy.ts` verifies every request's session with the Auth server (`getUser`),
 * which also catches revoked sessions. A render then only needs to know that
 * the token it reads is genuine and unexpired, so it verifies the signature
 * against the project's public keys instead of making a second Auth round trip.
 */

type AuthClient = Pick<SupabaseClient["auth"], "getClaims">;

/** The JSON Web Key Set shape `getClaims` accepts. */
export type Jwks = NonNullable<
  NonNullable<Parameters<AuthClient["getClaims"]>[1]>["jwks"]
>;

const JWKS_TTL_MS = 10 * 60 * 1000;

let cachedKeys: { jwks: Jwks; fetchedAt: number } | null = null;

/**
 * The project's public signing keys, cached per process.
 *
 * `getClaims` caches keys on the client object, but a new client is created
 * for every request, so without this each render would fetch them again. The
 * keys are public, so sharing them across requests and users exposes nothing.
 * Returns `undefined` on failure, in which case `getClaims` fetches them itself.
 */
export async function signingKeys(supabaseUrl: string): Promise<Jwks | undefined> {
  const now = Date.now();
  if (cachedKeys !== null && now - cachedKeys.fetchedAt < JWKS_TTL_MS) {
    return cachedKeys.jwks;
  }

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/.well-known/jwks.json`, {
      cache: "no-store",
    });
    if (!response.ok) return undefined;

    const body: unknown = await response.json();
    if (!isJwks(body)) return undefined;

    cachedKeys = { jwks: body, fetchedAt: now };
    return body;
  } catch (error) {
    // Not fatal: getClaims falls back to fetching the keys itself.
    logger.warn("Could not load Supabase signing keys", {
      module: "iam",
      operation: "auth.signingKeys",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

function isJwks(value: unknown): value is Jwks {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { keys?: unknown }).keys)
  );
}

/**
 * The verified user id from the current session token, or `null`.
 *
 * `getClaims` rejects an expired token and verifies an asymmetric signature
 * locally; for a symmetric (HS*) token it asks the Auth server instead, so this
 * never trusts an unverified cookie.
 */
export async function verifiedUserId(
  auth: AuthClient,
  jwks: Jwks | undefined,
): Promise<string | null> {
  const { data, error } = await auth.getClaims(
    undefined,
    jwks === undefined ? undefined : { jwks },
  );
  if (error !== null || data === null) return null;

  const subject = data.claims.sub;
  return typeof subject === "string" && subject !== "" ? subject : null;
}
