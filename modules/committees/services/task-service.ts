import type { Prisma } from "@prisma/client";
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { diffForAudit, recordAudit } from "@/platform/audit/audit";
import {
  type Actor,
  requireGlobalPermission,
  requirePermission,
} from "@/platform/authz/authz";
import { publish } from "@/platform/events/publish";
import { notify } from "@/platform/notifications/notifications";
import { COMMITTEES_EVENTS, COMMITTEES_NOTIFICATIONS } from "../contracts/events";
import { COMMITTEES_PERMISSIONS } from "../contracts/permissions";
import {
  replySchema,
  statusChangeSchema,
  taskListParamsSchema,
  taskSchema,
} from "../contracts/schemas";
import {
  PAGE_SIZE,
  TASK_STATUS_LABELS,
  type Assignee,
  type AssigneeContribution,
  type Paginated,
  type PersonRef,
  type TaskDetail,
  type TaskListItem,
  type TaskStatus,
  type TaskSummary,
  type ThreadEntry,
} from "../contracts/types";
import { dateFromIso, isoDateOf, todayInCairo } from "../domain/dates";
import { formatCalendarDate, formatDateTime } from "../domain/format";
import {
  displayStatus,
  dueWindowRange,
  normaliseAssignees,
  taskAssignedNotice,
  taskReplyNotice,
  taskRights,
  taskStatusNotice,
} from "../domain/tasks";
import { loadVisibleMeeting } from "./meeting-service";
import { assertPeopleCanTakePart, displayNameOf } from "./people";
import {
  COMMITTEES_MODULE,
  assertId,
  auditFields,
  isActivePerson,
  memberRights,
  parseInput,
  personSelect,
  toPerson,
  type Viewer,
  viewerFor,
  visibleMeetingWhere,
} from "./support";

/**
 * Each meeting's Team To-Do List (ADR-036): tasks with responsible people — users
 * or typed names — a due date, a status and a discussion.
 *
 * Every write that people need to hear about notifies them in the same
 * transaction, through platform/notifications: a new task tells the people
 * responsible for it; a reply or a status change tells the task's creator and the
 * people responsible. Nobody is told about their own action, and nobody twice.
 */

/** How much of a discussion one page shows; longer ones say so. */
const THREAD_LIMIT = 500;

const taskSelect = {
  id: true,
  description: true,
  expectedOutcome: true,
  dueDate: true,
  status: true,
  replyCount: true,
  createdAt: true,
  createdBy: true,
  creator: { select: personSelect },
  meeting: {
    select: {
      id: true,
      title: true,
      scheduledAt: true,
      organizerId: true,
      committee: { select: { name: true } },
    },
  },
  assignees: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, userId: true, manualName: true, user: { select: personSelect } },
  },
} satisfies Prisma.CommitteeTaskSelect;

type TaskRow = Prisma.CommitteeTaskGetPayload<{ select: typeof taskSelect }>;

/** Registered users first, then typed names, each alphabetically. */
/** Per task, per author: the status they last set, or REPLIED. */
type Contributions = Map<string, Map<string, AssigneeContribution>>;

/**
 * What each person has contributed to each of these tasks, from the discussion, in
 * one statement however many tasks a page holds. DISTINCT ON keeps one row per task
 * and author: their latest status change if they ever made one, otherwise their
 * latest reply. Raw SQL because Prisma cannot express DISTINCT ON in the database;
 * the ids are a bound parameter.
 */
async function contributionsFor(taskIds: readonly string[]): Promise<Contributions> {
  const result: Contributions = new Map();
  if (taskIds.length === 0) return result;
  const rows = await prisma.$queryRaw<
    { task_id: string; author_id: string; status_to: TaskStatus | null }[]
  >`
    SELECT DISTINCT ON (r.task_id, r.author_id)
           r.task_id, r.author_id, r.status_to::text AS status_to
      FROM committees.task_replies r
     WHERE r.task_id = ANY(${[...taskIds]}::uuid[])
     ORDER BY r.task_id, r.author_id, (r.status_to IS NOT NULL) DESC,
              r.created_at DESC, r.id DESC
  `;
  for (const row of rows) {
    const byAuthor = result.get(row.task_id) ?? new Map<string, AssigneeContribution>();
    byAuthor.set(row.author_id, row.status_to ?? "REPLIED");
    result.set(row.task_id, byAuthor);
  }
  return result;
}

