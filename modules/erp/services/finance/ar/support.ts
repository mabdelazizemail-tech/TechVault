import { BusinessRuleError, NotFoundError, ValidationError } from "@/lib/errors";
import { prisma, type PrismaTransaction } from "@/lib/prisma";
import {
  getAccountReferences,
  searchAccountReferences,
} from "@/modules/crm/contracts/service";
import {
  ACCOUNT_TYPE_LABELS,
  type AccountType,
  type ArInvoiceListItem,
  type ArReceiptListItem,
  type CustomerRef,
} from "../../../contracts/types";
import { DEFAULT_AGING_BUCKET_DAYS } from "../../../domain/ar";
import type {
  ArInvoiceListRow,
  ArReceiptListRow,
} from "../../../repositories/ar-selects";
import { isoDateOf, toAmount, toPerson } from "../support";

/**
 * Shared plumbing for accounts receivable services. Module-private.
 */

export const POSTED_INVOICE_STATUSES = ["POSTED", "PARTIALLY_PAID", "PAID"] as const;
export const AR_POSTING_TRANSACTION = { timeout: 15_000, maxWait: 10_000 } as const;

/* Customers, through CRM's contract ----------------------------------------- */

function toCustomer(reference: {
  id: string;
  name: string;
  exists: boolean;
}): CustomerRef {
  return { id: reference.id, name: reference.name, existsInCrm: reference.exists };
}

/** CRM names for a page of customer ids — one lookup, never one per row. */
export async function customerRefs(
  ids: readonly string[],
): Promise<Map<string, CustomerRef>> {
  const references = await getAccountReferences(ids);
  return new Map(references.map((reference) => [reference.id, toCustomer(reference)]));
}

export function customerFrom(map: Map<string, CustomerRef>, id: string): CustomerRef {
  return map.get(id) ?? { id, name: "Unknown company", existsInCrm: false };
}

/** The customer, which must exist in CRM, or a field error on `field`. */
export async function requireLiveCustomer(
  crmAccountId: string,
  field = "crmAccountId",
): Promise<CustomerRef> {
  const [reference] = await getAccountReferences([crmAccountId]);
  if (reference === undefined || !reference.exists) {
    throw new ValidationError("Please correct the highlighted fields.", {
      [field]: ["Choose a customer that exists in CRM."],
    });
  }
  return toCustomer(reference);
}

export async function searchCustomers(query: string): Promise<CustomerRef[]> {
  return (await searchAccountReferences(query, 20)).map(toCustomer);
}

/* Settings -------------------------------------------------------------------- */

export type ArSettingsRow = {
  defaultReceivableAccountId: string | null;
  invoiceApprovalRequired: boolean;
  approvalThresholdMinor: bigint | null;
  allowSelfApproval: boolean;
  defaultPaymentTermsDays: number;
  agingBucketDays: number[];
};

/** The AR settings row, or the defaults the migration would give it. */
export async function loadArSettings(
  client: PrismaTransaction | typeof prisma = prisma,
): Promise<ArSettingsRow> {
  const row = await client.erpArSettings.findUnique({
    where: { id: 1 },
    select: {
      defaultReceivableAccountId: true,
      invoiceApprovalRequired: true,
      approvalThresholdMinor: true,
      allowSelfApproval: true,
      defaultPaymentTermsDays: true,
      agingBucketDays: true,
    },
  });
  return (
    row ?? {
      defaultReceivableAccountId: null,
      invoiceApprovalRequired: true,
      approvalThresholdMinor: null,
      allowSelfApproval: false,
      defaultPaymentTermsDays: 30,
      agingBucketDays: [...DEFAULT_AGING_BUCKET_DAYS],
    }
  );
}

/** The receivable account for a customer: its profile's, else the AR default. */
export async function resolveReceivableAccount(
  crmAccountId: string,
  settings: ArSettingsRow,
): Promise<{ receivableAccountId: string; paymentTermsDays: number }> {
  const profile = await prisma.erpArCustomerProfile.findUnique({
    where: { crmAccountId },
    select: { receivableAccountId: true, paymentTermsDays: true },
  });
  const receivableAccountId =
    profile?.receivableAccountId ?? settings.defaultReceivableAccountId;
  if (receivableAccountId === null) {
    throw new BusinessRuleError(
      "Choose a default receivable account in AR settings before recording invoices or receipts.",
    );
  }
  return {
    receivableAccountId,
    paymentTermsDays: profile?.paymentTermsDays ?? settings.defaultPaymentTermsDays,
  };
}

/**
 * An active, postable account of one of the given types — or a field error. Used for
 * revenue, receivable, deposit and tax accounts, so each lands where it belongs.
 */
export async function requireAccount(
  accountId: string,
  types: readonly AccountType[],
  field: string,
): Promise<{ id: string; code: string }> {
  const account = await prisma.erpAccount.findUnique({
    where: { id: accountId },
    select: { id: true, code: true, type: true, isActive: true, isPostable: true },
  });
  const invalid = (message: string) =>
    new ValidationError("Please correct the highlighted fields.", { [field]: [message] });
  if (account === null) throw invalid("Choose a valid account.");
  if (!account.isActive) throw invalid(`Account ${account.code} is inactive.`);
  if (!account.isPostable)
    throw invalid(`${account.code} is a heading and cannot take postings.`);
  if (!types.includes(account.type)) {
    throw invalid(
      `${account.code} is not ${types.map((type) => ACCOUNT_TYPE_LABELS[type].toLowerCase()).join(" or ")} account.`.replace(
        "not a",
        "not an",
      ),
    );
  }
  return { id: account.id, code: account.code };
}

