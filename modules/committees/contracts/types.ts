import type {
  CurrencyTotal,
  ExpenseCategory,
  ExpenseCurrency,
  ExpenseStatus,
  UsdTotal,
} from "../domain/expenses";

/**
 * DTOs and vocabularies Committees exposes (CLAUDE.md §9 rule 5). Services return
 * these, never Prisma entities.
 */

export const PAGE_SIZE = 20;

export type Paginated<T> = { rows: T[]; total: number; page: number; pageSize: number };

export type PersonRef = { id: string; name: string };

/* Task status --------------------------------------------------------------- */

/** What is stored. */
export const TASK_STATUSES = ["PENDING", "IN_PROGRESS", "COMPLETED"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/**
 * What people see: the stored status, except that a task not yet completed whose
 * due date has passed shows as Overdue. Overdue is derived, never set by hand.
 */
export const TASK_DISPLAY_STATUSES = [
  "PENDING",
  "IN_PROGRESS",
  "COMPLETED",
  "OVERDUE",
] as const;
export type TaskDisplayStatus = (typeof TASK_DISPLAY_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<TaskDisplayStatus, string> = {
  PENDING: "Pending",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  OVERDUE: "Overdue",
};

/** Due-date windows for filtering, counted in days from today in Cairo. */
export const DUE_WINDOWS = ["overdue", "today", "week", "month", "later"] as const;
export type DueWindow = (typeof DUE_WINDOWS)[number];

export const DUE_WINDOW_LABELS: Record<DueWindow, string> = {
  overdue: "Past due",
  today: "Due today",
  week: "Due in the next 7 days",
  month: "Due in the next 30 days",
  later: "Due after 30 days",
};

/* People responsible --------------------------------------------------------- */

/**
 * A responsible person: a registered TechVault user, or a name typed in for
 * someone without an account. The two are always told apart in the interface.
 */
export type Assignee =
  | {
      kind: "user";
      id: string;
      userId: string;
      name: string;
      isActive: boolean;
      /** What this person has done on the task, shown as the colour of their name. */
      contribution: AssigneeContribution | null;
    }
  | { kind: "manual"; id: string; name: string };

/**
 * A responsible person's own part in a task, from its discussion: the status they
 * last moved it to, or "REPLIED" when they have written but never changed the status.
 * Null when they have done neither. Typed-in names cannot act, so they have none.
 */
export type AssigneeContribution = TaskStatus | "REPLIED";

/** What a form sends for one responsible person. */
export type AssigneeInput = { userId: string } | { name: string };

/* Committees ----------------------------------------------------------------- */

export type CommitteeListItem = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  memberCount: number;
  isMember: boolean;
  nextMeetingAt: Date | null;
};

export type CommitteeDetail = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  members: (PersonRef & { isActive: boolean })[];
  isMember: boolean;
  rights: { canSchedule: boolean; canAdminister: boolean };
  createdAt: Date;
};

/* Meetings ------------------------------------------------------------------- */

export type MeetingListItem = {
  id: string;
  title: string;
  committee: { id: string; name: string };
  scheduledAt: Date;
  location: string | null;
  organizer: PersonRef;
  taskCount: number;
  openTaskCount: number;
};

export type AgendaItemDto = {
  id: string;
  position: number;
  title: string;
  notes: string | null;
};

export type MeetingDetail = {
  id: string;
  title: string;
  committee: { id: string; name: string; isActive: boolean };
  scheduledAt: Date;
  location: string | null;
  description: string | null;
  organizer: PersonRef;
  agenda: AgendaItemDto[];
  members: PersonRef[];
  taskCount: number;
  openTaskCount: number;
  rights: {
    canEdit: boolean;
    canAddTask: boolean;
    canDelete: boolean;
  };
};

/* Tasks ---------------------------------------------------------------------- */

export type TaskListItem = {
  id: string;
  meeting: { id: string; title: string; scheduledAt: Date; committeeName: string };
  description: string;
  /** "Expected outcome / next action", or null when none was recorded. */
  expectedOutcome: string | null;
  /** "YYYY-MM-DD". */
  dueDate: string;
  status: TaskStatus;
  displayStatus: TaskDisplayStatus;
  assignees: Assignee[];
  replyCount: number;
  createdBy: PersonRef;
  createdAt: Date;
};

export type ThreadEntry = {
  id: string;
  author: PersonRef;
  body: string | null;
  statusFrom: TaskStatus | null;
  statusTo: TaskStatus | null;
  createdAt: Date;
};

export type TaskDetail = TaskListItem & {
  completedAt: Date | null;
  updatedAt: Date;
  thread: ThreadEntry[];
  /** True when the discussion is longer than one page shows. */
  threadTruncated: boolean;
  rights: {
    canEdit: boolean;
    canChangeStatus: boolean;
    canReply: boolean;
    canDelete: boolean;
  };
};

export type TaskSummary = {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  overdue: number;
};

/* Mission expenses (ADR-037) ------------------------------------------------------ */

export type { ExpenseCategory, ExpenseCurrency, ExpenseStatus };

export type MissionDto = {
  id: string;
  name: string;
  description: string | null;
  defaultCurrency: string;
  isActive: boolean;
  expenseCount: number;
  /** What was claimed on it; null for someone who may not see others' claims. */
  totals: ExpenseTotals | null;
};

/** A mission as the expense form offers it. */
export type MissionOption = { id: string; name: string; defaultCurrency: string };

export type ExpenseListItem = {
  id: string;
  mission: { id: string; name: string };
  submitter: PersonRef;
  category: ExpenseCategory;
  description: string | null;
  /** "YYYY-MM-DD". */
  expenseDate: string;
  amountMinor: number;
  currency: string;
  status: ExpenseStatus;
  /** The submission date. */
  submittedAt: Date;
  reviewer: PersonRef | null;
  reviewedAt: Date | null;
  /** False when the claim was submitted without a picture of its receipt. */
  hasReceipt: boolean;
  /** The amount in USD at the claim's fixed rate; null while it waits for a rate. */
  amountUsdMinor: number | null;
};

/** How a claim was converted to USD (ADR-038). */
export type ExpenseConversion = {
  amountMinor: number;
  /** Units of the claim's currency per 1 USD, as stored ("49.45021"). */
  rate: string;
  /** When the provider published the rate. */
  rateAt: Date;
  /** "exchangerate-api", or "fixed" for a claim made in USD. */
  source: string;
  convertedAt: Date;
  /** At submission, or later because the rate service could not be reached then. */
  timing: "submission" | "later";
};

export type ExpenseDetail = ExpenseListItem & {
  reviewNote: string | null;
  /** Null when the claim was submitted without a picture. */
  receipt: { fileName: string; contentType: string; sizeBytes: number } | null;
  /** True for someone who may approve or reject it now (never its submitter). */
  canReview: boolean;
  /** True for a Committees administrator, who may delete it whatever its status. */
  canDelete: boolean;
  /** Null while the claim waits for a rate. */
  usd: ExpenseConversion | null;
};

/** One currency: submitted and approved claims, rejected ones left out. */
export type ExpenseTotal = CurrencyTotal;

/**
 * Totals for a set of claims: one per currency as claimed, and all of them in USD at
 * each claim's own fixed rate. Rejected claims are left out of both.
 */
export type ExpenseTotals = { currencies: ExpenseTotal[]; usd: UsdTotal };

export type { UsdTotal };
