import { Prisma } from "@prisma/client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { diffForAudit, recordAudit } from "@/platform/audit/audit";
import { type Actor, requirePermission } from "@/platform/authz/authz";
import { publish } from "@/platform/events/publish";
import { findDirectoryPeople } from "@/platform/iam/services/directory-service";
import { INNOVATION_EVENTS } from "../contracts/events";
import { INNOVATION_PERMISSIONS } from "../contracts/permissions";
import { listParamsSchema, projectSchema } from "../contracts/schemas";
import {
  PAGE_SIZE,
  PROJECT_STATUSES,
  type Paginated,
  type ProjectDetail,
  type ProjectListItem,
} from "../contracts/types";
import { toPrefixQuery } from "../domain/search";
import { knowledgeListSelect, toKnowledgeListItem } from "./knowledge-service";
import {
  INNOVATION_MODULE,
  assertId,
  auditFields,
  excerptOf,
  inIdOrder,
  parseInput,
  personSelect,
  toPerson,
} from "./support";

/**
 * Projects: what approved ideas become. Deliberately light — a description, an
 * owner and team, a status, linked documents and lessons learned. Not a project
 * management system (ADR-021).
 */

const listSelect = {
  id: true,
  name: true,
  description: true,
  status: true,
  updatedAt: true,
  owner: { select: personSelect },
  idea: { select: { id: true, title: true, deletedAt: true } },
  _count: {
    select: { members: true, documents: { where: { deletedAt: null } } },
  },
} satisfies Prisma.InnovationProjectSelect;

export async function listProjects(
  actor: Actor,
  rawParams: Record<string, unknown> = {},
): Promise<Paginated<ProjectListItem>> {
  await requirePermission(actor, INNOVATION_PERMISSIONS.PROJECT_READ);
  const params = listParamsSchema.parse(rawParams);
  const status = PROJECT_STATUSES.find((value) => value === params.status);
  const prefix = toPrefixQuery(params.q);

  const hits = await prisma.$queryRaw<{ id: string; total: bigint }[]>`
    SELECT p.id, count(*) OVER () AS total
      FROM innovation.projects p
     WHERE p.deleted_at IS NULL
       ${status !== undefined ? Prisma.sql`AND p.status = ${status}::innovation."InnovationProjectStatus"` : Prisma.empty}
       ${prefix !== null ? Prisma.sql`AND innovation.project_search(p.name, p.description, p.lessons_learned) @@ to_tsquery('simple', ${prefix})` : Prisma.empty}
     ORDER BY p.updated_at DESC, p.id DESC
     LIMIT ${PAGE_SIZE} OFFSET ${(params.page - 1) * PAGE_SIZE}
  `;

  const ids = hits.map((hit) => hit.id);
  const rows =
    ids.length === 0
      ? []
      : await prisma.innovationProject.findMany({
          where: { id: { in: ids } },
          select: listSelect,
        });

  return {
    rows: inIdOrder(ids, rows).map((row) => ({
      id: row.id,
      name: row.name,
      excerpt: excerptOf(row.description),
      status: row.status,
      owner: toPerson(row.owner),
      memberCount: row._count.members,
      documentCount: row._count.documents,
      idea:
        row.idea !== null && row.idea.deletedAt === null
          ? { id: row.idea.id, name: row.idea.title }
          : null,
      updatedAt: row.updatedAt,
    })),
    total: Number(hits[0]?.total ?? 0),
    page: params.page,
    pageSize: PAGE_SIZE,
  };
}

export async function getProject(
  actor: Actor,
  projectId: string,
): Promise<ProjectDetail> {
  await requirePermission(actor, INNOVATION_PERMISSIONS.PROJECT_READ);
  assertId(projectId, "project");

  const row = await prisma.innovationProject.findFirst({
    where: { id: projectId, deletedAt: null },
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      lessonsLearned: true,
      createdAt: true,
      updatedAt: true,
      owner: { select: personSelect },
      idea: { select: { id: true, title: true, deletedAt: true } },
      members: {
        orderBy: { createdAt: "asc" },
        select: { user: { select: personSelect } },
      },
      documents: {
        where: { deletedAt: null },
        orderBy: { updatedAt: "desc" },
        take: 50,
        select: knowledgeListSelect,
      },
    },
  });
  if (row === null) throw new NotFoundError("project");

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    lessonsLearned: row.lessonsLearned,
    owner: toPerson(row.owner),
    idea:
      row.idea !== null && row.idea.deletedAt === null
        ? { id: row.idea.id, name: row.idea.title }
        : null,
    members: row.members.flatMap((member) => {
      const person = toPerson(member.user);
      return person === null ? [] : [person];
    }),
    documents: row.documents.map(toKnowledgeListItem),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Owner and new team members must be active colleagues. */
