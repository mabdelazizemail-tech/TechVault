/**
 * ERP finance DTOs (CLAUDE.md §9 rule 5) — what services return, never a Prisma
 * entity.
 *
 * Amounts are integers in minor units (piastres) held as JavaScript numbers; the
 * services refuse any value outside the safe-integer range rather than round it.
 * Calendar dates (entry dates, period bounds) are ISO "YYYY-MM-DD" strings, so no
 * time zone can move them a day.
 */

/** Phase 1 records in the functional currency only (ADR-022). */
export const ERP_CURRENCY = "EGP" as const;

export const ACCOUNT_TYPES = [
  "ASSET",
  "LIABILITY",
  "EQUITY",
  "REVENUE",
  "EXPENSE",
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  ASSET: "Asset",
  LIABILITY: "Liability",
  EQUITY: "Equity",
  REVENUE: "Revenue",
  EXPENSE: "Expense",
};

export const NORMAL_BALANCES = ["DEBIT", "CREDIT"] as const;
export type NormalBalance = (typeof NORMAL_BALANCES)[number];

export const NORMAL_BALANCE_LABELS: Record<NormalBalance, string> = {
  DEBIT: "Debit",
  CREDIT: "Credit",
};

/** Where each type's balance normally sits; contra accounts override it. */
export const DEFAULT_NORMAL_BALANCE: Record<AccountType, NormalBalance> = {
  ASSET: "DEBIT",
  EXPENSE: "DEBIT",
  LIABILITY: "CREDIT",
  EQUITY: "CREDIT",
  REVENUE: "CREDIT",
};

export const PERIOD_STATUSES = ["OPEN", "CLOSED"] as const;
export type PeriodStatus = (typeof PERIOD_STATUSES)[number];

export const PERIOD_STATUS_LABELS: Record<PeriodStatus, string> = {
  OPEN: "Open",
  CLOSED: "Closed",
};

export const JOURNAL_STATUSES = ["DRAFT", "POSTED", "REVERSED"] as const;
export type JournalStatus = (typeof JOURNAL_STATUSES)[number];

export const JOURNAL_STATUS_LABELS: Record<JournalStatus, string> = {
  DRAFT: "Draft",
  POSTED: "Posted",
  REVERSED: "Reversed",
};

/** What a journal entry records (ADR-027). */
export const JOURNAL_KINDS = ["STANDARD", "OPENING_BALANCE", "YEAR_END_CLOSE"] as const;
export type JournalKind = (typeof JOURNAL_KINDS)[number];

export const JOURNAL_KIND_LABELS: Record<JournalKind, string> = {
  STANDARD: "Standard",
  OPENING_BALANCE: "Opening balances",
  YEAR_END_CLOSE: "Year-end close",
};

export type Paginated<T> = { rows: T[]; total: number; page: number; pageSize: number };

export type PersonRef = { id: string; name: string };

/* Accounts ------------------------------------------------------------------ */

export type AccountRef = {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
};

/** An account offered in a picker. */
export type AccountOption = AccountRef & { type: AccountType; isPostable: boolean };

export type AccountListItem = AccountRef & {
  type: AccountType;
  normalBalance: NormalBalance;
  isPostable: boolean;
  isActive: boolean;
  /** 0 for a top-level account; used to indent the tree. */
  depth: number;
  parentId: string | null;
  childCount: number;
};

