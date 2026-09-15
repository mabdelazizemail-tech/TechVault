import { expect, test } from "@playwright/test";

/**
 * ERP finance critical path (CLAUDE.md §20): sign in → finance → chart of accounts →
 * create a journal entry → balance it → post it → view it → reverse it.
 *
 * Needs a running app against a NON-production database that has:
 *   - a user holding the `finance-admin` role;
 *   - the seeded starter chart (accounts 1110 Cash and 1120 Bank);
 *   - an OPEN accounting period containing today's date (Africa/Cairo);
 *   - finance settings that allow people to post entries they created (ADR-027),
 *     because the journey posts its own entry.
 *
 * The user's credentials come from the environment — E2E_EMAIL and E2E_PASSWORD, in
 * .env.local or the CI secret store — and are never committed (§18.1). Without them
 * the journey is skipped rather than failed.
 */

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.describe("ERP finance: journal lifecycle", () => {
  test.skip(
    email === undefined || email === "" || password === undefined || password === "",
    "Set E2E_EMAIL and E2E_PASSWORD for a finance administrator on a test database.",
  );

  test("creates, balances, posts, views and reverses a journal entry", async ({
    page,
  }) => {
    await page.goto("/login?next=%2Ferp%2Ffinance");
    await page.getByLabel("Email address").fill(email ?? "");
    await page.getByLabel("Password").fill(password ?? "");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(
      page.getByRole("heading", { name: "Finance", exact: true }),
    ).toBeVisible();

    // Chart of accounts.
    await page.goto("/erp/finance/accounts");
    await expect(page.getByRole("heading", { name: "Chart of accounts" })).toBeVisible();
    await expect(page.getByRole("link", { name: "1110" })).toBeVisible();

    // Create a journal entry and balance it.
    await page.goto("/erp/finance/journals/new");
    const description = `E2E office supplies ${Date.now()}`;
    await page.getByLabel("Description", { exact: true }).fill(description);
    await page.getByLabel("Line 1 account").selectOption({ label: "1110 — Cash" });
    await page.getByLabel("Line 1 debit").fill("500.00");
    await page.getByLabel("Line 2 account").selectOption({ label: "1120 — Bank" });
    await page.getByLabel("Line 2 credit").fill("400.00");
    await expect(page.getByText("Out of balance by 100.00")).toBeVisible();
    await page.getByLabel("Line 2 credit").fill("500.00");
    await expect(page.getByText("Balanced", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Save as draft" }).click();

    // Post it.
    await expect(
      page.getByRole("heading", { name: "Draft journal entry" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Post entry" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Post entry" }).click();
    const postedHeading = page.getByRole("heading", { name: /^JE-\d{4}-\d{6}$/ });
    await expect(postedHeading).toBeVisible();
    const postedNumber = (await postedHeading.textContent())?.trim() ?? "";
    await expect(page.getByText("Posted", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit draft" })).toHaveCount(0);

    // Reverse it.
    await page.getByRole("button", { name: "Reverse entry" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Reverse entry" }).click();
    await expect(page.getByRole("link", { name: postedNumber })).toBeVisible();
    await expect(page.getByText("Reverses", { exact: true })).toBeVisible();

    // The original now reads as reversed.
    await page.getByRole("link", { name: postedNumber }).click();
    await expect(page.getByText("Reversed", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Reverse entry" })).toHaveCount(0);
  });
});
