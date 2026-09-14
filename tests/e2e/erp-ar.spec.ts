import { expect, test } from "@playwright/test";

/**
 * ERP accounts receivable critical path (CLAUDE.md §20): sign in → ERP → choose a CRM
 * customer → create an invoice → submit and approve → post → verify its journal →
 * create and post a receipt → allocate it → verify the outstanding balance → view
 * AR aging.
 *
 * Needs a running app against a NON-production database that has:
 *   - a user holding `finance-admin`, given as E2E_EMAIL / E2E_PASSWORD;
 *   - a CRM company whose name contains E2E_CUSTOMER (default "a");
 *   - the seeded starter chart (4100 Sales Revenue, 1110 Cash) and AR defaults;
 *   - an OPEN accounting period containing today's date (Africa/Cairo);
 *   - AR settings that let this one user take the invoice through approval: either
 *     "invoices need approval" off, or "allow self-approval" on.
 *
 * Credentials come from the environment and are never committed (§18.1). Without
 * them the journey is skipped.
 */

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;
const customer = process.env.E2E_CUSTOMER ?? "a";

test.describe("ERP accounts receivable: invoice to cash", () => {
  test.skip(
    email === undefined || email === "" || password === undefined || password === "",
    "Set E2E_EMAIL and E2E_PASSWORD for a finance administrator on a test database.",
  );

  test("invoices a CRM customer, posts, receives payment and ages the balance", async ({
    page,
  }) => {
    await page.goto("/login?next=%2Ferp%2Ffinance%2Finvoices%2Fnew");
    await page.getByLabel("Email address").fill(email ?? "");
    await page.getByLabel("Password").fill(password ?? "");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "New invoice" })).toBeVisible();

    // Choose a CRM customer and price one line.
    await page.getByPlaceholder("Search CRM companies…").fill(customer);
    const option = page.getByRole("option").first();
    await expect(option).toBeVisible();
    const customerName = (await option.textContent())?.trim() ?? "";
    await option.click();
    await page.getByLabel("Line 1 description").fill(`E2E consulting ${Date.now()}`);
    await page.getByLabel("Line 1 quantity").fill("2");
    await page.getByLabel("Line 1 unit price").fill("250.00");
    await page
      .getByLabel("Line 1 revenue account")
      .selectOption({ label: "4100 — Sales Revenue" });
    await page.getByRole("button", { name: "Save draft" }).click();

    // Submit, approve if needed, post.
    await expect(page.getByRole("heading", { name: "Draft invoice" })).toBeVisible();
    await page.getByRole("button", { name: "Submit" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Submit invoice" })
      .click();
    const approve = page.getByRole("button", { name: "Approve" });
    if (await approve.isVisible()) {
      await approve.click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Approve invoice" })
        .click();
    }
    await page.getByRole("button", { name: "Post invoice" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Post invoice" }).click();
    const invoiceHeading = page.getByRole("heading", { name: /^[A-Z0-9]+-\d{4}-\d+$/ });
    await expect(invoiceHeading).toBeVisible();
    await expect(page.getByTestId("invoice-outstanding")).toHaveText("500.00");

    // Its journal entry exists and balances.
    await page.getByRole("link", { name: /^JE-\d{4}-\d{6}$/ }).click();
    await expect(page.getByText("Balanced", { exact: true })).toBeVisible();
    await expect(page.getByText("Customer invoice", { exact: true })).toBeVisible();

    // Receive the money.
    await page.goto("/erp/finance/receipts/new");
    await page.getByPlaceholder("Search CRM companies…").fill(customerName);
    await page.getByRole("option", { name: customerName }).first().click();
    await page.getByLabel("Amount (EGP)").fill("500.00");
    await page.getByLabel("Payment method").selectOption({ label: "Bank transfer" });
    await page
      .getByLabel("Deposited to (bank or cash account)")
      .selectOption({ label: "1110 — Cash" });
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByRole("heading", { name: "Draft receipt" })).toBeVisible();
    await page.getByRole("button", { name: "Post receipt" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Post receipt" }).click();

    // Allocate it to the invoice.
    await page.getByRole("button", { name: "Allocate" }).click();
    const invoiceNumber = (await invoiceHeading.textContent())?.trim() ?? "";
    await page.getByLabel(`Amount for invoice ${invoiceNumber}`).fill("500.00");
    await page.getByRole("dialog").getByRole("button", { name: "Allocate" }).click();
    await expect(page.getByRole("link", { name: invoiceNumber })).toBeVisible();

    // The invoice is paid and nothing is outstanding.
    await page.getByRole("link", { name: invoiceNumber }).click();
    await expect(page.getByTestId("invoice-outstanding")).toHaveText("0.00");
    await expect(page.getByText("Paid", { exact: true }).first()).toBeVisible();

    // Aging renders.
    await page.goto("/erp/finance/aging");
    await expect(page.getByRole("heading", { name: "AR aging" })).toBeVisible();
  });
});
