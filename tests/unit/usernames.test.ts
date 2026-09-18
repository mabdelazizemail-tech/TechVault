import { describe, expect, it } from "vitest";
import {
  SIGN_IN_DOMAIN,
  hasMailbox,
  internalSignInAddress,
  usernameField,
  visibleEmail,
} from "@/platform/iam/usernames";

/** Usernames and the internal sign-in address behind them (ADR-035). */

describe("usernames", () => {
  it("stores a username in lower case, trimmed", () => {
    expect(usernameField.parse("  Amr.Hassan ")).toBe("amr.hassan");
    expect(usernameField.parse("sara_2026")).toBe("sara_2026");
  });

  it("refuses usernames the database would refuse", () => {
    for (const bad of [
      "ab",
      "-amr",
      ".amr",
      "amr hassan",
      "amr@x",
      "a".repeat(33),
      "عمرو",
    ]) {
      expect(usernameField.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("builds an internal address that no mailbox can own", () => {
    expect(SIGN_IN_DOMAIN.endsWith(".internal")).toBe(true);
    expect(internalSignInAddress("Amr")).toBe(`amr@${SIGN_IN_DOMAIN}`);
    expect(hasMailbox(internalSignInAddress("amr"))).toBe(false);
    expect(hasMailbox("amr@techvault-eg.com")).toBe(true);
  });

  it("shows only a real email address", () => {
    expect(visibleEmail("amr@techvault-eg.com")).toBe("amr@techvault-eg.com");
    expect(visibleEmail(internalSignInAddress("amr"))).toBeNull();
  });
});