async function assertPeople(
  actor: Actor,
  input: { ownerId: string | null; memberIds: string[] },
  currentMemberIds: readonly string[] = [],
  currentOwnerId: string | null = null,
): Promise<void> {
  const toCheck = [
    ...new Set([
      ...(input.ownerId !== null && input.ownerId !== currentOwnerId
        ? [input.ownerId]
        : []),
      ...input.memberIds.filter((id) => !currentMemberIds.includes(id)),
    ]),
  ];
  if (toCheck.length === 0) return;
  const people = await findDirectoryPeople(actor, toCheck);
  const active = new Set(people.filter((person) => person.isActive).map((p) => p.id));
  if (toCheck.some((id) => !active.has(id))) {
    throw new ValidationError("Choose active colleagues for the owner and team.", {
      memberIds: ["Choose active colleagues for the owner and team."],
    });
  }
}

export async function createProject(
  actor: Actor,
  rawInput: unknown,
): Promise<{ id: string }> {
  await requirePermission(actor, INNOVATION_PERMISSIONS.PROJECT_ADMINISTER);
  const input = parseInput(projectSchema, rawInput);
  await assertPeople(actor, input);
  const memberIds = [
    ...new Set([...input.memberIds, ...(input.ownerId !== null ? [input.ownerId] : [])]),
  ];

  return prisma.$transaction(async (tx) => {
    const project = await tx.innovationProject.create({
      data: {
        name: input.name,
        description: input.description,
        ownerId: input.ownerId,
        status: input.status,
        lessonsLearned: input.lessonsLearned,
        createdBy: actor.id,
        updatedBy: actor.id,
        members: { create: memberIds.map((userId) => ({ userId })) },
      },
      select: { id: true },
    });
    await recordAudit(
      {
        ...auditFields(actor),
        action: "innovation.project.created",
        module: INNOVATION_MODULE,
        entityType: "InnovationProject",
        entityId: project.id,
        summary: `Created project: ${input.name}`,
      },
      tx,
    );
    await publish(tx, {
      name: INNOVATION_EVENTS.PROJECT_CREATED,
      actorId: actor.id,
      correlationId: actor.correlationId ?? null,
      payload: { projectId: project.id, ideaId: null },
    });
    return project;
  });
}

export async function updateProject(
  actor: Actor,
  projectId: string,
  rawInput: unknown,
): Promise<void> {
  await requirePermission(actor, INNOVATION_PERMISSIONS.PROJECT_ADMINISTER);
  assertId(projectId, "project");
  const existing = await prisma.innovationProject.findFirst({
    where: { id: projectId, deletedAt: null },
    select: {
      name: true,
      description: true,
      ownerId: true,
      status: true,
      lessonsLearned: true,
      members: { select: { userId: true } },
    },
  });
  if (existing === null) throw new NotFoundError("project");

  const input = parseInput(projectSchema, rawInput);
  const currentMemberIds = existing.members.map((member) => member.userId);
  await assertPeople(actor, input, currentMemberIds, existing.ownerId);
  const memberIds = [
    ...new Set([...input.memberIds, ...(input.ownerId !== null ? [input.ownerId] : [])]),
  ];

  const { members: _members, ...before } = existing;
  const { memberIds: _memberIds, ...after } = input;
  const changes = diffForAudit(
    { ...before, team: [...currentMemberIds].sort().join(",") },
    { ...after, team: [...memberIds].sort().join(",") },
    ["description", "lessonsLearned"],
  );
  if (Object.keys(changes).length === 0) return;

  await prisma.$transaction(async (tx) => {
    await tx.innovationProject.update({
      where: { id: projectId },
      data: { ...after, updatedBy: actor.id },
    });
    await tx.innovationProjectMember.deleteMany({
      where: { projectId, userId: { notIn: memberIds } },
    });
    await tx.innovationProjectMember.createMany({
      data: memberIds.map((userId) => ({ projectId, userId })),
      skipDuplicates: true,
    });
    await recordAudit(
      {
        ...auditFields(actor),
        action: "innovation.project.updated",
        module: INNOVATION_MODULE,
        entityType: "InnovationProject",
        entityId: projectId,
        summary: `Updated project: ${input.name}`,
        changes,
      },
      tx,
    );
  });
}

export async function deleteProject(actor: Actor, projectId: string): Promise<void> {
  await requirePermission(actor, INNOVATION_PERMISSIONS.PROJECT_ADMINISTER);
  assertId(projectId, "project");
  const existing = await prisma.innovationProject.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { name: true },
  });
  if (existing === null) throw new NotFoundError("project");

  await prisma.$transaction(async (tx) => {
    await tx.innovationProject.update({
      where: { id: projectId },
      data: { deletedAt: new Date(), updatedBy: actor.id },
    });
    await recordAudit(
      {
        ...auditFields(actor),
        action: "innovation.project.deleted",
        module: INNOVATION_MODULE,
        entityType: "InnovationProject",
        entityId: projectId,
        summary: `Deleted project: ${existing.name}`,
        severity: "WARNING",
      },
      tx,
    );
  });
}