export type AccountDetail = AccountListItem & {
  description: string | null;
  parent: AccountRef | null;
  /** Posted activity on the account, all time. */
  totals: { debitMinor: number; creditMinor: number; balanceMinor: number };
  hasPostings: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type AccountActivityLine = {
  lineId: string;
  entryId: string;
  journalNumber: string;
  entryDate: string;
  description: string;
  entryStatus: JournalStatus;
  costCentre: CostCentreRef | null;
  debitMinor: number;
  creditMinor: number;
};

export type AccountActivity = Paginated<AccountActivityLine> & {
  /** Totals of every line matching the filters, not only this page. */
  totals: { debitMinor: number; creditMinor: number };
};

/* Cost centres -------------------------------------------------------------- */

export type CostCentreRef = {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
};

export type CostCentreListItem = CostCentreRef & {
  isActive: boolean;
  depth: number;
  parentId: string | null;
  childCount: number;
};

/* Periods ------------------------------------------------------------------- */

export type PeriodRef = { id: string; name: string; status: PeriodStatus };

export type PeriodDto = PeriodRef & {
  startDate: string;
  endDate: string;
  closedAt: Date | null;
  closedBy: PersonRef | null;
  reopenedAt: Date | null;
  reopenedBy: PersonRef | null;
  postedEntryCount: number;
};

/* Journals ------------------------------------------------------------------ */

export type JournalRef = { id: string; journalNumber: string | null };

export type JournalListItem = {
  id: string;
  journalNumber: string | null;
  entryDate: string;
  description: string;
  reference: string | null;
  status: JournalStatus;
  kind: JournalKind;
  totalMinor: number;
  lineCount: number;
  createdBy: PersonRef;
  postedAt: Date | null;
  /** On a reversal: the entry it reverses. */
  reverses: JournalRef | null;
  /** On a reversed entry: the reversal. */
  reversal: JournalRef | null;
};

export type JournalLineDto = {
  id: string;
  lineNo: number;
  account: AccountRef & { type: AccountType };
  costCentre: CostCentreRef | null;
  description: string | null;
  debitMinor: number;
  creditMinor: number;
};

export type JournalDetail = JournalListItem & {
  lines: JournalLineDto[];
  debitTotalMinor: number;
  creditTotalMinor: number;
  period: PeriodRef | null;
  postedBy: PersonRef | null;
  reversedAt: Date | null;
  reversedBy: PersonRef | null;
  /** Finance settings stop the viewer posting this draft: they created or last edited it. */
  selfPostingBlocked: boolean;
  source: { module: string; type: string; id: string } | null;
  createdAt: Date;
  updatedAt: Date;
};

/* Finance settings (ADR-027) ------------------------------------------------ */

export type FinanceSettingsDto = {
  /** When false, nobody posts a manual journal entry they created or last edited. */
  allowSelfPosting: boolean;
  retainedEarningsAccount: AccountRef | null;
  openingBalanceAccount: AccountRef | null;
};

/** What the journal form needs from finance settings. */
export type JournalDefaults = { openingBalanceAccount: AccountRef | null };

/* Fiscal years (ADR-028) ------------------------------------------------------ */

export type FiscalYearDto = {
  /** The calendar year (ADR-027). */
  year: number;
  status: "OPEN" | "CLOSED";
  /** 31 December has passed, so the year can be closed. */
  hasEnded: boolean;
  closedAt: Date | null;
  closedBy: PersonRef | null;
  /** The profit (positive) or loss (negative) moved into retained earnings. */
  netIncomeMinor: number | null;
  closingJournal: JournalRef | null;
  /** On an open year that was closed before: the latest reopening. */
  reopenedAt: Date | null;
  reopenedBy: PersonRef | null;
};

export type YearEndPreview = {
  year: number;
  netIncomeMinor: number;
  /** Revenue and expense accounts the closing entry brings to zero. */
  accountCount: number;
  retainedEarningsAccount: AccountRef | null;
  /** Why the year cannot be closed yet; empty when it can. */
  problems: string[];
};

/* Overview ------------------------------------------------------------------ */

/** Each figure is null when the viewer may not read what it counts. */
export type FinanceOverview = {
  draftCount: number | null;
  postedThisMonthCount: number | null;
  activeAccountCount: number | null;
  openPeriods: (PeriodRef & { startDate: string; endDate: string })[] | null;
  recentJournals: JournalListItem[] | null;
  /** Receivables still owed, and the part of it past due. */
  arOutstandingMinor: number | null;
  arOverdueMinor: number | null;
};

/* Ledger reports (ADR-026) ------------------------------------------------------ */

export type ReportAccount = {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  type: AccountType;
};

export type TrialBalanceRow = {
  account: ReportAccount;
  /** Balance before the start date; positive is a debit balance, negative a credit. */
  openingMinor: number;
  debitMinor: number;
  creditMinor: number;
  closingDebitMinor: number;
  closingCreditMinor: number;
};

export type TrialBalance = {
  /** Null when the report runs from the first posting. */
  from: string | null;
  to: string;
  rows: TrialBalanceRow[];
  totals: {
    openingDebitMinor: number;
    openingCreditMinor: number;
    debitMinor: number;
    creditMinor: number;
    closingDebitMinor: number;
    closingCreditMinor: number;
  };
  isBalanced: boolean;
};

/** One section of a statement, amounts in the section's own sign. */
export type StatementSection = {
  type: AccountType;
  rows: { account: ReportAccount; amountMinor: number }[];
  totalMinor: number;
};

export type ProfitAndLoss = {
  from: string;
  to: string;
  revenue: StatementSection;
  expenses: StatementSection;
  netIncomeMinor: number;
};

export type BalanceSheet = {
  asOf: string;
  assets: StatementSection;
  liabilities: StatementSection;
  equity: StatementSection;
  /** Revenue less expenses to date, not yet closed into equity (no year-end close). */
  unclosedProfitMinor: number;
  liabilitiesAndEquityMinor: number;
  isBalanced: boolean;
};

/* ========================================================================== */
/* Accounts receivable (ADR-023)                                              */
/* ========================================================================== */

export const AR_INVOICE_STATUSES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "POSTED",
  "PARTIALLY_PAID",
  "PAID",
  "CANCELLED",
] as const;
export type ArInvoiceStatus = (typeof AR_INVOICE_STATUSES)[number];

