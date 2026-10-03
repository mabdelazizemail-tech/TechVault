import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { NotFoundError, ValidationError } from "@/lib/errors";
import type { Actor } from "@/platform/authz/authz";
import { canAll, canGlobally, requirePermission } from "@/platform/authz/authz";
import { COMMITTEES_PERMISSIONS } from "../contracts/permissions";
import type { PersonRef } from "../contracts/types";

/**
 * Shared plumbing for Committees services. Module-private.
 */

export const COMMITTEES_MODULE = "committees";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 404 for anything that is not a well-formed id, before any query runs. */
export function assertId(value: string, entity: string): void {
  if (!UUID_PATTERN.test(value)) throw new NotFoundError(entity);
}

export function parseInput<TSchema extends z.ZodType>(
  schema: TSchema,
  input: unknown,
  message = "Please correct the highlighted fields.",
): z.output<TSchema> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const fields: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      (fields[issue.path.join(".") || "_"] ??= []).push(issue.message);
    }
    throw new ValidationError(message, fields);
  }
  return parsed.data;
}

export function auditFields(actor: Actor) {
  return {
    actorId: actor.id,
    ipAddress: actor.ipAddress ?? null,
    userAgent: actor.userAgent ?? null,
    correlationId: actor.correlationId ?? null,
  };
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export const personSelect = {
  id: true,
  fullName: true,
  username: true,
  email: true,
  isActive: true,
  deletedAt: true,
} as const;

type PersonRow = {
  id: string;
  fullName: string | null;
  username: string | null;
  email: string;
  isActive: boolean;
  deletedAt: Date | null;
};

export function nameOf(user: PersonRow): string {
  return user.fullName ?? user.username ?? user.email;
}

export function toPerson(user: PersonRow): PersonRef {
  return { id: user.id, name: nameOf(user) };
}

export function isActivePerson(user: PersonRow): boolean {
  return user.isActive && user.deletedAt === null;
}

/* Who is looking --------------------------------------------------------------- */

export type Viewer = {
  actor: Actor;
  /** Holds committees.committee.administer organisation-wide (ADR-025). */
  isAdmin: boolean;
};

/**
 * Every read starts here: the actor must hold `committees.meeting.read`, and is an
 * administrator only with an organisation-wide administer grant — a unit-scoped one
 * must not reveal every committee in the organisation.
 */
export async function viewerFor(actor: Actor): Promise<Viewer> {
  await requirePermission(actor, COMMITTEES_PERMISSIONS.MEETING_READ);
  return { actor, isAdmin: await canGlobally(actor, COMMITTEES_PERMISSIONS.ADMINISTER) };
}

/** The member-tier rights the UI needs, in one batched evaluation. */
export async function memberRights(actor: Actor) {
  const held = await canAll(actor, [
    COMMITTEES_PERMISSIONS.MEETING_CREATE,
    COMMITTEES_PERMISSIONS.MEETING_UPDATE,
    COMMITTEES_PERMISSIONS.TASK_CREATE,
    COMMITTEES_PERMISSIONS.TASK_UPDATE,
    COMMITTEES_PERMISSIONS.TASK_REPLY,
  ]);
  return {
    meetingCreate: held[COMMITTEES_PERMISSIONS.MEETING_CREATE] === true,
    meetingUpdate: held[COMMITTEES_PERMISSIONS.MEETING_UPDATE] === true,
    taskCreate: held[COMMITTEES_PERMISSIONS.TASK_CREATE] === true,
    taskUpdate: held[COMMITTEES_PERMISSIONS.TASK_UPDATE] === true,
    taskReply: held[COMMITTEES_PERMISSIONS.TASK_REPLY] === true,
  };
}

/**
 * The meetings a person may see: those of a committee they belong to, those they
 * organise, and those where they are responsible for a live task. Administrators
 * see every live meeting. This one fragment narrows every meeting and task query,
 * so lists, counts and single reads can never disagree (§11.5).
 */
export function visibleMeetingWhere(viewer: Viewer): Prisma.CommitteeMeetingWhereInput {
  const base: Prisma.CommitteeMeetingWhereInput = {
    deletedAt: null,
    committee: { deletedAt: null },
  };
  if (viewer.isAdmin) return base;
  const userId = viewer.actor.id;
  return {
    ...base,
    OR: [
      { committee: { members: { some: { userId } } } },
      { organizerId: userId },
      { tasks: { some: { deletedAt: null, assignees: { some: { userId } } } } },
    ],
  };
}

/** The committees a person may see: their own, or every one for administrators. */
export function visibleCommitteeWhere(viewer: Viewer): Prisma.CommitteeWhereInput {
  if (viewer.isAdmin) return { deletedAt: null };
  return { deletedAt: null, members: { some: { userId: viewer.actor.id } } };
}
