import { BusinessRuleError, NotFoundError } from "@/lib/errors";
import { prisma, type PrismaTransaction } from "@/lib/prisma";
import type { ApBillListItem, ApPaymentListItem } from "../../../contracts/types";
import { DEFAULT_AGING_BUCKET_DAYS } from "../../../domain/ar";
import type { ApBillListRow, ApPaymentListRow } from "../../../repositories/ap-selects";
import { isoDateOf, toAmount, toPerson } from "../support";

/**
 * Shared plumbing for accounts payable services (ADR-033). Module-private.
 */

export const POSTED_BILL_STATUSES = ["POSTED", "PARTIALLY_PAID", "PAID"] as const;
export const AP_POSTING_TRANSACTION = { timeout: 15_000, maxWait: 10_000 } as const;

/* Settings --------------------------------------------------------------------- */

export type ApSettingsRow = {
  defaultPayableAccountId: string | null;
  billApprovalRequired: boolean;
  billApprovalThresholdMinor: bigint | null;
  paymentApprovalRequired: boolean;
  paymentApprovalThresholdMinor: bigint | null;
  allowSelfApproval: boolean;
  defaultPaymentTermsDays: number;
  agingBucketDays: number[];
};

/** The AP settings row, or the defaults the migration would give it. */
export async function loadApSettings(
  client: PrismaTransaction | typeof prisma = prisma,
): Promise<ApSettingsRow> {
  const row = await client.erpApSettings.findUnique({
    where: { id: 1 },
    select: {
      defaultPayableAccountId: true,
      billApprovalRequired: true,
      billApprovalThresholdMinor: true,
      paymentApprovalRequired: true,
      paymentApprovalThresholdMinor: true,
      allowSelfApproval: true,
      defaultPaymentTermsDays: true,
      agingBucketDays: true,
    },
  });
  return (
    row ?? {
      defaultPayableAccountId: null,
      billApprovalRequired: true,
      billApprovalThresholdMinor: null,
      paymentApprovalRequired: true,
      paymentApprovalThresholdMinor: null,
      allowSelfApproval: false,
      defaultPaymentTermsDays: 30,
      agingBucketDays: [...DEFAULT_AGING_BUCKET_DAYS],
    }
  );
}

/* Vendors ----------------------------------------------------------------------- */

export type VendorTerms = {
  id: string;
  name: string;
  isActive: boolean;
  payableAccountId: string;
  paymentTermsDays: number;
};

/**
 * An active vendor with the payable account and terms its documents use: its own,
 * else the AP defaults. New documents refuse an inactive vendor.
 */
export async function requireActiveVendor(
  vendorId: string,
  settings: ApSettingsRow,
): Promise<VendorTerms> {
  const vendor = await prisma.erpVendor.findUnique({
    where: { id: vendorId },
    select: {
      id: true,
      name: true,
      isActive: true,
      payableAccountId: true,
      paymentTermsDays: true,
    },
  });
  if (vendor === null) throw new NotFoundError("vendor");
  if (!vendor.isActive) {
    throw new BusinessRuleError(
      `${vendor.name} is inactive. Reactivate the vendor first.`,
    );
  }
  const payableAccountId = vendor.payableAccountId ?? settings.defaultPayableAccountId;
  if (payableAccountId === null) {
    throw new BusinessRuleError(
      "Choose a default payable account in AP settings, or one on the vendor, before recording bills or payments.",
    );
  }
  return {
    id: vendor.id,
    name: vendor.name,
    isActive: vendor.isActive,
    payableAccountId,
    paymentTermsDays: vendor.paymentTermsDays ?? settings.defaultPaymentTermsDays,
  };
}

/* Locks ---------------------------------------------------------------------------- */

export type LockedBill = {
  id: string;
  status: string;
  billNumber: string | null;
  vendorId: string;
  billDate: string;
  totalMinor: bigint;
  paidMinor: bigint;
  journalEntryId: string | null;
  createdBy: string;
  submittedBy: string | null;
};