/* Locks -------------------------------------------------------------------------- */

export type LockedInvoice = {
  id: string;
  status: string;
  invoiceNumber: string | null;
  crmAccountId: string;
  invoiceDate: string;
  totalMinor: bigint;
  paidMinor: bigint;
  journalEntryId: string | null;
  createdBy: string;
  submittedBy: string | null;
};

/** Locks one invoice for the rest of the transaction. */
export async function lockInvoice(
  tx: PrismaTransaction,
  invoiceId: string,
): Promise<LockedInvoice> {
  const rows = await tx.$queryRaw<
    {
      id: string;
      status: string;
      invoice_number: string | null;
      crm_account_id: string;
      invoice_date: string;
      total_minor: bigint;
      paid_minor: bigint;
      journal_entry_id: string | null;
      created_by: string;
      submitted_by: string | null;
    }[]
  >`
    SELECT id, status::text AS status, invoice_number, crm_account_id,
           invoice_date::text AS invoice_date, total_minor, paid_minor, journal_entry_id,
           created_by, submitted_by
      FROM erp.ar_invoices
     WHERE id = ${invoiceId}::uuid
       FOR UPDATE`;
  const row = rows[0];
  if (row === undefined) throw new NotFoundError("invoice");
  return {
    id: row.id,
    status: row.status,
    invoiceNumber: row.invoice_number,
    crmAccountId: row.crm_account_id,
    invoiceDate: row.invoice_date,
    totalMinor: BigInt(row.total_minor),
    paidMinor: BigInt(row.paid_minor),
    journalEntryId: row.journal_entry_id,
    createdBy: row.created_by,
    submittedBy: row.submitted_by,
  };
}

export type LockedReceipt = {
  id: string;
  status: string;
  receiptNumber: string | null;
  crmAccountId: string;
  receiptDate: string;
  amountMinor: bigint;
  allocatedMinor: bigint;
  journalEntryId: string | null;
};

/** Locks one receipt for the rest of the transaction. */
export async function lockReceipt(
  tx: PrismaTransaction,
  receiptId: string,
): Promise<LockedReceipt> {
  const rows = await tx.$queryRaw<
    {
      id: string;
      status: string;
      receipt_number: string | null;
      crm_account_id: string;
      receipt_date: string;
      amount_minor: bigint;
      allocated_minor: bigint;
      journal_entry_id: string | null;
    }[]
  >`
    SELECT id, status::text AS status, receipt_number, crm_account_id,
           receipt_date::text AS receipt_date, amount_minor, allocated_minor, journal_entry_id
      FROM erp.ar_receipts
     WHERE id = ${receiptId}::uuid
       FOR UPDATE`;
  const row = rows[0];
  if (row === undefined) throw new NotFoundError("receipt");
  return {
    id: row.id,
    status: row.status,
    receiptNumber: row.receipt_number,
    crmAccountId: row.crm_account_id,
    receiptDate: row.receipt_date,
    amountMinor: BigInt(row.amount_minor),
    allocatedMinor: BigInt(row.allocated_minor),
    journalEntryId: row.journal_entry_id,
  };
}

/* Mappers ------------------------------------------------------------------------- */

export function toInvoiceListItem(
  row: ArInvoiceListRow,
  customers: Map<string, CustomerRef>,
): ArInvoiceListItem {
  return {
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    customer: customerFrom(customers, row.crmAccountId),
    invoiceDate: isoDateOf(row.invoiceDate),
    dueDate: isoDateOf(row.dueDate),
    status: row.status,
    totalMinor: toAmount(row.totalMinor),
    paidMinor: toAmount(row.paidMinor),
    outstandingMinor: toAmount(row.outstandingMinor),
    createdBy: toPerson(row.creator) ?? { id: "", name: "Unknown" },
  };
}

export function toReceiptListItem(
  row: ArReceiptListRow,
  customers: Map<string, CustomerRef>,
): ArReceiptListItem {
  return {
    id: row.id,
    receiptNumber: row.receiptNumber,
    customer: customerFrom(customers, row.crmAccountId),
    receiptDate: isoDateOf(row.receiptDate),
    amountMinor: toAmount(row.amountMinor),
    allocatedMinor: toAmount(row.allocatedMinor),
    unallocatedMinor: toAmount(row.amountMinor - row.allocatedMinor),
    paymentMethod: row.paymentMethod,
    status: row.status,
    createdBy: toPerson(row.creator) ?? { id: "", name: "Unknown" },
  };
}

/** Customer ids from a name search, for filtering AR lists by customer name. */
export async function customerIdsMatching(
  query: string | undefined,
): Promise<string[] | null> {
  if (query === undefined || query === "") return null;
  return (await searchAccountReferences(query, 50)).map((reference) => reference.id);
}
