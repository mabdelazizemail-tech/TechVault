import { ConflictError, NotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { diffForAudit, recordAudit } from "@/platform/audit/audit";
import { type Actor, canGlobally, requireGlobalPermission } from "@/platform/authz/authz";
import { publish } from "@/platform/events/publish";
import { COMMITTEES_EVENTS } from "../contracts/events";
import { COMMITTEES_PERMISSIONS } from "../contracts/permissions";
import {
  committeeCreateSchema,
  committeeListParamsSchema,
  committeeUpdateSchema,
} from "../contracts/schemas";
import {
  PAGE_SIZE,
  type CommitteeDetail,
  type CommitteeListItem,
  type Paginated,
} from "../contracts/types";
import { assertPeopleCanTakePart } from "./people";
import {
  COMMITTEES_MODULE,
  assertId,
  auditFields,
  isActivePerson,
  isUniqueViolation,
  memberRights,
  parseInput,
  personSelect,
  toPerson,
  viewerFor,
  visibleCommitteeWhere,
} from "./support";

/**
 * Committees: who sits on which. Members see their committees; administrators
 * create committees, choose their members and archive them. There is no delete:
 * a committee's meetings and tasks are its record, so a finished committee is
 * archived and keeps them.
 */

const DUPLICATE_NAME = "Another committee already has this name.";

export async function listCommittees(
  actor: Actor,
  rawParams: Record<string, unknown> = {},
): Promise<Paginated<CommitteeListItem>> {
  const viewer = await viewerFor(actor);
  const params = committeeListParamsSchema.parse(rawParams);
  const now = new Date();

  const where = {
    ...visibleCommitteeWhere(viewer),
    isActive: params.show === "active",
    ...(params.q !== undefined && params.q !== ""
      ? { name: { contains: params.q, mode: "insensitive" as const } }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.committee.count({ where }),
    prisma.committee.findMany({
      where,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: (params.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        name: true,
        description: true,
        isActive: true,
        _count: { select: { members: true } },
        members: { where: { userId: actor.id }, select: { userId: true }, take: 1 },
        meetings: {
          where: { deletedAt: null, scheduledAt: { gte: now } },
          orderBy: { scheduledAt: "asc" },
          take: 1,
          select: { scheduledAt: true },
        },
      },
    }),
  ]);

  return {
    rows: rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      isActive: row.isActive,
      memberCount: row._count.members,
      isMember: row.members.length > 0,
      nextMeetingAt: row.meetings[0]?.scheduledAt ?? null,
    })),
    total,
    page: params.page,
    pageSize: PAGE_SIZE,
  };
}

/** The committees the actor may schedule a meeting for: active, and theirs. */
export async function listSchedulableCommittees(
  actor: Actor,
): Promise<{ id: string; name: string }[]> {
  const viewer = await viewerFor(actor);
  const rights = await memberRights(actor);
  if (!rights.meetingCreate) return [];
  return prisma.committee.findMany({
    where: { ...visibleCommitteeWhere(viewer), isActive: true },
    orderBy: { name: "asc" },
    take: 200,
    select: { id: true, name: true },
  });
}

/** Committees for a filter: every one the actor can see, archived included. */
export async function listCommitteeOptions(
  actor: Actor,
): Promise<{ id: string; name: string }[]> {
  const viewer = await viewerFor(actor);
  return prisma.committee.findMany({
    where: visibleCommitteeWhere(viewer),
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    take: 200,
    select: { id: true, name: true },
  });
}

