import type { Prisma } from "@prisma/client";
import { accountRefSelect, personSelect } from "./selects";

/**
 * Column selections for accounts receivable reads. Customer names are never here:
 * they come from CRM through its contract, one lookup per page (ADR-023).
 */

export const arInvoiceListSelect = {
  id: true,
  invoiceNumber: true,
  crmAccountId: true,
  invoiceDate: true,
  dueDate: true,
  status: true,
  totalMinor: true,
  paidMinor: true,
  outstandingMinor: true,
  creator: { select: personSelect },
} as const satisfies Prisma.ErpArInvoiceSelect;

export const arCreditNoteListSelect = {
  id: true,
  creditNoteNumber: true,
  crmAccountId: true,
  creditNoteDate: true,
  status: true,
  totalMinor: true,
  invoice: { select: { id: true, invoiceNumber: true } },
  creator: { select: personSelect },
} as const satisfies Prisma.ErpArCreditNoteSelect;

export const arReceiptListSelect = {
  id: true,
  receiptNumber: true,
  crmAccountId: true,
  receiptDate: true,
  amountMinor: true,
  allocatedMinor: true,
  status: true,
  paymentMethod: { select: { id: true, name: true } },
  creator: { select: personSelect },
} as const satisfies Prisma.ErpArReceiptSelect;

export const taxRateSelect = {
  id: true,
  code: true,
  name: true,
  nameAr: true,
  rateBasisPoints: true,
  isActive: true,
  taxAccount: { select: accountRefSelect },
} as const satisfies Prisma.ErpTaxRateSelect;

export const paymentMethodSelect = {
  id: true,
  code: true,
  name: true,
  nameAr: true,
  isActive: true,
  sortOrder: true,
  defaultDepositAccount: { select: accountRefSelect },
} as const satisfies Prisma.ErpPaymentMethodSelect;

export type ArInvoiceListRow = Prisma.ErpArInvoiceGetPayload<{
  select: typeof arInvoiceListSelect;
}>;
export type ArCreditNoteListRow = Prisma.ErpArCreditNoteGetPayload<{
  select: typeof arCreditNoteListSelect;
}>;
export type ArReceiptListRow = Prisma.ErpArReceiptGetPayload<{
  select: typeof arReceiptListSelect;
}>;
