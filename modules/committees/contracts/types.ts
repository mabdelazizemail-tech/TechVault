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
