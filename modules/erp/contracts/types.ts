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
  source: { module: string; type: string; id: string } | null;
  createdAt: Date;
  updatedAt: Date;
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

export const AR_DOCUMENT_TYPES = ["AR_INVOICE", "AR_RECEIPT"] as const;
export type ArDocumentType = (typeof AR_DOCUMENT_TYPES)[number];

export const AR_DOCUMENT_TYPE_LABELS: Record<ArDocumentType, string> = {
  AR_INVOICE: "Invoices",
  AR_RECEIPT: "Receipts",
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
  documentType: ArDocumentType;
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

export type ArInvoiceDetail = ArInvoiceListItem & {
  currency: string;
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
