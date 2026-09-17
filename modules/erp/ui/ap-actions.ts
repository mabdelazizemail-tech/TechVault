"use server";

import { revalidatePath } from "next/cache";
import { isAppError, ValidationError } from "@/lib/errors";
import type { Actor } from "@/platform/authz/authz";
import { getActor } from "@/platform/auth/current-user";
import { logger, newCorrelationId } from "@/platform/observability/logger";
import * as erp from "../contracts/service";
import type { OpenBillOption, VendorRef } from "../contracts/types";
import type { ActionResult } from "./actions";

/**
 * Accounts payable Server Actions (CLAUDE.md §9, ADR-033): authenticate, delegate to
 * the AP services — which authorise, validate, price and enforce every rule — and
 * turn the outcome into something a form can show. Nothing here decides anything.
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
    logger.error("ERP AP action failed", {
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

export async function searchVendorsAction(
  query: string,
): Promise<ActionResult<VendorRef[]>> {
  return run("erp.ap_vendor.search", (actor) => erp.searchVendors(actor, query), {
    revalidate: false,
  });
}

export async function listOpenBillsAction(
  vendorId: string,
): Promise<ActionResult<OpenBillOption[]>> {
  return run("erp.ap_bill.open", (actor) => erp.listOpenBills(actor, vendorId), {
    revalidate: false,
  });
}

/* Vendors -------------------------------------------------------------------------- */

export async function saveVendorAction(
  vendorId: string | null,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return run("erp.ap_vendor.save", (actor) =>
    vendorId === null
      ? erp.createVendor(actor, input)
      : erp.updateVendor(actor, vendorId, input),
  );
}

/* Bills ---------------------------------------------------------------------------- */

export async function saveBillAction(
  billId: string | null,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return run("erp.ap_bill.save", (actor) =>
    billId === null ? erp.createBill(actor, input) : erp.updateBill(actor, billId, input),
  );
}

export async function deleteBillAction(billId: string): Promise<ActionResult> {
  return run("erp.ap_bill.delete", async (actor) => {
    await erp.deleteBill(actor, billId);
    return null;
  });
}

export async function submitBillAction(
  billId: string,
): Promise<ActionResult<{ status: "PENDING_APPROVAL" | "APPROVED" }>> {
  return run("erp.ap_bill.submit", (actor) => erp.submitBill(actor, billId));
}

export async function approveBillAction(billId: string): Promise<ActionResult> {
  return run("erp.ap_bill.approve", async (actor) => {
    await erp.approveBill(actor, billId);
    return null;
  });
}

export async function rejectBillAction(
  billId: string,
  input: unknown,
): Promise<ActionResult> {
  return run("erp.ap_bill.reject", async (actor) => {
    await erp.rejectBill(actor, billId, input);
    return null;
  });
}

export async function postBillAction(
  billId: string,
): Promise<ActionResult<{ billNumber: string; journalNumber: string }>> {
  return run("erp.ap_bill.post", (actor) => erp.postBill(actor, billId));
}

export async function cancelBillAction(
  billId: string,
  input: unknown,
): Promise<ActionResult<{ voidJournalNumber: string | null }>> {
  return run("erp.ap_bill.cancel", (actor) => erp.cancelBill(actor, billId, input));
}

/* Payments ------------------------------------------------------------------------- */

export async function savePaymentAction(
  paymentId: string | null,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return run("erp.ap_payment.save", (actor) =>
    paymentId === null
      ? erp.createPayment(actor, input)
      : erp.updatePayment(actor, paymentId, input),
  );
}

export async function deletePaymentAction(paymentId: string): Promise<ActionResult> {
  return run("erp.ap_payment.delete", async (actor) => {
    await erp.deletePayment(actor, paymentId);
    return null;
  });
}

export async function submitPaymentAction(
  paymentId: string,
): Promise<ActionResult<{ status: "PENDING_APPROVAL" | "APPROVED" }>> {
  return run("erp.ap_payment.submit", (actor) => erp.submitPayment(actor, paymentId));
}

export async function approvePaymentAction(paymentId: string): Promise<ActionResult> {
  return run("erp.ap_payment.approve", async (actor) => {
    await erp.approvePayment(actor, paymentId);
    return null;
  });
}

export async function rejectPaymentAction(
  paymentId: string,
  input: unknown,
): Promise<ActionResult> {
  return run("erp.ap_payment.reject", async (actor) => {
    await erp.rejectPayment(actor, paymentId, input);
    return null;
  });
}

export async function postPaymentAction(
  paymentId: string,
): Promise<ActionResult<{ paymentNumber: string; journalNumber: string }>> {
  return run("erp.ap_payment.post", (actor) => erp.postPayment(actor, paymentId));
}

export async function cancelPaymentAction(
  paymentId: string,
  input: unknown,
): Promise<ActionResult<{ voidJournalNumber: string | null }>> {
  return run("erp.ap_payment.cancel", (actor) =>
    erp.cancelPayment(actor, paymentId, input),
  );
}

/* Settings ------------------------------------------------------------------------- */

export async function updateApSettingsAction(input: unknown): Promise<ActionResult> {
  return run("erp.ap_settings.update", async (actor) => {
    await erp.updateApSettings(actor, input);
    return null;
  });
}

export async function saveWithholdingTaxRateAction(
  rateId: string | null,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return run("erp.withholding_tax_rate.save", (actor) =>
    rateId === null
      ? erp.createWithholdingTaxRate(actor, input)
      : erp.updateWithholdingTaxRate(actor, rateId, input),
  );
}