export const AR_INVOICE_STATUS_LABELS: Record<ArInvoiceStatus, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending approval",
  APPROVED: "Approved",
  POSTED: "Posted",
  PARTIALLY_PAID: "Partially paid",
  PAID: "Paid",
  CANCELLED: "Cancelled",
};

/** An invoice in these statuses is in the ledger and counts toward balances. */
export const AR_POSTED_INVOICE_STATUSES = ["POSTED", "PARTIALLY_PAID", "PAID"] as const;

export const AR_RECEIPT_STATUSES = ["DRAFT", "POSTED", "CANCELLED"] as const;
export type ArReceiptStatus = (typeof AR_RECEIPT_STATUSES)[number];

export const AR_RECEIPT_STATUS_LABELS: Record<ArReceiptStatus, string> = {
  DRAFT: "Draft",
  POSTED: "Posted",
  CANCELLED: "Cancelled",
};

export const AR_CREDIT_NOTE_STATUSES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "POSTED",
  "CANCELLED",
] as const;
export type ArCreditNoteStatus = (typeof AR_CREDIT_NOTE_STATUSES)[number];

export const AR_CREDIT_NOTE_STATUS_LABELS: Record<ArCreditNoteStatus, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending approval",
  APPROVED: "Approved",
  POSTED: "Posted",
  CANCELLED: "Cancelled",
};

export const AR_DOCUMENT_TYPES = ["AR_INVOICE", "AR_CREDIT_NOTE", "AR_RECEIPT"] as const;
export type ArDocumentType = (typeof AR_DOCUMENT_TYPES)[number];

export const AR_DOCUMENT_TYPE_LABELS: Record<ArDocumentType, string> = {
  AR_INVOICE: "Invoices",
  AR_CREDIT_NOTE: "Credit notes",
  AR_RECEIPT: "Receipts",
};

export const AP_DOCUMENT_TYPES = ["AP_BILL", "AP_PAYMENT"] as const;
export type ApDocumentType = (typeof AP_DOCUMENT_TYPES)[number];

/** Every numbered finance document: receivables and payables share one numbering engine. */
export type FinanceDocumentType = ArDocumentType | ApDocumentType;

export const FINANCE_DOCUMENT_TYPE_LABELS: Record<FinanceDocumentType, string> = {
  ...AR_DOCUMENT_TYPE_LABELS,
  AP_BILL: "Vendor bills",
  AP_PAYMENT: "Supplier payments",
};

/** A customer as ERP sees it: the CRM company id and its name, nothing more. */
export type CustomerRef = { id: string; name: string; existsInCrm: boolean };

export type TaxRateDto = {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  rateBasisPoints: number;
  taxAccount: AccountRef;
  /** Where input tax on vendor bills goes; a rate without one is not offered on bills. */
  inputTaxAccount: AccountRef | null;
  isActive: boolean;
};

export type PaymentMethodDto = {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  defaultDepositAccount: AccountRef | null;
  isActive: boolean;
  sortOrder: number;
};

