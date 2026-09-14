"use server";

import { revalidatePath } from "next/cache";
import { isAppError, ValidationError } from "@/lib/errors";
import type { Actor } from "@/platform/authz/authz";
import { getActor } from "@/platform/auth/current-user";
import { logger, newCorrelationId } from "@/platform/observability/logger";
import * as erp from "../contracts/service";
import type { CustomerRef, OpenInvoiceOption } from "../contracts/types";
import type { ActionResult } from "./actions";

/**
 * Accounts receivable Server Actions (CLAUDE.md §9): authenticate, delegate to the
 * AR services — which authorise, validate, price and enforce every rule — and turn
 * the outcome into something a form can show. Nothing here decides anything.
 */

async function run<T>(
  operation: string,
  work: (actor: Actor) => Promise<T>,
  options: { revalidate?: boolean } = {},
): Promise<ActionResult<T>> {
  try {
    const actor = await getActor();
    const data = await work(actor);
    if (options.revalidate !== false) revalidatePath("/erp", "layout");
    return { ok: true, data };
  } catch (error) {
    if (isAppError(error)) {
      return {
        ok: false,
        message: error.message,
        ...(error instanceof ValidationError && Object.keys(error.fieldErrors).length > 0
          ? { fieldErrors: error.fieldErrors }
          : {}),
      };
    }
    const traceId = newCorrelationId();
    logger.error("ERP AR action failed", {
      module: "erp",
      operation,
      traceId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      message: `Something went wrong and nothing was saved. Reference: ${traceId}`,
    };
  }
}

/* Lookups -------------------------------------------------------------------------- */

export async function searchCustomersAction(
  query: string,
): Promise<ActionResult<CustomerRef[]>> {
  return run("erp.ar_customer.search", (actor) => erp.searchArCustomers(actor, query), {
    revalidate: false,
  });
}

export async function listOpenInvoicesAction(
  crmAccountId: string,
): Promise<ActionResult<OpenInvoiceOption[]>> {
  return run(
    "erp.ar_invoice.open",
    (actor) => erp.listOpenInvoices(actor, crmAccountId),
    {
      revalidate: false,
    },
  );
}

/* Invoices ------------------------------------------------------------------------- */

export async function createInvoiceAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return run("erp.ar_invoice.create", (actor) => erp.createInvoice(actor, input));
}

export async function updateInvoiceAction(
  invoiceId: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return run("erp.ar_invoice.update", (actor) =>
    erp.updateInvoice(actor, invoiceId, input),
  );
}

export async function deleteInvoiceAction(invoiceId: string): Promise<ActionResult> {
  return run("erp.ar_invoice.delete", async (actor) => {
    await erp.deleteInvoice(actor, invoiceId);
    return null;
  });
}

export async function submitInvoiceAction(
  invoiceId: string,
): Promise<ActionResult<{ status: "PENDING_APPROVAL" | "APPROVED" }>> {
  return run("erp.ar_invoice.submit", (actor) => erp.submitInvoice(actor, invoiceId));
}

export async function approveInvoiceAction(invoiceId: string): Promise<ActionResult> {
  return run("erp.ar_invoice.approve", async (actor) => {
    await erp.approveInvoice(actor, invoiceId);
    return null;
  });
}

export async function rejectInvoiceAction(
  invoiceId: string,
  input: unknown,
): Promise<ActionResult> {
  return run("erp.ar_invoice.reject", async (actor) => {
    await erp.rejectInvoice(actor, invoiceId, input);
    return null;
  });
}

export async function postInvoiceAction(
  invoiceId: string,
): Promise<ActionResult<{ invoiceNumber: string; journalNumber: string }>> {
  return run("erp.ar_invoice.post", (actor) => erp.postInvoice(actor, invoiceId));
}

export async function cancelInvoiceAction(
  invoiceId: string,
  input: unknown,
): Promise<ActionResult<{ voidJournalNumber: string | null }>> {
  return run("erp.ar_invoice.cancel", (actor) =>
    erp.cancelInvoice(actor, invoiceId, input),
  );
}

/* Receipts ------------------------------------------------------------------------- */

export async function createReceiptAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return run("erp.ar_receipt.create", (actor) => erp.createReceipt(actor, input));
}

export async function updateReceiptAction(
  receiptId: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return run("erp.ar_receipt.update", (actor) =>
    erp.updateReceipt(actor, receiptId, input),
  );
}

export async function deleteReceiptAction(receiptId: string): Promise<ActionResult> {
  return run("erp.ar_receipt.delete", async (actor) => {
    await erp.deleteReceipt(actor, receiptId);
    return null;
  });
}

export async function postReceiptAction(
  receiptId: string,
): Promise<ActionResult<{ receiptNumber: string; journalNumber: string }>> {
  return run("erp.ar_receipt.post", (actor) => erp.postReceipt(actor, receiptId));
}

export async function cancelReceiptAction(
  receiptId: string,
  input: unknown,
): Promise<ActionResult<{ voidJournalNumber: string | null }>> {
  return run("erp.ar_receipt.cancel", (actor) =>
    erp.cancelReceipt(actor, receiptId, input),
  );
}

export async function allocateReceiptAction(
  receiptId: string,
  input: unknown,
): Promise<ActionResult> {
  return run("erp.ar_receipt.allocate", async (actor) => {
    await erp.allocateReceipt(actor, receiptId, input);
    return null;
  });
}

export async function unallocateReceiptAction(
  receiptId: string,
  invoiceId: string,
): Promise<ActionResult> {
  return run("erp.ar_receipt.unallocate", async (actor) => {
    await erp.unallocateReceipt(actor, receiptId, { invoiceId });
    return null;
  });
}

/* Customers and settings -------------------------------------------------------------- */

export async function updateCustomerProfileAction(
  crmAccountId: string,
  input: unknown,
): Promise<ActionResult> {
  return run("erp.ar_customer.update", async (actor) => {
    await erp.updateArCustomerProfile(actor, crmAccountId, input);
    return null;
  });
}

export async function updateArSettingsAction(input: unknown): Promise<ActionResult> {
  return run("erp.ar_settings.update", async (actor) => {
    await erp.updateArSettings(actor, input);
    return null;
  });
}

export async function saveTaxRateAction(
  taxRateId: string | null,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return run("erp.tax_rate.save", (actor) =>
    taxRateId === null
      ? erp.createTaxRate(actor, input)
      : erp.updateTaxRate(actor, taxRateId, input),
  );
}

export async function savePaymentMethodAction(
  paymentMethodId: string | null,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return run("erp.payment_method.save", (actor) =>
    paymentMethodId === null
      ? erp.createPaymentMethod(actor, input)
      : erp.updatePaymentMethod(actor, paymentMethodId, input),
  );
}

export async function updateNumberSeriesAction(
  seriesId: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return run("erp.number_series.update", (actor) =>
    erp.updateNumberSeries(actor, seriesId, input),
  );
}
