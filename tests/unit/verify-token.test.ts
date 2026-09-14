import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { type Jwks, verifiedUserId } from "../../platform/auth/verify-token";

/**
 * Negative tests for local session verification (ADR-018): the render must
 * only accept a token that is signed by the project's key and unexpired. Real
 * ES256 tokens go through the real Supabase `getClaims`; no network is used,
 * because the key set is supplied.
 */

const KID = "test-key";
const USER_ID = "7f3d2a9e-1b4c-4e8a-9d6f-2c5b8a1e0f47";

type AuthClient = Pick<SupabaseClient["auth"], "getClaims">;

const encode = (data: string | Uint8Array) => Buffer.from(data).toString("base64url");

async function generateKeys() {
  return crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
}

async function signToken(privateKey: CryptoKey, payload: Record<string, unknown>) {
  const input = `${encode(JSON.stringify({ alg: "ES256", typ: "JWT", kid: KID }))}.${encode(JSON.stringify(payload))}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(input),
  );
  return `${input}.${encode(new Uint8Array(signature))}`;
}

const inOneHour = () => Math.floor(Date.now() / 1000) + 3600;

describe("verifiedUserId", () => {
  const client = createClient("http://127.0.0.1:1", "test-publishable-key", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  /** Routes the session lookup to a fixed token, as the cookie would. */
  const authWith = (token: string): AuthClient => ({
    getClaims: (_jwt, options) => client.auth.getClaims(token, options),
  });

  let projectKeys: CryptoKeyPair;
  let jwks: Jwks;

  beforeAll(async () => {
    projectKeys = await generateKeys();
    const publicJwk = await crypto.subtle.exportKey("jwk", projectKeys.publicKey);
    jwks = { keys: [{ ...publicJwk, kid: KID, alg: "ES256" }] } as Jwks;
  });

  it("accepts a token signed by the project key", async () => {
    const token = await signToken(projectKeys.privateKey, {
      sub: USER_ID,
      exp: inOneHour(),
    });
    await expect(verifiedUserId(authWith(token), jwks)).resolves.toBe(USER_ID);
  });

  it("rejects a token signed by another key under the same key id", async () => {
    const attacker = await generateKeys();
    const token = await signToken(attacker.privateKey, {
      sub: USER_ID,
      exp: inOneHour(),
    });
    await expect(verifiedUserId(authWith(token), jwks)).resolves.toBeNull();
  });

  it("rejects a token whose payload was altered after signing", async () => {
    const token = await signToken(projectKeys.privateKey, {
      sub: USER_ID,
      exp: inOneHour(),
    });
    const [header, , signature] = token.split(".");
    const forgedPayload = encode(
      JSON.stringify({ sub: "00000000-0000-4000-8000-000000000000", exp: inOneHour() }),
    );
    await expect(
      verifiedUserId(authWith(`${header}.${forgedPayload}.${signature}`), jwks),
    ).resolves.toBeNull();
  });

  it("rejects an expired token", async () => {
    const token = await signToken(projectKeys.privateKey, {
      sub: USER_ID,
      exp: Math.floor(Date.now() / 1000) - 60,
    });
    await expect(verifiedUserId(authWith(token), jwks)).resolves.toBeNull();
  });

  it("rejects a genuine token that names no user", async () => {
    const token = await signToken(projectKeys.privateKey, { exp: inOneHour() });
    await expect(verifiedUserId(authWith(token), jwks)).resolves.toBeNull();
  });

  it("returns null when there is no session", async () => {
    const noSession: AuthClient = {
      getClaims: async () => ({ data: null, error: null }),
    };
    await expect(verifiedUserId(noSession, jwks)).resolves.toBeNull();
  });
});
