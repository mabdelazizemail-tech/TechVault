import { describe, expect, it } from "vitest";
import { sessionAccess } from "@/platform/auth/access";
import { changeOwnPasswordInput } from "@/platform/iam/services/password-service";
import { setUserPasswordInput } from "@/platform/iam/services/user-admin-service";

/**
 * The rules behind passwords (ADR-034): what a session may do, and what a password
 * change must satisfy before Supabase Auth is ever asked.
 */

describe("session access", () => {
  const live = { isActive: true, deletedAt: null, mustChangePassword: false };

  it("allows normal use for an active account", () => {
    expect(sessionAccess(live)).toBe("full");
  });

  it("holds an account with a temporary password to changing it", () => {
    expect(sessionAccess({ ...live, mustChangePassword: true })).toBe("password-change");
  });

  it("disables a missing, inactive or deleted account whatever else is set", () => {
    expect(sessionAccess(null)).toBe("disabled");
    expect(sessionAccess({ ...live, isActive: false })).toBe("disabled");
    expect(sessionAccess({ ...live, deletedAt: new Date() })).toBe("disabled");
    expect(sessionAccess({ ...live, isActive: false, mustChangePassword: true })).toBe(
      "disabled",
    );
  });
});

describe("changing one's own password", () => {
  const valid = {
    currentPassword: "old-password-1",
    newPassword: "a-new-long-passphrase",
    confirmPassword: "a-new-long-passphrase",
  };

  it("accepts a new password of 12 to 72 characters, confirmed", () => {
    expect(changeOwnPasswordInput.safeParse(valid).success).toBe(true);
  });

  it("refuses a short, over-long, unconfirmed or unchanged password", () => {
    const refused = (patch: Record<string, string>) =>
      changeOwnPasswordInput.safeParse({ ...valid, ...patch }).success;
    expect(refused({ newPassword: "short", confirmPassword: "short" })).toBe(false);
    expect(
      refused({ newPassword: "x".repeat(73), confirmPassword: "x".repeat(73) }),
    ).toBe(false);
    expect(refused({ confirmPassword: "something-else-entirely" })).toBe(false);
    expect(
      refused({
        currentPassword: "a-new-long-passphrase",
      }),
    ).toBe(false);
    expect(refused({ currentPassword: "" })).toBe(false);
  });
});

describe("an administrator's temporary password", () => {
  it("must be at least 12 characters and confirmed", () => {
    expect(
      setUserPasswordInput.safeParse({
        password: "temporary-123",
        confirmPassword: "temporary-123",
      }).success,
    ).toBe(true);
    expect(
      setUserPasswordInput.safeParse({ password: "short", confirmPassword: "short" })
        .success,
    ).toBe(false);
    expect(
      setUserPasswordInput.safeParse({
        password: "temporary-123",
        confirmPassword: "temporary-124",
      }).success,
    ).toBe(false);
  });
});
