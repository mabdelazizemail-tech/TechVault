/**
 * Events ERP finance publishes (CLAUDE.md §6.2, §10), written to the transactional
 * outbox inside the business transaction.
 *
 * Past tense only — an event is a fact. Payloads carry ids and the few fields a
 * subscriber needs to decide whether to care; amounts are deliberately left out, and
 * a subscriber that needs figures reads them through ERP's service. Drafts publish
 * nothing: a draft is not yet a fact anyone else should react to.
 */
export const ERP_EVENTS = {
  ACCOUNT_CREATED: "erp.AccountCreated",
  ACCOUNT_UPDATED: "erp.AccountUpdated",
  COST_CENTRE_CREATED: "erp.CostCentreCreated",
  COST_CENTRE_UPDATED: "erp.CostCentreUpdated",
  PERIOD_CREATED: "erp.PeriodCreated",
  PERIOD_CLOSED: "erp.PeriodClosed",
  PERIOD_REOPENED: "erp.PeriodReopened",
  FISCAL_YEAR_CLOSED: "erp.FiscalYearClosed",
  FISCAL_YEAR_REOPENED: "erp.FiscalYearReopened",
  JOURNAL_ENTRY_POSTED: "erp.JournalEntryPosted",
  JOURNAL_ENTRY_REVERSED: "erp.JournalEntryReversed",
  AR_INVOICE_APPROVED: "erp.ARInvoiceApproved",
  AR_INVOICE_POSTED: "erp.ARInvoicePosted",
  AR_INVOICE_CANCELLED: "erp.ARInvoiceCancelled",
  AR_CREDIT_NOTE_APPROVED: "erp.ARCreditNoteApproved",
  AR_CREDIT_NOTE_POSTED: "erp.ARCreditNotePosted",
  AR_CREDIT_NOTE_CANCELLED: "erp.ARCreditNoteCancelled",
  AR_RECEIPT_POSTED: "erp.ARReceiptPosted",
  AR_RECEIPT_ALLOCATED: "erp.ARReceiptAllocated",
  AR_RECEIPT_UNALLOCATED: "erp.ARReceiptUnallocated",
  AR_RECEIPT_CANCELLED: "erp.ARReceiptCancelled",
} as const;

export type JournalEntryPostedPayload = {
  journalEntryId: string;
  journalNumber: string;
  /** ISO date, "YYYY-MM-DD". */
  entryDate: string;
  fiscalPeriodId: string;
  /** Set when the posted entry is itself a reversal. */
  reversesEntryId: string | null;
};

export type JournalEntryReversedPayload = {
  journalEntryId: string;
  journalNumber: string;
  reversalEntryId: string;
  reversalJournalNumber: string;
};

export type PeriodClosedPayload = {
  fiscalPeriodId: string;
  name: string;
  startDate: string;
  endDate: string;
};

/* Year-end close (ADR-028) ----------------------------------------------------- */

export type FiscalYearClosedPayload = {
  year: number;
  fiscalYearCloseId: string;
  /** The closing entry; null when nothing moved in revenue or expenses. */
  journalEntryId: string | null;
};

export type FiscalYearReopenedPayload = {
  year: number;
  fiscalYearCloseId: string;
  /** The reversal of the closing entry, when there was one. */
  reversalEntryId: string | null;
};

/* Accounts receivable -------------------------------------------------------- */

export type ArInvoiceApprovedPayload = {
  invoiceId: string;
  crmAccountId: string;
  /** True when the invoice fell below the approval rule and was approved automatically. */
  approvalSkipped: boolean;
};

export type ArInvoicePostedPayload = {
  invoiceId: string;
  invoiceNumber: string;
  crmAccountId: string;
  invoiceDate: string;
  dueDate: string;
  journalEntryId: string;
};

export type ArInvoiceCancelledPayload = {
  invoiceId: string;
  invoiceNumber: string | null;
  crmAccountId: string;
  /** The reversal entry, when a posted invoice was voided. */
  voidJournalEntryId: string | null;
};

export type ArCreditNoteApprovedPayload = {
  creditNoteId: string;
  invoiceId: string;
  crmAccountId: string;
  /** True when the credit note fell below the approval rule and was approved automatically. */
  approvalSkipped: boolean;
};

export type ArCreditNotePostedPayload = {
  creditNoteId: string;
  creditNoteNumber: string;
  invoiceId: string;
  crmAccountId: string;
  creditNoteDate: string;
  journalEntryId: string;
};

export type ArCreditNoteCancelledPayload = {
  creditNoteId: string;
  creditNoteNumber: string | null;
  invoiceId: string;
  crmAccountId: string;
  /** The reversal entry, when a posted credit note was voided. */
  voidJournalEntryId: string | null;
};

export type ArReceiptPostedPayload = {
  receiptId: string;
  receiptNumber: string;
  crmAccountId: string;
  receiptDate: string;
  journalEntryId: string;
};

export type ArReceiptAllocationPayload = {
  receiptId: string;
  crmAccountId: string;
  invoiceIds: string[];
};

export type ArReceiptCancelledPayload = {
  receiptId: string;
  receiptNumber: string | null;
  crmAccountId: string;
  voidJournalEntryId: string | null;
};
