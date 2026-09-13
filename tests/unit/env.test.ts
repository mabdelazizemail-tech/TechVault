import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Configuration must fail HARD and EARLY when it is wrong (CLAUDE.md §18.1).
 * Discovering a misconfiguration at startup is cheap; discovering it when a user
 * hits the feature is not.
 */

const VALID_ENV: Record<string, string> = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/techvault",
  APP_URL: "http://localhost:3000",
  APP_ENV: "development",
  NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
};

const ALL_KEYS = [
  ...Object.keys(VALID_ENV),
  "DIRECT_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "STORAGE_BUCKET",
  "LOG_LEVEL",
];

let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  originalEnv = { ...process.env };
  vi.resetModules();
});

afterEach(() => {
  process.env = originalEnv;
});

function setEnv(values: Record<string, string | undefined>): void {
  for (const key of ALL_KEYS) delete process.env[key];
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
    expect(env.databaseUrl).toBe(VALID_ENV.DATABASE_URL);
    expect(env.appEnv).toBe("development");
  });

  it("applies documented defaults", async () => {
    setEnv(VALID_ENV);
    const { serverEnv } = await import("@/platform/config/env");
    const env = serverEnv();
    expect(env.logLevel).toBe("info");
    expect(env.storageBucket).toBe("techvault-documents");
  });

  it("throws when a required variable is missing", async () => {
    setEnv({ ...VALID_ENV, DATABASE_URL: undefined });
    const { serverEnv } = await import("@/platform/config/env");
    expect(() => serverEnv()).toThrow(/DATABASE_URL/);
  });

  it("rejects an APP_URL that is not an absolute URL", async () => {
    // URL.canParse("localhost:3000") is true — it reads "localhost" as the
    // scheme — so the validator must check the protocol explicitly.
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

  describe("the privileged Supabase key", () => {
    it("is optional, because nothing uses it yet", async () => {
      // Requiring a credential we do not need pushes people into pasting the most
      // dangerous secret in the project into every environment (§18.1).
      setEnv(VALID_ENV);
      const { serverEnv } = await import("@/platform/config/env");
      expect(serverEnv().supabaseSecretKey).toBeNull();
    });

    it("is exposed when the current key name is set", async () => {
      setEnv({ ...VALID_ENV, SUPABASE_SECRET_KEY: "sb_secret_x" });
      const { serverEnv } = await import("@/platform/config/env");
      expect(serverEnv().supabaseSecretKey).toBe("sb_secret_x");
    });

    it("falls back to the legacy service-role name", async () => {
      setEnv({ ...VALID_ENV, SUPABASE_SERVICE_ROLE_KEY: "legacy-jwt" });
      const { serverEnv } = await import("@/platform/config/env");
      expect(serverEnv().supabaseSecretKey).toBe("legacy-jwt");
    });
  });
});

describe("publicEnv", () => {
  it("validates the browser-safe variables", async () => {
    setEnv(VALID_ENV);
    const { publicEnv } = await import("@/platform/config/env");
    expect(publicEnv().supabaseUrl).toBe(VALID_ENV.NEXT_PUBLIC_SUPABASE_URL);
  });

  it("throws when the Supabase URL is absent", async () => {
    setEnv({ ...VALID_ENV, NEXT_PUBLIC_SUPABASE_URL: undefined });
    const { publicEnv } = await import("@/platform/config/env");
    expect(() => publicEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  describe("client key generations", () => {
    it("accepts the current publishable key", async () => {
      setEnv(VALID_ENV);
      const { publicEnv } = await import("@/platform/config/env");
      expect(publicEnv().supabaseKey).toBe("sb_publishable_test");
    });

    it("accepts a legacy anon key", async () => {
      setEnv({
        ...VALID_ENV,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "legacy-anon-jwt",
      });
      const { publicEnv } = await import("@/platform/config/env");
      expect(publicEnv().supabaseKey).toBe("legacy-anon-jwt");
    });

    it("prefers the publishable key when both are set", async () => {
      setEnv({ ...VALID_ENV, NEXT_PUBLIC_SUPABASE_ANON_KEY: "legacy-anon-jwt" });
      const { publicEnv } = await import("@/platform/config/env");
      expect(publicEnv().supabaseKey).toBe("sb_publishable_test");
    });

    it("throws when neither key generation is configured", async () => {
      setEnv({ ...VALID_ENV, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined });
      const { publicEnv } = await import("@/platform/config/env");
      expect(() => publicEnv()).toThrow(/PUBLISHABLE_KEY|ANON_KEY/);
    });
  });
});
