import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Configuration must fail HARD and EARLY when it is wrong (CLAUDE.md §18.1).
 * Discovering a misconfiguration at startup is cheap; discovering it when a user
 * hits the feature is not.
 */

const VALID_ENV = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/techvault",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  APP_URL: "http://localhost:3000",
  APP_ENV: "development",
  NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
};

let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  originalEnv = { ...process.env };
  vi.resetModules();
});

afterEach(() => {
  process.env = originalEnv;
});

function setEnv(values: Record<string, string | undefined>): void {
  for (const key of Object.keys(VALID_ENV)) delete process.env[key];
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe("serverEnv", () => {
  it("returns validated configuration when everything is present", async () => {
    setEnv(VALID_ENV);
    const { serverEnv } = await import("@/platform/config/env");
    const env = serverEnv();
    expect(env.DATABASE_URL).toBe(VALID_ENV.DATABASE_URL);
    expect(env.APP_ENV).toBe("development");
  });

  it("applies documented defaults", async () => {
    setEnv(VALID_ENV);
    const { serverEnv } = await import("@/platform/config/env");
    const env = serverEnv();
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.STORAGE_BUCKET).toBe("techvault-documents");
  });

  it("throws when a required variable is missing", async () => {
    setEnv({ ...VALID_ENV, DATABASE_URL: undefined });
    const { serverEnv } = await import("@/platform/config/env");
    expect(() => serverEnv()).toThrow(/DATABASE_URL/);
  });

  it("throws when the service role key is missing", async () => {
    setEnv({ ...VALID_ENV, SUPABASE_SERVICE_ROLE_KEY: undefined });
    const { serverEnv } = await import("@/platform/config/env");
    expect(() => serverEnv()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("rejects an APP_URL that is not an absolute URL", async () => {
    setEnv({ ...VALID_ENV, APP_URL: "localhost:3000" });
    const { serverEnv } = await import("@/platform/config/env");
    expect(() => serverEnv()).toThrow(/APP_URL/);
  });

  it("rejects an unknown APP_ENV rather than guessing", async () => {
    setEnv({ ...VALID_ENV, APP_ENV: "staging" });
    const { serverEnv } = await import("@/platform/config/env");
    expect(() => serverEnv()).toThrow(/APP_ENV/);
  });

  it("never includes a variable's value in the error message", async () => {
    // An env error message is a prime accidental-secret-disclosure route.
    setEnv({ ...VALID_ENV, APP_URL: "not-a-url-but-secret-looking-hunter2" });
    const { serverEnv } = await import("@/platform/config/env");
    try {
      serverEnv();
      expect.unreachable("serverEnv should have thrown");
    } catch (error) {
      expect(String(error)).not.toContain("hunter2");
    }
  });
});

describe("publicEnv", () => {
  it("validates the browser-safe variables", async () => {
    setEnv(VALID_ENV);
    const { publicEnv } = await import("@/platform/config/env");
    expect(publicEnv().NEXT_PUBLIC_SUPABASE_URL).toBe(VALID_ENV.NEXT_PUBLIC_SUPABASE_URL);
  });

  it("throws when the Supabase URL is absent", async () => {
    setEnv({ ...VALID_ENV, NEXT_PUBLIC_SUPABASE_URL: undefined });
    const { publicEnv } = await import("@/platform/config/env");
    expect(() => publicEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });
});