export async function getCommittee(
  actor: Actor,
  committeeId: string,
): Promise<CommitteeDetail> {
  const viewer = await viewerFor(actor);
  assertId(committeeId, "committee");
  const row = await prisma.committee.findFirst({
    where: { id: committeeId, ...visibleCommitteeWhere(viewer) },
    select: {
      id: true,
      name: true,
      description: true,
      isActive: true,
      createdAt: true,
      members: {
        orderBy: { createdAt: "asc" },
        select: { user: { select: personSelect } },
      },
    },
  });
  if (row === null) throw new NotFoundError("committee");

  const rights = await memberRights(actor);
  const members = row.members
    .map((member) => ({
      ...toPerson(member.user),
      isActive: isActivePerson(member.user),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const isMember = members.some((member) => member.id === actor.id);

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isActive: row.isActive,
    createdAt: row.createdAt,
    members,
    isMember,
    rights: {
      canSchedule: row.isActive && rights.meetingCreate && (isMember || viewer.isAdmin),
      canAdminister: viewer.isAdmin,
    },
  };
}

export async function createCommittee(
  actor: Actor,
  rawInput: unknown,
): Promise<{ id: string }> {
  await requireGlobalPermission(actor, COMMITTEES_PERMISSIONS.ADMINISTER);
  const input = parseInput(committeeCreateSchema, rawInput);
  await assertPeopleCanTakePart(actor, input.memberIds, {
    field: "memberIds",
    allowTypedName: false,
  });

  try {
    return await prisma.$transaction(async (tx) => {
      const committee = await tx.committee.create({
        data: {
          name: input.name,
          description: input.description,
          createdBy: actor.id,
          updatedBy: actor.id,
          members: {
            create: input.memberIds.map((userId) => ({ userId, createdBy: actor.id })),
          },
        },
        select: { id: true },
      });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "committees.committee.created",
          module: COMMITTEES_MODULE,
          entityType: "Committee",
          entityId: committee.id,
          summary: `Created committee: ${input.name}`,
          changes: { memberIds: input.memberIds },
        },
        tx,
      );
      await publish(tx, {
        name: COMMITTEES_EVENTS.COMMITTEE_CREATED,
        actorId: actor.id,
        correlationId: actor.correlationId ?? null,
        payload: { committeeId: committee.id },
      });
      return committee;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError(DUPLICATE_NAME);
    throw error;
  }
}

export async function updateCommittee(
  actor: Actor,
  committeeId: string,
  rawInput: unknown,
): Promise<void> {
  await requireGlobalPermission(actor, COMMITTEES_PERMISSIONS.ADMINISTER);
  assertId(committeeId, "committee");
  const existing = await prisma.committee.findFirst({
    where: { id: committeeId, deletedAt: null },
    select: {
      name: true,
      description: true,
      isActive: true,
      members: { select: { userId: true } },
    },
  });
  if (existing === null) throw new NotFoundError("committee");
  const input = parseInput(committeeUpdateSchema, rawInput);

  const current = existing.members.map((member) => member.userId);
  await assertPeopleCanTakePart(actor, input.memberIds, {
    field: "memberIds",
    allowTypedName: false,
    keep: current,
  });
  const added = input.memberIds.filter((id) => !current.includes(id));
  const removed = current.filter((id) => !input.memberIds.includes(id));

  const changes = {
    ...diffForAudit(
      {
        name: existing.name,
        description: existing.description,
        isActive: existing.isActive,
      },
      { name: input.name, description: input.description, isActive: input.isActive },
    ),
    ...(added.length > 0 ? { membersAdded: added } : {}),
    ...(removed.length > 0 ? { membersRemoved: removed } : {}),
  };
  if (Object.keys(changes).length === 0) return;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.committee.update({
        where: { id: committeeId },
        data: {
          name: input.name,
          description: input.description,
          isActive: input.isActive,
          updatedBy: actor.id,
        },
      });
      if (removed.length > 0) {
        await tx.committeeMember.deleteMany({
          where: { committeeId, userId: { in: removed } },
        });
      }
      if (added.length > 0) {
        await tx.committeeMember.createMany({
          data: added.map((userId) => ({ committeeId, userId, createdBy: actor.id })),
          skipDuplicates: true,
        });
      }
      await recordAudit(
        {
          ...auditFields(actor),
          action: "committees.committee.updated",
          module: COMMITTEES_MODULE,
          entityType: "Committee",
          entityId: committeeId,
          summary:
            existing.isActive && !input.isActive
              ? `Archived committee: ${input.name}`
              : `Edited committee: ${input.name}`,
          changes,
        },
        tx,
      );
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError(DUPLICATE_NAME);
    throw error;
  }
}

/** Whether the actor may create committees — for showing the button. */
export async function canAdministerCommittees(actor: Actor): Promise<boolean> {
  return canGlobally(actor, COMMITTEES_PERMISSIONS.ADMINISTER);
}
