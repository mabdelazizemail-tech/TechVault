import { Prisma } from "@prisma/client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { diffForAudit, recordAudit } from "@/platform/audit/audit";
import { type Actor, requirePermission } from "@/platform/authz/authz";
import { publish } from "@/platform/events/publish";
import { INNOVATION_EVENTS } from "../contracts/events";
import { INNOVATION_PERMISSIONS } from "../contracts/permissions";
import { knowledgeSchema, listParamsSchema } from "../contracts/schemas";
import {
  PAGE_SIZE,
  type KnowledgeDetail,
  type KnowledgeListItem,
  type Paginated,
} from "../contracts/types";
import { toPrefixQuery } from "../domain/search";
import { markFileReady, verifyUploadedFile } from "./file-service";
import {
  INNOVATION_MODULE,
  assertId,
  auditFields,
  excerptOf,
  fileSelect,
  inIdOrder,
  parseInput,
  personSelect,
  toFile,
  toPerson,
} from "./support";

/**
 * The knowledge library: documents, SOPs, best practices, lessons learned and
 * templates. Anyone may add; administrators edit and delete.
 */

export const knowledgeListSelect = {
  id: true,
  title: true,
  description: true,
  tags: true,
  updatedAt: true,
  category: { select: { id: true, name: true } },
  owner: { select: personSelect },
  file: { select: fileSelect },
  project: { select: { id: true, name: true, deletedAt: true } },
} satisfies Prisma.InnovationKnowledgeItemSelect;

type ListRow = Prisma.InnovationKnowledgeItemGetPayload<{
  select: typeof knowledgeListSelect;
}>;

export function toKnowledgeListItem(row: ListRow): KnowledgeListItem {
  return {
    id: row.id,
    title: row.title,
    excerpt: excerptOf(row.description),
    category: row.category,
    tags: row.tags,
    owner: toPerson(row.owner),
    file: toFile(row.file),
    project:
      row.project !== null && row.project.deletedAt === null
        ? { id: row.project.id, name: row.project.name }
        : null,
    updatedAt: row.updatedAt,
  };
}

export async function listKnowledge(
  actor: Actor,
  rawParams: Record<string, unknown> = {},
): Promise<Paginated<KnowledgeListItem>> {
  await requirePermission(actor, INNOVATION_PERMISSIONS.KNOWLEDGE_READ);
  const params = listParamsSchema.parse(rawParams);
  const prefix = toPrefixQuery(params.q);
  const query = prefix !== null ? Prisma.sql`to_tsquery('simple', ${prefix})` : null;

  const hits = await prisma.$queryRaw<{ id: string; total: bigint }[]>`
    SELECT k.id, count(*) OVER () AS total
      FROM innovation.knowledge_items k
     WHERE k.deleted_at IS NULL
       ${params.category !== undefined ? Prisma.sql`AND k.category_id = ${params.category}::uuid` : Prisma.empty}
       ${query !== null ? Prisma.sql`AND innovation.knowledge_search(k.title, k.description, k.tags) @@ ${query}` : Prisma.empty}
     ORDER BY ${query !== null ? Prisma.sql`ts_rank(innovation.knowledge_search(k.title, k.description, k.tags), ${query}) DESC,` : Prisma.empty}
              k.updated_at DESC, k.id DESC
     LIMIT ${PAGE_SIZE} OFFSET ${(params.page - 1) * PAGE_SIZE}
  `;

  const ids = hits.map((hit) => hit.id);
  const rows =
    ids.length === 0
      ? []
      : await prisma.innovationKnowledgeItem.findMany({
          where: { id: { in: ids } },
          select: knowledgeListSelect,
        });

  return {
    rows: inIdOrder(ids, rows).map(toKnowledgeListItem),
    total: Number(hits[0]?.total ?? 0),
    page: params.page,
    pageSize: PAGE_SIZE,
  };
}

export async function getKnowledgeItem(
  actor: Actor,
  itemId: string,
): Promise<KnowledgeDetail> {
  await requirePermission(actor, INNOVATION_PERMISSIONS.KNOWLEDGE_READ);
  assertId(itemId, "knowledge item");
  const row = await prisma.innovationKnowledgeItem.findFirst({
    where: { id: itemId, deletedAt: null },
    select: { ...knowledgeListSelect, categoryId: true, createdAt: true },
  });
  if (row === null) throw new NotFoundError("knowledge item");
  return {
    ...toKnowledgeListItem(row),
    description: row.description,
    categoryId: row.categoryId,
    createdAt: row.createdAt,
  };
}

