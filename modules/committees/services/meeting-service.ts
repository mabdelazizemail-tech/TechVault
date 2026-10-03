import {
  BusinessRuleError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { prisma, type PrismaTransaction } from "@/lib/prisma";
import { diffForAudit, recordAudit } from "@/platform/audit/audit";
import {
  type Actor,
  requireGlobalPermission,
  requirePermission,
} from "@/platform/authz/authz";
import { publish } from "@/platform/events/publish";
import { COMMITTEES_EVENTS } from "../contracts/events";
import { COMMITTEES_PERMISSIONS } from "../contracts/permissions";
import {
  agendaItemSchema,
  meetingCreateSchema,
  meetingListParamsSchema,
  meetingUpdateSchema,
} from "../contracts/schemas";
import {
  PAGE_SIZE,
  type AgendaItemDto,
  type MeetingDetail,
  type MeetingListItem,
  type Paginated,
} from "../contracts/types";
import { meetingRights } from "../domain/tasks";
import {
  COMMITTEES_MODULE,
  assertId,
  auditFields,
  memberRights,
  parseInput,
  personSelect,
  toPerson,
  type Viewer,
  viewerFor,
  visibleCommitteeWhere,
  visibleMeetingWhere,
} from "./support";

/**
 * Meetings and their agendas. A member of a committee schedules its meetings and
 * becomes their organiser; the organiser (or a committee administrator) edits the
 * meeting and its agenda. Only administrators delete a meeting — softly, so its
 * tasks and their discussions remain on record.
 */

/** A meeting the viewer may see, or "not found" — never "forbidden" (§11.6). */
export async function loadVisibleMeeting(viewer: Viewer, meetingId: string) {
  assertId(meetingId, "meeting");
  const meeting = await prisma.committeeMeeting.findFirst({
    where: { id: meetingId, ...visibleMeetingWhere(viewer) },
    select: {
      id: true,
      title: true,
      scheduledAt: true,
      organizerId: true,
      committeeId: true,
      committee: { select: { name: true, isActive: true } },
    },
  });
  if (meeting === null) throw new NotFoundError("meeting");
  return meeting;
}

/** Task counts per meeting, open (not completed) and in total, in one query. */
async function taskCounts(meetingIds: readonly string[]) {
  const counts = new Map<string, { total: number; open: number }>();
  if (meetingIds.length === 0) return counts;
  const groups = await prisma.committeeTask.groupBy({
    by: ["meetingId", "status"],
    where: { meetingId: { in: [...meetingIds] }, deletedAt: null },
    _count: { _all: true },
  });
  for (const group of groups) {
    const entry = counts.get(group.meetingId) ?? { total: 0, open: 0 };
    entry.total += group._count._all;
    if (group.status !== "COMPLETED") entry.open += group._count._all;
    counts.set(group.meetingId, entry);
  }
  return counts;
}

const listSelect = {
  id: true,
  title: true,
  scheduledAt: true,
  location: true,
  committee: { select: { id: true, name: true } },
  organizer: { select: personSelect },
} as const;

export async function listMeetings(
  actor: Actor,
  rawParams: Record<string, unknown> = {},
): Promise<Paginated<MeetingListItem>> {
  const viewer = await viewerFor(actor);
  const params = meetingListParamsSchema.parse(rawParams);
  const now = new Date();
  const upcoming = params.when === "upcoming";

  const where = {
    ...visibleMeetingWhere(viewer),
    scheduledAt: upcoming ? { gte: now } : { lt: now },
    ...(params.committee !== undefined ? { committeeId: params.committee } : {}),
    ...(params.q !== undefined && params.q !== ""
      ? { title: { contains: params.q, mode: "insensitive" as const } }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.committeeMeeting.count({ where }),
    prisma.committeeMeeting.findMany({
      where,
      orderBy: [{ scheduledAt: upcoming ? "asc" : "desc" }, { id: "asc" }],
      skip: (params.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: listSelect,
    }),
  ]);
  const counts = await taskCounts(rows.map((row) => row.id));

  return {
    rows: rows.map((row) => ({
      id: row.id,
      title: row.title,
      committee: row.committee,
      scheduledAt: row.scheduledAt,
      location: row.location,
      organizer: toPerson(row.organizer),
      taskCount: counts.get(row.id)?.total ?? 0,
      openTaskCount: counts.get(row.id)?.open ?? 0,
    })),
    total,
    page: params.page,
    pageSize: PAGE_SIZE,
  };
}

/** The next few meetings the actor can see, for the overview. */
export async function listUpcomingMeetings(
  actor: Actor,
  limit = 6,
): Promise<MeetingListItem[]> {
  const page = await listMeetings(actor, { when: "upcoming" });
  return page.rows.slice(0, Math.min(Math.max(limit, 1), PAGE_SIZE));
}

export async function getMeeting(
  actor: Actor,
  meetingId: string,
): Promise<MeetingDetail> {
  const viewer = await viewerFor(actor);
  assertId(meetingId, "meeting");
  const row = await prisma.committeeMeeting.findFirst({
    where: { id: meetingId, ...visibleMeetingWhere(viewer) },
    select: {
      ...listSelect,
      description: true,
      organizerId: true,
      committee: {
        select: {
          id: true,
          name: true,
          isActive: true,
          members: { select: { user: { select: personSelect } } },
        },
      },
      agendaItems: {
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        select: { id: true, position: true, title: true, notes: true },
      },
    },
  });
  if (row === null) throw new NotFoundError("meeting");

  const [rights, counts] = await Promise.all([memberRights(actor), taskCounts([row.id])]);
  const allowed = meetingRights({
    actorId: actor.id,
    isAdmin: viewer.isAdmin,
    organizerId: row.organizerId,
    holdsMeetingUpdate: rights.meetingUpdate,
    holdsTaskCreate: rights.taskCreate,
  });

  return {
    id: row.id,
    title: row.title,
    committee: {
      id: row.committee.id,
      name: row.committee.name,
      isActive: row.committee.isActive,
    },
    scheduledAt: row.scheduledAt,
    location: row.location,
    description: row.description,
    organizer: toPerson(row.organizer),
    agenda: row.agendaItems,
    members: row.committee.members
      .map((member) => toPerson(member.user))
      .sort((a, b) => a.name.localeCompare(b.name)),
    taskCount: counts.get(row.id)?.total ?? 0,
    openTaskCount: counts.get(row.id)?.open ?? 0,
    rights: allowed,
  };
}

/* -------------------------------------------------------------------------- */
/* Scheduling and editing                                                     */
/* -------------------------------------------------------------------------- */

export async function createMeeting(
  actor: Actor,
  rawInput: unknown,
): Promise<{ id: string }> {
  await requirePermission(actor, COMMITTEES_PERMISSIONS.MEETING_CREATE);
  const viewer = await viewerFor(actor);
  const input = parseInput(meetingCreateSchema, rawInput);

  const committee = await prisma.committee.findFirst({
    where: { id: input.committeeId, ...visibleCommitteeWhere(viewer) },
    select: { id: true, name: true, isActive: true },
  });
  if (committee === null) {
    throw new ValidationError("Choose a committee you belong to.", {
      committeeId: ["Choose a committee you belong to."],
    });
  }
  if (!committee.isActive) {
    throw new BusinessRuleError(
      `${committee.name} is archived, so no new meetings can be scheduled for it.`,
    );
  }

  return prisma.$transaction(async (tx) => {
    const meeting = await tx.committeeMeeting.create({
      data: {
        committeeId: committee.id,
        title: input.title,
        scheduledAt: input.scheduledAt,
        location: input.location,
        description: input.description,
        organizerId: actor.id,
        createdBy: actor.id,
        updatedBy: actor.id,
      },
      select: { id: true },
    });
    await recordAudit(
      {
        ...auditFields(actor),
        action: "committees.meeting.scheduled",
        module: COMMITTEES_MODULE,
        entityType: "CommitteeMeeting",
        entityId: meeting.id,
        summary: `Scheduled meeting: ${input.title} (${committee.name})`,
      },
      tx,
    );
    await publish(tx, {
      name: COMMITTEES_EVENTS.MEETING_SCHEDULED,
      actorId: actor.id,
      correlationId: actor.correlationId ?? null,
      payload: { meetingId: meeting.id, committeeId: committee.id },
    });
    return meeting;
  });
}

/** The organiser or an administrator, holding the update permission. */
async function loadEditableMeeting(actor: Actor, meetingId: string) {
  await requirePermission(actor, COMMITTEES_PERMISSIONS.MEETING_UPDATE);
  const viewer = await viewerFor(actor);
  const meeting = await loadVisibleMeeting(viewer, meetingId);
  if (!viewer.isAdmin && meeting.organizerId !== actor.id) {
    throw new ForbiddenError("Only the meeting's organiser can change it.");
  }
  return meeting;
}

export async function updateMeeting(
  actor: Actor,
  meetingId: string,
  rawInput: unknown,
): Promise<void> {
  await loadEditableMeeting(actor, meetingId);
  const input = parseInput(meetingUpdateSchema, rawInput);
  const existing = await prisma.committeeMeeting.findUniqueOrThrow({
    where: { id: meetingId },
    select: { title: true, scheduledAt: true, location: true, description: true },
  });
  const changes = diffForAudit(existing, input, ["description"]);
  if (Object.keys(changes).length === 0) return;

  await prisma.$transaction(async (tx) => {
    await tx.committeeMeeting.update({
      where: { id: meetingId },
      data: { ...input, updatedBy: actor.id },
    });
    await recordAudit(
      {
        ...auditFields(actor),
        action: "committees.meeting.updated",
        module: COMMITTEES_MODULE,
        entityType: "CommitteeMeeting",
        entityId: meetingId,
        summary: `Edited meeting: ${input.title}`,
        changes,
      },
      tx,
    );
  });
}

export async function deleteMeeting(actor: Actor, meetingId: string): Promise<void> {
  await requireGlobalPermission(actor, COMMITTEES_PERMISSIONS.ADMINISTER);
  const viewer = await viewerFor(actor);
  const meeting = await loadVisibleMeeting(viewer, meetingId);

  await prisma.$transaction(async (tx) => {
    const updated = await tx.committeeMeeting.updateMany({
      where: { id: meetingId, deletedAt: null },
      data: { deletedAt: new Date(), updatedBy: actor.id },
    });
    if (updated.count !== 1) throw new NotFoundError("meeting");
    await recordAudit(
      {
        ...auditFields(actor),
        action: "committees.meeting.deleted",
        module: COMMITTEES_MODULE,
        entityType: "CommitteeMeeting",
        entityId: meetingId,
        summary: `Deleted meeting: ${meeting.title} (${meeting.committee.name})`,
        severity: "WARNING",
      },
      tx,
    );
  });
}

/* -------------------------------------------------------------------------- */
/* Agenda                                                                     */
/* -------------------------------------------------------------------------- */

async function loadEditableAgendaItem(actor: Actor, itemId: string) {
  assertId(itemId, "agenda item");
  const item = await prisma.committeeAgendaItem.findUnique({
    where: { id: itemId },
    select: { id: true, meetingId: true, title: true, notes: true },
  });
  if (item === null) throw new NotFoundError("agenda item");
  await loadEditableMeeting(actor, item.meetingId);
  return item;
}

async function auditAgenda(
  tx: PrismaTransaction,
  actor: Actor,
  meetingId: string,
  action: string,
  summary: string,
  changes?: Record<string, unknown>,
) {
  await recordAudit(
    {
      ...auditFields(actor),
      action,
      module: COMMITTEES_MODULE,
      entityType: "CommitteeMeeting",
      entityId: meetingId,
      summary,
      changes: changes ?? null,
    },
    tx,
  );
}

export async function addAgendaItem(
  actor: Actor,
  meetingId: string,
  rawInput: unknown,
): Promise<AgendaItemDto> {
  const meeting = await loadEditableMeeting(actor, meetingId);
  const input = parseInput(agendaItemSchema, rawInput);

  return prisma.$transaction(async (tx) => {
    const last = await tx.committeeAgendaItem.aggregate({
      where: { meetingId },
      _max: { position: true },
    });
    const item = await tx.committeeAgendaItem.create({
      data: {
        meetingId,
        position: (last._max.position ?? -1) + 1,
        title: input.title,
        notes: input.notes,
        createdBy: actor.id,
        updatedBy: actor.id,
      },
      select: { id: true, position: true, title: true, notes: true },
    });
    await auditAgenda(
      tx,
      actor,
      meetingId,
      "committees.agenda.item_added",
      `Added to the agenda of ${meeting.title}: ${input.title}`,
    );
    return item;
  });
}

export async function updateAgendaItem(
  actor: Actor,
  itemId: string,
  rawInput: unknown,
): Promise<void> {
  const item = await loadEditableAgendaItem(actor, itemId);
  const input = parseInput(agendaItemSchema, rawInput);
  const changes = diffForAudit({ title: item.title, notes: item.notes }, input);
  if (Object.keys(changes).length === 0) return;

  await prisma.$transaction(async (tx) => {
    await tx.committeeAgendaItem.update({
      where: { id: itemId },
      data: { ...input, updatedBy: actor.id },
    });
    await auditAgenda(
      tx,
      actor,
      item.meetingId,
      "committees.agenda.item_updated",
      `Edited agenda item: ${input.title}`,
      changes,
    );
  });
}

/** Removes an agenda item. The audit record keeps what it said. */
export async function removeAgendaItem(actor: Actor, itemId: string): Promise<void> {
  const item = await loadEditableAgendaItem(actor, itemId);
  await prisma.$transaction(async (tx) => {
    await tx.committeeAgendaItem.delete({ where: { id: itemId } });
    await auditAgenda(
      tx,
      actor,
      item.meetingId,
      "committees.agenda.item_removed",
      `Removed agenda item: ${item.title}`,
      { title: item.title, notes: item.notes },
    );
  });
}

/** Moves an agenda item one place up or down, renumbering the agenda from 0. */
export async function moveAgendaItem(
  actor: Actor,
  itemId: string,
  direction: "up" | "down",
): Promise<void> {
  const item = await loadEditableAgendaItem(actor, itemId);
  await prisma.$transaction(async (tx) => {
    const items = await tx.committeeAgendaItem.findMany({
      where: { meetingId: item.meetingId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: { id: true, position: true },
    });
    const from = items.findIndex((candidate) => candidate.id === itemId);
    const to = direction === "up" ? from - 1 : from + 1;
    if (from < 0 || to < 0 || to >= items.length) return;
    const order = items.map((candidate) => candidate.id);
    [order[from], order[to]] = [order[to] as string, order[from] as string];
    for (const [position, id] of order.entries()) {
      if (items.find((candidate) => candidate.id === id)?.position !== position) {
        await tx.committeeAgendaItem.update({ where: { id }, data: { position } });
      }
    }
    await auditAgenda(
      tx,
      actor,
      item.meetingId,
      "committees.agenda.reordered",
      `Moved agenda item ${direction}: ${item.title}`,
    );
  });
}