export type NumberSeriesDto = {
  id: string;
  documentType: FinanceDocumentType;
  prefix: string;
  padding: number;
  resetsYearly: boolean;
};

export type ArSettingsDto = {
  defaultReceivableAccount: AccountRef | null;
  invoiceApprovalRequired: boolean;
  approvalThresholdMinor: number | null;
  allowSelfApproval: boolean;
  defaultPaymentTermsDays: number;
  agingBucketDays: number[];
  numberSeries: NumberSeriesDto[];
};

export type ArInvoiceListItem = {
  id: string;
  invoiceNumber: string | null;
  customer: CustomerRef;
  invoiceDate: string;
  dueDate: string;
  status: ArInvoiceStatus;
  totalMinor: number;
  paidMinor: number;
  outstandingMinor: number;
  createdBy: PersonRef;
};

export type ArInvoiceLineDto = {
  id: string;
  lineNo: number;
  description: string;
  /** Exact decimal as text, e.g. "2.5". */
  quantity: string;
  unitPriceMinor: number;
  grossMinor: number;
  discountMinor: number;
  netMinor: number;
  taxRate: { id: string; code: string; name: string } | null;
  taxRateBasisPoints: number | null;
  taxMinor: number;
  totalMinor: number;
  revenueAccount: AccountRef;
  costCentre: CostCentreRef | null;
};

export type ArAllocationDto = {
  id: string;
  receiptId: string;
  receiptNumber: string | null;
  receiptDate: string;
  invoiceId: string;
  invoiceNumber: string | null;
  invoiceDate: string;
  dueDate: string;
  amountMinor: number;
  allocatedAt: Date;
};

export type ArCreditNoteListItem = {
  id: string;
  creditNoteNumber: string | null;
  customer: CustomerRef;
  /** The invoice this credit note corrects. */
  invoice: { id: string; invoiceNumber: string | null };
  creditNoteDate: string;
  status: ArCreditNoteStatus;
  totalMinor: number;
  createdBy: PersonRef;
};