function toAssignees(row: TaskRow, contributions: Contributions): Assignee[] {
  const byAuthor = contributions.get(row.id);
  const list: Assignee[] = row.assignees.map((assignee) =>
    assignee.user !== null
      ? {
          kind: "user" as const,
          id: assignee.id,
          userId: assignee.user.id,
          name: toPerson(assignee.user).name,
          isActive: isActivePerson(assignee.user),
          contribution: byAuthor?.get(assignee.user.id) ?? null,
        }
      : { kind: "manual" as const, id: assignee.id, name: assignee.manualName ?? "" },
  );
  return list.sort((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "user" ? -1 : 1,
  );
}

function toListItem(
  row: TaskRow,
  today: string,
  contributions: Contributions,
): TaskListItem {
  const dueDate = isoDateOf(row.dueDate);
  return {
    id: row.id,
    meeting: {
      id: row.meeting.id,
      title: row.meeting.title,
      scheduledAt: row.meeting.scheduledAt,
      committeeName: row.meeting.committee.name,
    },
    description: row.description,
    expectedOutcome: row.expectedOutcome,
    dueDate,
    status: row.status,
    displayStatus: displayStatus(row.status, dueDate, today),
    assignees: toAssignees(row, contributions),
    replyCount: row.replyCount,
    createdBy: toPerson(row.creator),
    createdAt: row.createdAt,
  };
}

function assigneeUserIds(row: { assignees: { userId: string | null }[] }): string[] {
  return row.assignees.flatMap((assignee) =>
    assignee.userId === null ? [] : [assignee.userId],
  );
}

function taskLink(meetingId: string, taskId: string, anchor?: string): string {
  return `/committees/meetings/${meetingId}/tasks/${taskId}${anchor !== undefined ? `#${anchor}` : ""}`;
}

/** A live task the viewer may see, or "not found" (§11.6). */
async function loadVisibleTask(viewer: Viewer, taskId: string): Promise<TaskRow> {
  assertId(taskId, "task");
  const row = await prisma.committeeTask.findFirst({
    where: { id: taskId, deletedAt: null, meeting: visibleMeetingWhere(viewer) },
    select: taskSelect,
  });
  if (row === null) throw new NotFoundError("task");
  return row;
}

async function rightsFor(viewer: Viewer, row: TaskRow) {
  const held = await memberRights(viewer.actor);
  return taskRights({
    actorId: viewer.actor.id,
    isAdmin: viewer.isAdmin,
    organizerId: row.meeting.organizerId,
    createdBy: row.createdBy,
    assigneeUserIds: assigneeUserIds(row),
    holdsTaskUpdate: held.taskUpdate,
    holdsTaskReply: held.taskReply,
  });
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

type ListScope = { meetingId?: string; openOnly?: boolean };

function listWhere(
  viewer: Viewer,
  params: ReturnType<typeof taskListParamsSchema.parse>,
  scope: ListScope,
  today: string,
): Prisma.CommitteeTaskWhereInput {
  const todayDate = dateFromIso(today);
  const and: Prisma.CommitteeTaskWhereInput[] = [
    { deletedAt: null, meeting: visibleMeetingWhere(viewer) },
  ];
  if (scope.meetingId !== undefined) and.push({ meetingId: scope.meetingId });
  if (scope.openOnly === true) and.push({ status: { not: "COMPLETED" } });
  if (params.committee !== undefined) {
    and.push({ meeting: { committeeId: params.committee } });
  }

  switch (params.status) {
    case "PENDING":
    case "IN_PROGRESS":
      and.push({ status: params.status, dueDate: { gte: todayDate } });
      break;
    case "COMPLETED":
      and.push({ status: "COMPLETED" });
      break;
    case "OVERDUE":
      and.push({ status: { not: "COMPLETED" }, dueDate: { lt: todayDate } });
      break;
    case undefined:
      break;
  }

  if (params.due !== undefined) {
    const range = dueWindowRange(params.due, today);
    and.push({
      dueDate: {
        ...(range.gte !== undefined ? { gte: dateFromIso(range.gte) } : {}),
        ...(range.lte !== undefined ? { lte: dateFromIso(range.lte) } : {}),
        ...(range.lt !== undefined ? { lt: dateFromIso(range.lt) } : {}),
        ...(range.gt !== undefined ? { gt: dateFromIso(range.gt) } : {}),
      },
      ...(range.openOnly === true ? { status: { not: "COMPLETED" as const } } : {}),
    });
  }

  const responsible = params.responsible;
  if (responsible !== undefined) {
    if (responsible.kind === "name") {
      and.push({
        assignees: {
          some: { manualName: { equals: responsible.name, mode: "insensitive" } },
        },
      });
    } else {
      const userId = responsible.kind === "me" ? viewer.actor.id : responsible.id;
      and.push({ assignees: { some: { userId } } });
    }
  }

  if (params.q !== undefined && params.q !== "") {
    const contains = { contains: params.q, mode: "insensitive" as const };
    and.push({
      OR: [
        { description: contains },
        { expectedOutcome: contains },
        { assignees: { some: { manualName: contains } } },
        { assignees: { some: { user: { fullName: contains } } } },
      ],
    });
  }

  return { AND: and };
}

function listOrder(
  params: ReturnType<typeof taskListParamsSchema.parse>,
): Prisma.CommitteeTaskOrderByWithRelationInput[] {
  switch (params.sort) {
    case "created":
      return [{ createdAt: params.dir ?? "desc" }, { id: "asc" }];
    case "status":
      return [{ status: params.dir ?? "asc" }, { dueDate: "asc" }, { id: "asc" }];
    default:
      return [{ dueDate: params.dir ?? "asc" }, { createdAt: "desc" }, { id: "asc" }];
  }
}

/**
 * Tasks the actor can see, filtered and paginated in the database. Pass a meeting
 * for that meeting's Team To-Do List; without one, every visible meeting's tasks.
 */
export async function listTasks(
  actor: Actor,
  rawParams: Record<string, unknown> = {},
  scope: ListScope = {},
): Promise<Paginated<TaskListItem>> {
  const viewer = await viewerFor(actor);
  if (scope.meetingId !== undefined) await loadVisibleMeeting(viewer, scope.meetingId);
  const params = taskListParamsSchema.parse(rawParams);
  const today = todayInCairo();
  const where = listWhere(viewer, params, scope, today);

  const [total, rows] = await Promise.all([
    prisma.committeeTask.count({ where }),
    prisma.committeeTask.findMany({
      where,
      orderBy: listOrder(params),
      skip: (params.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: taskSelect,
    }),
  ]);
  const contributions = await contributionsFor(rows.map((row) => row.id));
  return {
    rows: rows.map((row) => toListItem(row, today, contributions)),
    total,
    page: params.page,
    pageSize: PAGE_SIZE,
  };
}

/**
 * Counts by the status people see — Overdue taken out of Pending and In progress —
 * so the five figures add up. Two grouped statements, whatever the volume.
 */
export async function getTaskSummary(
  actor: Actor,
  scope: { meetingId?: string } = {},
): Promise<TaskSummary> {
  const viewer = await viewerFor(actor);
  if (scope.meetingId !== undefined) await loadVisibleMeeting(viewer, scope.meetingId);
  const today = dateFromIso(todayInCairo());
  const where: Prisma.CommitteeTaskWhereInput = {
    deletedAt: null,
    meeting: visibleMeetingWhere(viewer),
    ...(scope.meetingId !== undefined ? { meetingId: scope.meetingId } : {}),
  };

  const [all, late] = await Promise.all([
    prisma.committeeTask.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.committeeTask.groupBy({
      by: ["status"],
      where: { ...where, status: { not: "COMPLETED" }, dueDate: { lt: today } },
      _count: { _all: true },
    }),
  ]);
  const count = (groups: typeof all, status: TaskStatus) =>
    groups.find((group) => group.status === status)?._count._all ?? 0;

  const pending = count(all, "PENDING") - count(late, "PENDING");
  const inProgress = count(all, "IN_PROGRESS") - count(late, "IN_PROGRESS");
  const completed = count(all, "COMPLETED");
  const overdue = count(late, "PENDING") + count(late, "IN_PROGRESS");
  return {
    total: pending + inProgress + completed + overdue,
    pending,
    inProgress,
    completed,
    overdue,
  };
}

/**
 * The people responsible for anything in one meeting, for its filter: registered
 * users and typed names, kept apart.
 */
export async function listMeetingAssignees(
  actor: Actor,
  meetingId: string,
): Promise<{ users: PersonRef[]; names: string[] }> {
  const viewer = await viewerFor(actor);
  await loadVisibleMeeting(viewer, meetingId);
  const rows = await prisma.committeeTaskAssignee.findMany({
    where: { task: { meetingId, deletedAt: null } },
    select: { manualName: true, user: { select: personSelect } },
    take: 1000,
  });

  const users = new Map<string, PersonRef>();
  const names = new Map<string, string>();
  for (const row of rows) {
    if (row.user !== null) users.set(row.user.id, toPerson(row.user));
    else if (row.manualName !== null) {
      names.set(row.manualName.toLowerCase(), row.manualName);
    }
  }
  return {
    users: [...users.values()].sort((a, b) => a.name.localeCompare(b.name)),
    names: [...names.values()].sort((a, b) => a.localeCompare(b)),
  };
}

export async function getTask(actor: Actor, taskId: string): Promise<TaskDetail> {
  const viewer = await viewerFor(actor);
  const row = await loadVisibleTask(viewer, taskId);
  const [extra, rights, contributions] = await Promise.all([
    prisma.committeeTask.findUniqueOrThrow({
      where: { id: row.id },
      select: {
        completedAt: true,
        updatedAt: true,
        replies: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: THREAD_LIMIT + 1,
          select: {
            id: true,
            body: true,
            statusFrom: true,
            statusTo: true,
            createdAt: true,
            author: { select: personSelect },
          },
        },
      },
    }),
    rightsFor(viewer, row),
    contributionsFor([row.id]),
  ]);

  return {
    ...toListItem(row, todayInCairo(), contributions),
    completedAt: extra.completedAt,
    updatedAt: extra.updatedAt,
    thread: extra.replies.slice(0, THREAD_LIMIT).map((reply) => ({
      id: reply.id,
      author: toPerson(reply.author),
      body: reply.body,
      statusFrom: reply.statusFrom,
      statusTo: reply.statusTo,
      createdAt: reply.createdAt,
    })),
    threadTruncated: extra.replies.length > THREAD_LIMIT,
    rights,
  };
}

/* -------------------------------------------------------------------------- */
/* Creating and editing                                                       */
/* -------------------------------------------------------------------------- */

export async function createTask(
  actor: Actor,
  meetingId: string,
  rawInput: unknown,
): Promise<{ id: string }> {
  await requirePermission(actor, COMMITTEES_PERMISSIONS.TASK_CREATE);
  const viewer = await viewerFor(actor);
  const meeting = await loadVisibleMeeting(viewer, meetingId);
  const input = parseInput(taskSchema, rawInput);
  const { userIds, names } = normaliseAssignees(input.assignees);
  await assertPeopleCanTakePart(actor, userIds, {
    field: "assignees",
    allowTypedName: true,
  });
  const actorName = await displayNameOf(actor);

  return prisma.$transaction(async (tx) => {
    const task = await tx.committeeTask.create({
      data: {
        meetingId,
        description: input.description,
        expectedOutcome: input.expectedOutcome,
        dueDate: dateFromIso(input.dueDate),
        createdBy: actor.id,
        updatedBy: actor.id,
        assignees: {
          create: [
            ...userIds.map((userId) => ({ userId, createdBy: actor.id })),
            ...names.map((manualName) => ({ manualName, createdBy: actor.id })),
          ],
        },
      },
      select: { id: true },
    });
    await recordAudit(
      {
        ...auditFields(actor),
        action: "committees.task.created",
        module: COMMITTEES_MODULE,
        entityType: "CommitteeTask",
        entityId: task.id,
        summary: `Added a task to ${meeting.title}`,
        changes: {
          dueDate: input.dueDate,
          hasExpectedOutcome: input.expectedOutcome !== null,
          assigneeUserIds: userIds,
          assigneeNames: names,
        },
      },
      tx,
    );
    await publish(tx, {
      name: COMMITTEES_EVENTS.TASK_CREATED,
      actorId: actor.id,
      correlationId: actor.correlationId ?? null,
      payload: { taskId: task.id, meetingId },
    });
    await notify(tx, {
      type: COMMITTEES_NOTIFICATIONS.TASK_ASSIGNED,
      module: COMMITTEES_MODULE,
      entityType: "CommitteeTask",
      entityId: task.id,
      sourceId: task.id,
      actorId: actor.id,
      // The creator is the owner, but is the one acting: notify() leaves them out.
      recipientIds: [actor.id, ...userIds],
      ...taskAssignedNotice({
        actorName,
        meetingTitle: meeting.title,
        meetingDate: formatDateTime(meeting.scheduledAt),
        description: input.description,
        dueDate: formatCalendarDate(input.dueDate),
        expectedOutcome: input.expectedOutcome,
      }),
      link: taskLink(meetingId, task.id),
    });
    return task;
  });
}

export async function updateTask(
  actor: Actor,
  taskId: string,
  rawInput: unknown,
): Promise<void> {
  await requirePermission(actor, COMMITTEES_PERMISSIONS.TASK_UPDATE);
  const viewer = await viewerFor(actor);
  const row = await loadVisibleTask(viewer, taskId);
  if (!(await rightsFor(viewer, row)).canEdit) {
    throw new ForbiddenError(
      "Only the task's creator or the meeting's organiser can edit this task.",
    );
  }
  const input = parseInput(taskSchema, rawInput);
  const { userIds, names } = normaliseAssignees(input.assignees);

  const currentUsers = assigneeUserIds(row);
  const currentNames = row.assignees.flatMap((assignee) =>
    assignee.manualName === null ? [] : [assignee.manualName],
  );
  await assertPeopleCanTakePart(actor, userIds, {
    field: "assignees",
    allowTypedName: true,
    keep: currentUsers,
  });

  const nameKey = (name: string) => name.toLowerCase();
  const addedUsers = userIds.filter((id) => !currentUsers.includes(id));
  const removedUsers = currentUsers.filter((id) => !userIds.includes(id));
  const addedNames = names.filter(
    (name) => !currentNames.some((current) => nameKey(current) === nameKey(name)),
  );
  const removedNames = currentNames.filter(
    (current) => !names.some((name) => nameKey(name) === nameKey(current)),
  );

  const changes = {
    ...diffForAudit(
      {
        description: row.description,
        expectedOutcome: row.expectedOutcome,
        dueDate: isoDateOf(row.dueDate),
      },
      {
        description: input.description,
        expectedOutcome: input.expectedOutcome,
        dueDate: input.dueDate,
      },
      ["description", "expectedOutcome"],
    ),
    ...(addedUsers.length > 0 ? { assigneeUsersAdded: addedUsers } : {}),
    ...(removedUsers.length > 0 ? { assigneeUsersRemoved: removedUsers } : {}),
    ...(addedNames.length > 0 ? { assigneeNamesAdded: addedNames } : {}),
    ...(removedNames.length > 0 ? { assigneeNamesRemoved: removedNames } : {}),
  };
  if (Object.keys(changes).length === 0) return;
  const actorName = addedUsers.length > 0 ? await displayNameOf(actor) : "";

  await prisma.$transaction(async (tx) => {
    await tx.committeeTask.update({
      where: { id: taskId },
      data: {
        description: input.description,
        expectedOutcome: input.expectedOutcome,
        dueDate: dateFromIso(input.dueDate),
        updatedBy: actor.id,
      },
    });
    const removedIds = row.assignees
      .filter(
        (assignee) =>
          (assignee.userId !== null && removedUsers.includes(assignee.userId)) ||
          (assignee.manualName !== null &&
            removedNames.some(
              (name) => nameKey(name) === nameKey(assignee.manualName ?? ""),
            )),
      )
      .map((assignee) => assignee.id);
    if (removedIds.length > 0) {
      await tx.committeeTaskAssignee.deleteMany({ where: { id: { in: removedIds } } });
    }
    const added = await tx.committeeTaskAssignee.createManyAndReturn({
      data: [
        ...addedUsers.map((userId) => ({ taskId, userId, createdBy: actor.id })),
        ...addedNames.map((manualName) => ({ taskId, manualName, createdBy: actor.id })),
      ],
      select: { id: true, userId: true },
    });
    await recordAudit(
      {
        ...auditFields(actor),
        action: "committees.task.updated",
        module: COMMITTEES_MODULE,
        entityType: "CommitteeTask",
        entityId: taskId,
        summary: `Edited a task in ${row.meeting.title}`,
        changes,
      },
      tx,
    );
    // Each person newly made responsible hears about it once, keyed on their row.
    for (const assignee of added) {
      if (assignee.userId === null) continue;
      await notify(tx, {
        type: COMMITTEES_NOTIFICATIONS.TASK_ASSIGNED,
        module: COMMITTEES_MODULE,
        entityType: "CommitteeTask",
        entityId: taskId,
        sourceId: assignee.id,
        actorId: actor.id,
        recipientIds: [assignee.userId],
        ...taskAssignedNotice({
          actorName,
          meetingTitle: row.meeting.title,
          meetingDate: formatDateTime(row.meeting.scheduledAt),
          description: input.description,
          dueDate: formatCalendarDate(input.dueDate),
          expectedOutcome: input.expectedOutcome,
        }),
        link: taskLink(row.meeting.id, taskId),
      });
    }
  });
}

/**
 * Moves a task to another status, with an optional progress comment. The change
 * is written into the task's discussion, so its history is complete, and the
 * task's creator and responsible people are told. Choosing the current status
 * with a comment simply posts the comment.
 */
export async function changeTaskStatus(
  actor: Actor,
  taskId: string,
  rawInput: unknown,
): Promise<ThreadEntry> {
  await requirePermission(actor, COMMITTEES_PERMISSIONS.TASK_UPDATE);
  const viewer = await viewerFor(actor);
  const row = await loadVisibleTask(viewer, taskId);
  if (!(await rightsFor(viewer, row)).canChangeStatus) {
    throw new ForbiddenError(
      "Only the people responsible for this task, its creator or the meeting's organiser can change its status.",
    );
  }
  const input = parseInput(statusChangeSchema, rawInput);

  if (input.status === row.status) {
    if (input.comment === null) {
      throw new BusinessRuleError(
        `This task is already ${TASK_STATUS_LABELS[row.status]}. Choose another status or write a comment.`,
      );
    }
    return replyToTask(actor, taskId, { body: input.comment });
  }

  const actorName = await displayNameOf(actor);
  return prisma.$transaction(async (tx) => {
    // Conditional: two people changing the status at once cannot both win.
    const moved = await tx.committeeTask.updateMany({
      where: { id: taskId, status: row.status, deletedAt: null },
      data: {
        status: input.status,
        completedAt: input.status === "COMPLETED" ? new Date() : null,
        updatedBy: actor.id,
      },
    });
    if (moved.count !== 1) {
      throw new ConflictError(
        "Someone changed this task a moment ago. Reload the page to see the latest.",
      );
    }
    const entry = await tx.committeeTaskReply.create({
      data: {
        taskId,
        authorId: actor.id,
        body: input.comment,
        statusFrom: row.status,
        statusTo: input.status,
      },
      select: { id: true, createdAt: true },
    });
    await recordAudit(
      {
        ...auditFields(actor),
        action: "committees.task.status_changed",
        module: COMMITTEES_MODULE,
        entityType: "CommitteeTask",
        entityId: taskId,
        summary: `Marked a task in ${row.meeting.title} ${TASK_STATUS_LABELS[input.status]}`,
        changes: { status: { from: row.status, to: input.status } },
      },
      tx,
    );
    await publish(tx, {
      name: COMMITTEES_EVENTS.TASK_STATUS_CHANGED,
      actorId: actor.id,
      correlationId: actor.correlationId ?? null,
      payload: { taskId, meetingId: row.meeting.id, from: row.status, to: input.status },
    });
    await notify(tx, {
      type: COMMITTEES_NOTIFICATIONS.TASK_STATUS_CHANGED,
      module: COMMITTEES_MODULE,
      entityType: "CommitteeTask",
      entityId: taskId,
      sourceId: entry.id,
      actorId: actor.id,
      recipientIds: [row.createdBy, ...assigneeUserIds(row)],
      ...taskStatusNotice({
        actorName,
        meetingTitle: row.meeting.title,
        description: row.description,
        statusLabel: TASK_STATUS_LABELS[input.status],
        comment: input.comment,
      }),
      link: taskLink(row.meeting.id, taskId, `reply-${entry.id}`),
    });
    return {
      id: entry.id,
      author: { id: actor.id, name: actorName },
      body: input.comment,
      statusFrom: row.status,
      statusTo: input.status,
      createdAt: entry.createdAt,
    };
  });
}

export async function replyToTask(
  actor: Actor,
  taskId: string,
  rawInput: unknown,
): Promise<ThreadEntry> {
  await requirePermission(actor, COMMITTEES_PERMISSIONS.TASK_REPLY);
  const viewer = await viewerFor(actor);
  const row = await loadVisibleTask(viewer, taskId);
  const input = parseInput(replySchema, rawInput);
  const actorName = await displayNameOf(actor);

  return prisma.$transaction(async (tx) => {
    const reply = await tx.committeeTaskReply.create({
      data: { taskId, authorId: actor.id, body: input.body },
      select: { id: true, createdAt: true },
    });
    await notify(tx, {
      type: COMMITTEES_NOTIFICATIONS.TASK_REPLIED,
      module: COMMITTEES_MODULE,
      entityType: "CommitteeTask",
      entityId: taskId,
      sourceId: reply.id,
      actorId: actor.id,
      recipientIds: [row.createdBy, ...assigneeUserIds(row)],
      ...taskReplyNotice({
        actorName,
        meetingTitle: row.meeting.title,
        description: row.description,
        reply: input.body,
      }),
      link: taskLink(row.meeting.id, taskId, `reply-${reply.id}`),
    });
    return {
      id: reply.id,
      author: { id: actor.id, name: actorName },
      body: input.body,
      statusFrom: null,
      statusTo: null,
      createdAt: reply.createdAt,
    };
  });
}

/** Committee administrators only; soft, so the discussion stays on record. */
export async function deleteTask(
  actor: Actor,
  taskId: string,
): Promise<{ meetingId: string }> {
  await requireGlobalPermission(actor, COMMITTEES_PERMISSIONS.ADMINISTER);
  const viewer = await viewerFor(actor);
  const row = await loadVisibleTask(viewer, taskId);

  await prisma.$transaction(async (tx) => {
    const deleted = await tx.committeeTask.updateMany({
      where: { id: taskId, deletedAt: null },
      data: { deletedAt: new Date(), updatedBy: actor.id },
    });
    if (deleted.count !== 1) throw new NotFoundError("task");
    await recordAudit(
      {
        ...auditFields(actor),
        action: "committees.task.deleted",
        module: COMMITTEES_MODULE,
        entityType: "CommitteeTask",
        entityId: taskId,
        summary: `Deleted a task from ${row.meeting.title}`,
        severity: "WARNING",
      },
      tx,
    );
  });
  return { meetingId: row.meeting.id };
}
