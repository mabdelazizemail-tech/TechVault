import type { ArDocumentType } from "../contracts/types";

/**
 * Starter accounts-receivable configuration, created by `prisma/seed.ts` only where
 * missing — every value here is data an administrator changes in AR settings.
 * No tax rates are seeded: rates are the organisation's to enter (§25.3).
 */

export const DEFAULT_NUMBER_SERIES: readonly {
  documentType: ArDocumentType;
  prefix: string;
  padding: number;
  resetsYearly: boolean;
}[] = [
  { documentType: "AR_INVOICE", prefix: "INV", padding: 6, resetsYearly: true },
  { documentType: "AR_CREDIT_NOTE", prefix: "CRN", padding: 6, resetsYearly: true },
  { documentType: "AR_RECEIPT", prefix: "RCT", padding: 6, resetsYearly: true },
];

export const DEFAULT_PAYMENT_METHODS: readonly {
  code: string;
  name: string;
  nameAr: string;
  sortOrder: number;
}[] = [
  { code: "CASH", name: "Cash", nameAr: "نقدي", sortOrder: 1 },
  { code: "BANK-TRANSFER", name: "Bank transfer", nameAr: "تحويل بنكي", sortOrder: 2 },
  { code: "CHEQUE", name: "Cheque", nameAr: "شيك", sortOrder: 3 },
  { code: "CARD", name: "Card", nameAr: "بطاقة", sortOrder: 4 },
  { code: "OTHER", name: "Other", nameAr: "أخرى", sortOrder: 5 },
];

/** The starter chart's receivables account, used as the default until changed. */
export const DEFAULT_RECEIVABLE_ACCOUNT_CODE = "1200";