export type ArCreditNoteDetail = ArCreditNoteListItem & {
  currency: string;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  reason: string;
  notes: string | null;
  receivableAccount: AccountRef;
  period: PeriodRef | null;
  journal: JournalRef | null;
  voidJournal: JournalRef | null;
  lines: ArInvoiceLineDto[];
  /** What the invoice still owes now — the most a credit note against it may be. */
  invoiceOutstandingMinor: number;
  submittedAt: Date | null;
  approvalSkipped: boolean;
  approvedAt: Date | null;
  approvedBy: PersonRef | null;
  rejectedAt: Date | null;
  rejectionReason: string | null;
  postedAt: Date | null;
  postedBy: PersonRef | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** A posted invoice a credit note can be raised against, with its lines to copy. */
export type CreditableInvoice = {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  customer: CustomerRef;
  totalMinor: number;
  outstandingMinor: number;
  lines: ArInvoiceLineDto[];
};

export type ArInvoiceDetail = ArInvoiceListItem & {
  currency: string;
  /** Credited by posted credit notes (ADR-029). */
  creditedMinor: number;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  reference: string | null;
  notes: string | null;
  receivableAccount: AccountRef;
  period: PeriodRef | null;
  journal: JournalRef | null;
  voidJournal: JournalRef | null;
  lines: ArInvoiceLineDto[];
  allocations: ArAllocationDto[];
  submittedAt: Date | null;
  approvalSkipped: boolean;
  approvedAt: Date | null;
  approvedBy: PersonRef | null;
  rejectedAt: Date | null;
  rejectionReason: string | null;
  postedAt: Date | null;
  postedBy: PersonRef | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ArReceiptListItem = {
  id: string;
  receiptNumber: string | null;
  customer: CustomerRef;
  receiptDate: string;
  amountMinor: number;
  allocatedMinor: number;
  unallocatedMinor: number;
  paymentMethod: { id: string; name: string };
  status: ArReceiptStatus;
  createdBy: PersonRef;
};

export type ArReceiptDetail = ArReceiptListItem & {
  currency: string;
  reference: string | null;
  notes: string | null;
  depositAccount: AccountRef;
  receivableAccount: AccountRef;
  period: PeriodRef | null;
  journal: JournalRef | null;
  voidJournal: JournalRef | null;
  allocations: ArAllocationDto[];
  postedAt: Date | null;
  postedBy: PersonRef | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** An invoice a receipt can still be allocated to. */
export type OpenInvoiceOption = {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  totalMinor: number;
  outstandingMinor: number;
};

export type ArCustomerListItem = {
  customer: CustomerRef;
  invoicedMinor: number;
  receivedMinor: number;
  /** Invoiced − received: what the customer owes, net of unapplied receipts. */
  balanceMinor: number;
  outstandingMinor: number;
  overdueMinor: number;
  unappliedMinor: number;
  openInvoiceCount: number;
  lastActivityDate: string | null;
};

export type AgingRow = {
  customer: CustomerRef;
  /** One amount per bucket, in the order of the report's bucket labels. */
  bucketsMinor: number[];
  outstandingMinor: number;
  unappliedMinor: number;
  balanceMinor: number;
};

export type AgingReport = Paginated<AgingRow> & {
  asOf: string;
  bucketLabels: string[];
  totals: {
    bucketsMinor: number[];
    outstandingMinor: number;
    unappliedMinor: number;
    balanceMinor: number;
  };
};

export type ArCustomerProfileDto = {
  paymentTermsDays: number | null;
  creditLimitMinor: number | null;
  receivableAccount: AccountRef | null;
  notes: string | null;
  updatedAt: Date;
};

export type ArCustomerStatement = {
  from: string | null;
  to: string | null;
  openingMinor: number;
  invoicedMinor: number;
  receivedMinor: number;
  closingMinor: number;
};

export type ArCustomerAccount = {
  customer: CustomerRef;
  profile: ArCustomerProfileDto | null;
  defaultPaymentTermsDays: number;
  invoicedMinor: number;
  receivedMinor: number;
  balanceMinor: number;
  outstandingMinor: number;
  overdueMinor: number;
  unappliedMinor: number;
  creditLimitExceeded: boolean;
  aging: { asOf: string; bucketLabels: string[]; bucketsMinor: number[] };
  statement: ArCustomerStatement;
  invoices: ArInvoiceListItem[];
  receipts: ArReceiptListItem[];
};

/* Accounts payable (ADR-033) ---------------------------------------------------- */

export const AP_BILL_STATUSES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "POSTED",
  "PARTIALLY_PAID",
  "PAID",
  "CANCELLED",
] as const;
export type ApBillStatus = (typeof AP_BILL_STATUSES)[number];

export const AP_BILL_STATUS_LABELS: Record<ApBillStatus, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Waiting for approval",
  APPROVED: "Approved",
  POSTED: "Posted",
  PARTIALLY_PAID: "Partly paid",
  PAID: "Paid",
  CANCELLED: "Cancelled",
};

export const AP_PAYMENT_STATUSES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "POSTED",
  "CANCELLED",
] as const;
export type ApPaymentStatus = (typeof AP_PAYMENT_STATUSES)[number];

export const AP_PAYMENT_STATUS_LABELS: Record<ApPaymentStatus, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Waiting for approval",
  APPROVED: "Approved",
  POSTED: "Posted",
  CANCELLED: "Cancelled",
};

export type VendorRef = { id: string; name: string; isActive: boolean };

export type WithholdingTaxRateDto = {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  rateBasisPoints: number;
  payableAccount: AccountRef;
  isActive: boolean;
};

export type ApSettingsDto = {
  defaultPayableAccount: AccountRef | null;
  billApprovalRequired: boolean;
  billApprovalThresholdMinor: number | null;
  paymentApprovalRequired: boolean;
  paymentApprovalThresholdMinor: number | null;
  allowSelfApproval: boolean;
  defaultPaymentTermsDays: number;
  agingBucketDays: number[];
  numberSeries: NumberSeriesDto[];
};

export type VendorListItem = {
  id: string;
  name: string;
  nameAr: string | null;
  taxRegistrationNumber: string | null;
  isActive: boolean;
  /** What is owed on posted bills. */
  outstandingMinor: number;
  overdueMinor: number;
  openBillCount: number;
};