/** Locks one bill for the rest of the transaction. */
export async function lockBill(
  tx: PrismaTransaction,
  billId: string,
): Promise<LockedBill> {
  const rows = await tx.$queryRaw<
    {
      id: string;
      status: string;
      bill_number: string | null;
      vendor_id: string;
      bill_date: string;
      total_minor: bigint;
      paid_minor: bigint;
      journal_entry_id: string | null;
      created_by: string;
      submitted_by: string | null;
    }[]
  >`
    SELECT id, status::text AS status, bill_number, vendor_id, bill_date::text AS bill_date,
           total_minor, paid_minor, journal_entry_id, created_by, submitted_by
      FROM erp.ap_bills
     WHERE id = ${billId}::uuid
       FOR UPDATE`;
  const row = rows[0];
  if (row === undefined) throw new NotFoundError("bill");
  return {
    id: row.id,
    status: row.status,
    billNumber: row.bill_number,
    vendorId: row.vendor_id,
    billDate: row.bill_date,
    totalMinor: BigInt(row.total_minor),
    paidMinor: BigInt(row.paid_minor),
    journalEntryId: row.journal_entry_id,
    createdBy: row.created_by,
    submittedBy: row.submitted_by,
  };
}

export type LockedPayment = {
  id: string;
  status: string;
  paymentNumber: string | null;
  vendorId: string;
  paymentDate: string;
  amountMinor: bigint;
  journalEntryId: string | null;
  createdBy: string;
  submittedBy: string | null;
};

/** Locks one payment for the rest of the transaction. */
export async function lockPayment(
  tx: PrismaTransaction,
  paymentId: string,
): Promise<LockedPayment> {
  const rows = await tx.$queryRaw<
    {
      id: string;
      status: string;
      payment_number: string | null;
      vendor_id: string;
      payment_date: string;
      amount_minor: bigint;
      journal_entry_id: string | null;
      created_by: string;
      submitted_by: string | null;
    }[]
  >`
    SELECT id, status::text AS status, payment_number, vendor_id,
           payment_date::text AS payment_date, amount_minor, journal_entry_id,
           created_by, submitted_by
      FROM erp.ap_payments
     WHERE id = ${paymentId}::uuid
       FOR UPDATE`;
  const row = rows[0];
  if (row === undefined) throw new NotFoundError("payment");
  return {
    id: row.id,
    status: row.status,
    paymentNumber: row.payment_number,
    vendorId: row.vendor_id,
    paymentDate: row.payment_date,
    amountMinor: BigInt(row.amount_minor),
    journalEntryId: row.journal_entry_id,
    createdBy: row.created_by,
    submittedBy: row.submitted_by,
  };
}

/** §13.3: nobody approves a document they created or submitted, unless configured. */
export function selfApprovalRefused(
  settings: ApSettingsRow,
  document: { createdBy: string; submittedBy: string | null },
  actorId: string,
): boolean {
  return (
    !settings.allowSelfApproval &&
    (document.createdBy === actorId || document.submittedBy === actorId)
  );
}

/* Mappers ------------------------------------------------------------------------- */

export function toBillListItem(row: ApBillListRow): ApBillListItem {
  return {
    id: row.id,
    billNumber: row.billNumber,
    vendor: row.vendor,
    vendorInvoiceNumber: row.vendorInvoiceNumber,
    billDate: isoDateOf(row.billDate),
    dueDate: isoDateOf(row.dueDate),
    status: row.status,
    totalMinor: toAmount(row.totalMinor),
    paidMinor: toAmount(row.paidMinor),
    outstandingMinor: toAmount(row.outstandingMinor),
    createdBy: toPerson(row.creator) ?? { id: "", name: "Unknown" },
  };
}

export function toPaymentListItem(row: ApPaymentListRow): ApPaymentListItem {
  return {
    id: row.id,
    paymentNumber: row.paymentNumber,
    vendor: row.vendor,
    paymentDate: isoDateOf(row.paymentDate),
    status: row.status,
    amountMinor: toAmount(row.amountMinor),
    withheldMinor: toAmount(row.withheldMinor),
    cashMinor: toAmount(row.cashMinor),
    paymentMethod: row.paymentMethod,
    createdBy: toPerson(row.creator) ?? { id: "", name: "Unknown" },
  };
}
