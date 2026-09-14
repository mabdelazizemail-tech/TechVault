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
};
