import { expect, test } from "@playwright/test";

/**
 * Authentication journey (CLAUDE.md §20).
 *
 * These assert the gate itself rather than any business feature: an anonymous
 * visitor must never reach a protected screen, and the sign-in failure message
 * must not reveal whether an account exists.
 *
 * Requires a running app. Signed-in journeys arrive with the seeded test fixtures
 * in Phase 2 — asserting them now would mean committing a test account's
 * credentials, which §18.1 forbids.
 */

test.describe("unauthenticated access", () => {
  test("redirects an anonymous visitor from the dashboard to sign-in", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: "TechVault" })).toBeVisible();
  });

  test("preserves the intended destination so sign-in returns there", async ({
    page,
  }) => {
    await page.goto("/admin/users");
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Fusers/);
  });

  test("redirects the root path", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
  });

  test("keeps the health endpoint reachable without a session", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});

test.describe("sign-in form", () => {
  test("gives a uniform error that does not reveal whether the account exists", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel("Email address").fill("nobody@example.com");
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).toHaveText(/not valid/i);
    // Must not distinguish "no such user" from "wrong password" (§11.6).
    await expect(alert).not.toHaveText(/not found|no account|unknown user/i);
  });

  test("is operable by keyboard alone", async ({ page }) => {
    await page.goto("/login");
    // The email field is focused on load, so tabbing reaches password then submit.
    await page.keyboard.type("keyboard@example.com");
    await page.keyboard.press("Tab");
    await page.keyboard.type("some-password");
    await expect(page.getByLabel("Password")).toBeFocused();
  });

  test("labels every input", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
  });
});