export type VendorDetail = VendorListItem & {
  crmAccount: CustomerRef | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  paymentTermsDays: number | null;
  payableAccount: AccountRef | null;
  defaultExpenseAccount: AccountRef | null;
  defaultWithholdingTaxRate: { id: string; code: string; name: string } | null;
  notes: string | null;
  defaultPaymentTermsDays: number;
  billedMinor: number;
  paidMinor: number;
  aging: { asOf: string; bucketLabels: string[]; bucketsMinor: number[] };
  bills: ApBillListItem[];
  payments: ApPaymentListItem[];
  createdAt: Date;
  updatedAt: Date;
};

export type ApBillListItem = {
  id: string;
  billNumber: string | null;
  vendor: VendorRef;
  vendorInvoiceNumber: string;
  billDate: string;
  dueDate: string;
  status: ApBillStatus;
  totalMinor: number;
  paidMinor: number;
  outstandingMinor: number;
  createdBy: PersonRef;
};

export type ApBillLineDto = {
  id: string;
  lineNo: number;
  description: string;
  quantity: string;
  unitPriceMinor: number;
  grossMinor: number;
  discountMinor: number;
  netMinor: number;
  taxRate: { id: string; code: string; name: string } | null;
  taxRateBasisPoints: number | null;
  taxMinor: number;
  totalMinor: number;
  expenseAccount: AccountRef;
  costCentre: CostCentreRef | null;
};

/** One posted payment line against a bill, as the bill shows it. */
export type ApBillSettlementDto = {
  paymentId: string;
  paymentNumber: string | null;
  paymentDate: string;
  amountMinor: number;
  withheldMinor: number;
  cashMinor: number;
};

export type ApBillDetail = ApBillListItem & {
  currency: string;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  reference: string | null;
  notes: string | null;
  payableAccount: AccountRef;
  period: PeriodRef | null;
  journal: JournalRef | null;
  voidJournal: JournalRef | null;
  lines: ApBillLineDto[];
  settlements: ApBillSettlementDto[];
  submittedAt: Date | null;
  approvalSkipped: boolean;
  approvedAt: Date | null;
  approvedBy: PersonRef | null;
  rejectedAt: Date | null;
  rejectionReason: string | null;
  postedAt: Date | null;
  postedBy: PersonRef | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ApPaymentListItem = {
  id: string;
  paymentNumber: string | null;
  vendor: VendorRef;
  paymentDate: string;
  status: ApPaymentStatus;
  /** Bills settled. */
  amountMinor: number;
  withheldMinor: number;
  /** Paid out of the bank. */
  cashMinor: number;
  paymentMethod: { id: string; name: string };
  createdBy: PersonRef;
};

export type ApPaymentLineDto = {
  id: string;
  lineNo: number;
  bill: {
    id: string;
    billNumber: string | null;
    vendorInvoiceNumber: string;
    dueDate: string;
    totalMinor: number;
    outstandingMinor: number;
  };
  amountMinor: number;
  withholdingTaxRate: { id: string; code: string; name: string } | null;
  withholdingBasisPoints: number | null;
  withholdingBaseMinor: number;
  withheldMinor: number;
  cashMinor: number;
};

export type ApPaymentDetail = ApPaymentListItem & {
  currency: string;
  reference: string | null;
  notes: string | null;
  bankAccount: AccountRef;
  payableAccount: AccountRef;
  period: PeriodRef | null;
  journal: JournalRef | null;
  voidJournal: JournalRef | null;
  lines: ApPaymentLineDto[];
  submittedAt: Date | null;
  approvalSkipped: boolean;
  approvedAt: Date | null;
  approvedBy: PersonRef | null;
  rejectedAt: Date | null;
  rejectionReason: string | null;
  postedAt: Date | null;
  postedBy: PersonRef | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** A posted bill a payment can still settle. */
export type OpenBillOption = {
  id: string;
  billNumber: string;
  vendorInvoiceNumber: string;
  billDate: string;
  dueDate: string;
  totalMinor: number;
  outstandingMinor: number;
  /** The part of the total before VAT, so the form can preview withholding. */
  netMinor: number;
};

export type ApAgingRow = {
  vendor: VendorRef;
  bucketsMinor: number[];
  outstandingMinor: number;
};

export type ApAgingReport = Paginated<ApAgingRow> & {
  asOf: string;
  bucketLabels: string[];
  totals: { bucketsMinor: number[]; outstandingMinor: number };
};
