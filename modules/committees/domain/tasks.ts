import { preview } from "@/platform/notifications/rules";
import type {
  AssigneeInput,
  DueWindow,
  TaskDisplayStatus,
  TaskStatus,
} from "../contracts/types";
import { addDays } from "./dates";

/**
 * Pure rules for meetings' Team To-Do Lists (ADR-036): what status a task shows,
 * what a due-date filter means, who may do what to a task, and what its
 * notifications say. No I/O.
 */

/* Status ---------------------------------------------------------------------- */

/** A task not yet completed whose due date has passed is Overdue. */
export function displayStatus(
  status: TaskStatus,
  dueDate: string,
  today: string,
): TaskDisplayStatus {
  return status !== "COMPLETED" && dueDate < today ? "OVERDUE" : status;
}

/* Due-date windows -------------------------------------------------------------- */

export type DueRange = {
  gte?: string;
  lte?: string;
  lt?: string;
  gt?: string;
  /** Only tasks not yet completed. */
  openOnly?: boolean;
};

export function dueWindowRange(window: DueWindow, today: string): DueRange {
  switch (window) {
    case "overdue":
      return { lt: today, openOnly: true };
    case "today":
      return { gte: today, lte: today };
    case "week":
      return { gte: today, lte: addDays(today, 6) };
    case "month":
      return { gte: today, lte: addDays(today, 29) };
    case "later":
      return { gt: addDays(today, 29) };
  }
}

/* Responsible people ------------------------------------------------------------- */

/**
 * The people a form named, each once: users by id, typed names ignoring case and
 * surrounding spaces. The first spelling of a typed name is kept.
 */
export function normaliseAssignees(inputs: readonly AssigneeInput[]): {
  userIds: string[];
  names: string[];
} {
  const userIds = new Set<string>();
  const names = new Map<string, string>();
  for (const input of inputs) {
    if ("userId" in input) {
      userIds.add(input.userId);
    } else {
      const name = input.name.replace(/\s+/g, " ").trim();
      const key = name.toLowerCase();
      if (name !== "" && !names.has(key)) names.set(key, name);
    }
  }
  return { userIds: [...userIds], names: [...names.values()] };
}

/* Rights --------------------------------------------------------------------------- */

/**
 * What the actor may do to a task they can see. Permissions say what kind of thing
 * they may do; these rules say which tasks:
 *
 *  - edit (text, due date, responsible people): its creator, the meeting's
 *    organiser, or a committee administrator;
 *  - change its status: any of those, or a registered person responsible for it;
 *  - reply: anyone who can see it;
 *  - delete: committee administrators only.
 */
export function taskRights(input: {
  actorId: string;
  isAdmin: boolean;
  organizerId: string;
  createdBy: string;
  assigneeUserIds: readonly string[];
  holdsTaskUpdate: boolean;
  holdsTaskReply: boolean;
}): {
  canEdit: boolean;
  canChangeStatus: boolean;
  canReply: boolean;
  canDelete: boolean;
} {
  const owns =
    input.isAdmin ||
    input.createdBy === input.actorId ||
    input.organizerId === input.actorId;
  const canEdit = input.holdsTaskUpdate && owns;
  const canChangeStatus =
    input.holdsTaskUpdate && (owns || input.assigneeUserIds.includes(input.actorId));
  return {
    canEdit,
    canChangeStatus,
    canReply: input.holdsTaskReply,
    canDelete: input.isAdmin,
  };
}

/** What the actor may do to a meeting they can see. */
export function meetingRights(input: {
  actorId: string;
  isAdmin: boolean;
  organizerId: string;
  holdsMeetingUpdate: boolean;
  holdsTaskCreate: boolean;
}): { canEdit: boolean; canAddTask: boolean; canDelete: boolean } {
  return {
    canEdit:
      input.holdsMeetingUpdate && (input.isAdmin || input.organizerId === input.actorId),
    canAddTask: input.holdsTaskCreate,
    canDelete: input.isAdmin,
  };
}

/* Notification text ------------------------------------------------------------------- */

type NoticeText = { title: string; body: string };

/** A task created with, or later given, this person as responsible. */
export function taskAssignedNotice(input: {
  actorName: string;
  meetingTitle: string;
  meetingDate: string;
  description: string;
  dueDate: string;
  expectedOutcome?: string | null;
}): NoticeText {
  const outcome =
    input.expectedOutcome === undefined || input.expectedOutcome === null
      ? ""
      : ` — Expected outcome: “${preview(input.expectedOutcome, 160)}”`;
  return {
    title: `${input.actorName} assigned you a task`,
    body: `${input.meetingTitle} (${input.meetingDate}) — “${preview(input.description, 160)}” — due ${input.dueDate}${outcome}`,
  };
}

export function taskReplyNotice(input: {
  actorName: string;
  meetingTitle: string;
  description: string;
  reply: string;
}): NoticeText {
  return {
    title: `${input.actorName} replied to a task`,
    body: `${input.meetingTitle} — Task: “${preview(input.description, 80)}” — “${preview(input.reply, 200)}”`,
  };
}

export function taskStatusNotice(input: {
  actorName: string;
  meetingTitle: string;
  description: string;
  statusLabel: string;
  comment: string | null;
}): NoticeText {
  const comment = input.comment === null ? "" : ` — “${preview(input.comment, 200)}”`;
  return {
    title: `${input.actorName} marked a task ${input.statusLabel}`,
    body: `${input.meetingTitle} — Task: “${preview(input.description, 80)}”${comment}`,
  };
}
