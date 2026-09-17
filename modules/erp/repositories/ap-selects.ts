import type { Prisma } from "@prisma/client";
import { personSelect } from "./selects";

/**
 * Column selections for accounts payable reads (ADR-033), shared so a list and its
 * detail screen cannot drift apart.
 */

export const vendorRefSelect = {
  id: true,
  name: true,
  isActive: true,
} as const satisfies Prisma.ErpVendorSelect;

export const apBillListSelect = {
  id: true,
  billNumber: true,
  vendorInvoiceNumber: true,
  billDate: true,
  dueDate: true,
  status: true,
  totalMinor: true,
  paidMinor: true,
  outstandingMinor: true,
  vendor: { select: vendorRefSelect },
  creator: { select: personSelect },
} as const satisfies Prisma.ErpApBillSelect;

export const apPaymentListSelect = {
  id: true,
  paymentNumber: true,
  paymentDate: true,
  status: true,
  amountMinor: true,
  withheldMinor: true,
  cashMinor: true,
  vendor: { select: vendorRefSelect },
  paymentMethod: { select: { id: true, name: true } },
  creator: { select: personSelect },
} as const satisfies Prisma.ErpApPaymentSelect;

export type ApBillListRow = Prisma.ErpApBillGetPayload<{
  select: typeof apBillListSelect;
}>;
export type ApPaymentListRow = Prisma.ErpApPaymentGetPayload<{
  select: typeof apPaymentListSelect;
}>;