async function assertReferences(
  input: { categoryId: string; projectId: string | null },
  current?: { categoryId: string; projectId: string | null },
): Promise<void> {
  const category = await prisma.innovationCategory.findFirst({
    where: { id: input.categoryId, kind: "KNOWLEDGE" },
    select: { id: true, isActive: true },
  });
  if (category === null || (!category.isActive && category.id !== current?.categoryId)) {
    throw new ValidationError("Choose a category.", {
      categoryId: ["Choose a category."],
    });
  }
  if (input.projectId !== null && input.projectId !== current?.projectId) {
    const project = await prisma.innovationProject.findFirst({
      where: { id: input.projectId, deletedAt: null },
      select: { id: true },
    });
    if (project === null) {
      throw new ValidationError("That project no longer exists.", {
        projectId: ["That project no longer exists."],
      });
    }
  }
}

export async function createKnowledgeItem(
  actor: Actor,
  rawInput: unknown,
): Promise<{ id: string }> {
  await requirePermission(actor, INNOVATION_PERMISSIONS.KNOWLEDGE_CREATE);
  const input = parseInput(knowledgeSchema, rawInput);
  await assertReferences(input);
  if (input.fileId !== null) await verifyUploadedFile(actor, input.fileId);

  return prisma.$transaction(async (tx) => {
    if (input.fileId !== null) await markFileReady(tx, actor, input.fileId);
    const item = await tx.innovationKnowledgeItem.create({
      data: {
        title: input.title,
        description: input.description,
        categoryId: input.categoryId,
        tags: input.tags,
        fileId: input.fileId,
        projectId: input.projectId,
        ownerId: actor.id,
        createdBy: actor.id,
        updatedBy: actor.id,
      },
      select: { id: true },
    });
    await recordAudit(
      {
        ...auditFields(actor),
        action: "innovation.knowledge.added",
        module: INNOVATION_MODULE,
        entityType: "InnovationKnowledgeItem",
        entityId: item.id,
        summary: `Added knowledge: ${input.title}`,
      },
      tx,
    );
    await publish(tx, {
      name: INNOVATION_EVENTS.KNOWLEDGE_ADDED,
      actorId: actor.id,
      correlationId: actor.correlationId ?? null,
      payload: {
        knowledgeItemId: item.id,
        categoryId: input.categoryId,
        projectId: input.projectId,
      },
    });
    return item;
  });
}

export async function updateKnowledgeItem(
  actor: Actor,
  itemId: string,
  rawInput: unknown,
): Promise<void> {
  await requirePermission(actor, INNOVATION_PERMISSIONS.KNOWLEDGE_ADMINISTER);
  assertId(itemId, "knowledge item");
  const existing = await prisma.innovationKnowledgeItem.findFirst({
    where: { id: itemId, deletedAt: null },
    select: {
      title: true,
      description: true,
      categoryId: true,
      tags: true,
      fileId: true,
      projectId: true,
    },
  });
  if (existing === null) throw new NotFoundError("knowledge item");

  const input = parseInput(knowledgeSchema, rawInput);
  await assertReferences(input, existing);
  const replacingFile = input.fileId !== null && input.fileId !== existing.fileId;
  if (replacingFile && input.fileId !== null)
    await verifyUploadedFile(actor, input.fileId);

  const after = {
    ...input,
    // An edit without a new upload keeps the current file.
    fileId: input.fileId ?? existing.fileId,
  };
  const changes = diffForAudit(
    { ...existing, tags: existing.tags.join(", ") },
    { ...after, tags: after.tags.join(", ") },
    ["description"],
  );
  if (Object.keys(changes).length === 0) return;

  await prisma.$transaction(async (tx) => {
    if (replacingFile && input.fileId !== null)
      await markFileReady(tx, actor, input.fileId);
    await tx.innovationKnowledgeItem.update({
      where: { id: itemId },
      data: { ...after, updatedBy: actor.id },
    });
    await recordAudit(
      {
        ...auditFields(actor),
        action: "innovation.knowledge.updated",
        module: INNOVATION_MODULE,
        entityType: "InnovationKnowledgeItem",
        entityId: itemId,
        summary: `Edited knowledge: ${input.title}`,
        changes,
      },
      tx,
    );
  });
}

export async function deleteKnowledgeItem(actor: Actor, itemId: string): Promise<void> {
  await requirePermission(actor, INNOVATION_PERMISSIONS.KNOWLEDGE_ADMINISTER);
  assertId(itemId, "knowledge item");
  const existing = await prisma.innovationKnowledgeItem.findFirst({
    where: { id: itemId, deletedAt: null },
    select: { title: true },
  });
  if (existing === null) throw new NotFoundError("knowledge item");

  await prisma.$transaction(async (tx) => {
    await tx.innovationKnowledgeItem.update({
      where: { id: itemId },
      data: { deletedAt: new Date(), updatedBy: actor.id },
    });
    await recordAudit(
      {
        ...auditFields(actor),
        action: "innovation.knowledge.deleted",
        module: INNOVATION_MODULE,
        entityType: "InnovationKnowledgeItem",
        entityId: itemId,
        summary: `Deleted knowledge: ${existing.title}`,
        severity: "WARNING",
      },
      tx,
    );
  });
}
