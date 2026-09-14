import { Prisma } from "@prisma/client";
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { diffForAudit, recordAudit } from "@/platform/audit/audit";
import { type Actor, can, requirePermission } from "@/platform/authz/authz";
import { publish } from "@/platform/events/publish";
import { findDirectoryPeople } from "@/platform/iam/services/directory-service";
import { INNOVATION_EVENTS } from "../contracts/events";
import { INNOVATION_PERMISSIONS } from "../contracts/permissions";
import {
  commentSchema,
  ideaCreateSchema,
  ideaUpdateSchema,
  listParamsSchema,
} from "../contracts/schemas";
import {
  IDEA_STATUSES,
  IDEA_STATUS_LABELS,
  PAGE_SIZE,
  type CommentDto,
  type IdeaDetail,
  type IdeaListItem,
  type IdeaStatus,
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
  isUniqueViolation,
  parseInput,
  personSelect,
  toFile,
  toPerson,
} from "./support";

/**
 * Ideas: submit, browse, vote, comment — and, for administrators, review, assign,
 * edit, delete and turn approved ideas into projects.
 *
 * Statuses are a plain field an administrator sets (ADR-021), not a workflow.
 */

const listSelect = (actorId: string) =>
  ({
    id: true,
    title: true,
    description: true,
    status: true,
    voteCount: true,
    commentCount: true,
    createdAt: true,
    createdBy: true,
    attachmentFileId: true,
    category: { select: { id: true, name: true } },
    submitter: { select: personSelect },
    owner: { select: personSelect },
    votes: { where: { userId: actorId }, select: { userId: true }, take: 1 },
  }) satisfies Prisma.InnovationIdeaSelect;

type ListRow = Prisma.InnovationIdeaGetPayload<{ select: ReturnType<typeof listSelect> }>;

function toListItem(row: ListRow, actorId: string): IdeaListItem {
  return {
    id: row.id,
    title: row.title,
    excerpt: excerptOf(row.description),
    status: row.status,
    category: row.category,
    submitter: toPerson(row.submitter) ?? { id: row.createdBy, name: "Unknown" },
    owner: toPerson(row.owner),
    voteCount: row.voteCount,
    commentCount: row.commentCount,
    hasVoted: row.votes.length > 0,
    isMine: row.createdBy === actorId,
    hasAttachment: row.attachmentFileId !== null,
    createdAt: row.createdAt,
  };
}

async function findLiveIdea(ideaId: string) {
  assertId(ideaId, "idea");
  const idea = await prisma.innovationIdea.findFirst({
    where: { id: ideaId, deletedAt: null },
    select: {
      id: true,
      title: true,
      description: true,
      categoryId: true,
      status: true,
      ownerId: true,
      createdBy: true,
    },
  });
  if (idea === null) throw new NotFoundError("idea");
  return idea;
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

export async function listIdeas(
  actor: Actor,
  rawParams: Record<string, unknown> = {},
): Promise<Paginated<IdeaListItem>> {
  await requirePermission(actor, INNOVATION_PERMISSIONS.IDEA_READ);
  const params = listParamsSchema.parse(rawParams);
  const status = IDEA_STATUSES.find((value) => value === params.status);
  const prefix = toPrefixQuery(params.q);

  // Ids first, through the indexes; then the rows, by id.
  const hits = await prisma.$queryRaw<{ id: string; total: bigint }[]>`
    SELECT i.id, count(*) OVER () AS total
      FROM innovation.ideas i
     WHERE i.deleted_at IS NULL
       ${status !== undefined ? Prisma.sql`AND i.status = ${status}::innovation."InnovationIdeaStatus"` : Prisma.empty}
       ${params.category !== undefined ? Prisma.sql`AND i.category_id = ${params.category}::uuid` : Prisma.empty}
       ${prefix !== null ? Prisma.sql`AND innovation.idea_search(i.title, i.description) @@ to_tsquery('simple', ${prefix})` : Prisma.empty}
     ORDER BY ${
       params.sort === "top"
         ? Prisma.sql`i.vote_count DESC,`
         : params.sort === "comments"
           ? Prisma.sql`i.comment_count DESC,`
           : Prisma.empty
     } i.created_at DESC, i.id DESC
     LIMIT ${PAGE_SIZE} OFFSET ${(params.page - 1) * PAGE_SIZE}
  `;

  const ids = hits.map((hit) => hit.id);
  const rows =
    ids.length === 0
      ? []
      : await prisma.innovationIdea.findMany({
          where: { id: { in: ids } },
          select: listSelect(actor.id),
        });

  return {
    rows: inIdOrder(ids, rows).map((row) => toListItem(row, actor.id)),
    total: Number(hits[0]?.total ?? 0),
    page: params.page,
    pageSize: PAGE_SIZE,
  };
}

/**
 * The ideas with the most votes, for administrators deciding what to take forward.
 * One indexed statement: votes are counted on the idea, not per request.
 */
export async function listTopVotedIdeas(
  actor: Actor,
  limit = 10,
): Promise<IdeaListItem[]> {
  await requirePermission(actor, INNOVATION_PERMISSIONS.IDEA_ADMINISTER);
  const rows = await prisma.innovationIdea.findMany({
    where: { deletedAt: null, voteCount: { gt: 0 } },
    orderBy: [{ voteCount: "desc" }, { createdAt: "desc" }],
    take: Math.min(Math.max(limit, 1), 25),
    select: listSelect(actor.id),
  });
  return rows.map((row) => toListItem(row, actor.id));
}

export async function getIdea(actor: Actor, ideaId: string): Promise<IdeaDetail> {
  await requirePermission(actor, INNOVATION_PERMISSIONS.IDEA_READ);
  assertId(ideaId, "idea");

  const row = await prisma.innovationIdea.findFirst({
    where: { id: ideaId, deletedAt: null },
    select: {
      ...listSelect(actor.id),
      categoryId: true,
      updatedAt: true,
      attachment: { select: fileSelect },
      project: { select: { id: true, name: true, deletedAt: true } },
      comments: {
        where: { deletedAt: null },
        orderBy: { createdAt: "asc" },
        take: 200,
        select: {
          id: true,
          body: true,
          createdAt: true,
          authorId: true,
          author: { select: personSelect },
        },
      },
    },
  });
  if (row === null) throw new NotFoundError("idea");

  const {
    excerpt: _excerpt,
    hasAttachment: _hasAttachment,
    ...item
  } = toListItem(row, actor.id);
  return {
    ...item,
    description: row.description,
    categoryId: row.categoryId,
    updatedAt: row.updatedAt,
    attachment: toFile(row.attachment),
    project:
      row.project !== null && row.project.deletedAt === null
        ? { id: row.project.id, name: row.project.name }
        : null,
    comments: row.comments.map((comment) => ({
      id: comment.id,
      body: comment.body,
      author: toPerson(comment.author) ?? { id: comment.authorId, name: "Unknown" },
      isMine: comment.authorId === actor.id,
      createdAt: comment.createdAt,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Submitting and managing                                                    */
/* -------------------------------------------------------------------------- */

async function assertCategory(
  categoryId: string,
  allowArchivedId?: string,
): Promise<void> {
  const category = await prisma.innovationCategory.findFirst({
    where: { id: categoryId, kind: "IDEA" },
    select: { id: true, isActive: true },
  });
  if (category === null || (!category.isActive && category.id !== allowArchivedId)) {
    throw new ValidationError("Choose a category.", {
      categoryId: ["Choose a category."],
    });
  }
}

export async function createIdea(
  actor: Actor,
  rawInput: unknown,
): Promise<{ id: string }> {
  await requirePermission(actor, INNOVATION_PERMISSIONS.IDEA_CREATE);
  const input = parseInput(ideaCreateSchema, rawInput);
  await assertCategory(input.categoryId);
  if (input.attachmentFileId !== null) {
    await verifyUploadedFile(actor, input.attachmentFileId);
  }

  return prisma.$transaction(async (tx) => {
    if (input.attachmentFileId !== null) {
      await markFileReady(tx, actor, input.attachmentFileId);
    }
    const idea = await tx.innovationIdea.create({
      data: {
        title: input.title,
        description: input.description,
        categoryId: input.categoryId,
        attachmentFileId: input.attachmentFileId,
        createdBy: actor.id,
        updatedBy: actor.id,
      },
      select: { id: true },
    });
    await recordAudit(
      {
        ...auditFields(actor),
        action: "innovation.idea.submitted",
        module: INNOVATION_MODULE,
        entityType: "InnovationIdea",
        entityId: idea.id,
        summary: `Submitted idea: ${input.title}`,
      },
      tx,
    );
    await publish(tx, {
      name: INNOVATION_EVENTS.IDEA_SUBMITTED,
      actorId: actor.id,
      correlationId: actor.correlationId ?? null,
      payload: { ideaId: idea.id, categoryId: input.categoryId },
    });
    return idea;
  });
}

export async function updateIdea(
  actor: Actor,
  ideaId: string,
  rawInput: unknown,
): Promise<void> {
  await requirePermission(actor, INNOVATION_PERMISSIONS.IDEA_ADMINISTER);
  const existing = await findLiveIdea(ideaId);
  const input = parseInput(ideaUpdateSchema, rawInput);
  await assertCategory(input.categoryId, existing.categoryId);

  if (input.ownerId !== null && input.ownerId !== existing.ownerId) {
    const [person] = await findDirectoryPeople(actor, [input.ownerId]);
    if (person === undefined || !person.isActive) {
      throw new ValidationError("Choose an active colleague as the owner.", {
        ownerId: ["Choose an active colleague as the owner."],
      });
    }
  }

  const before = {
    title: existing.title,
    description: existing.description,
    categoryId: existing.categoryId,
    status: existing.status,
    ownerId: existing.ownerId,
  };
  const changes = diffForAudit(before, input, ["description"]);
  if (Object.keys(changes).length === 0) return;

  await prisma.$transaction(async (tx) => {
    await tx.innovationIdea.update({
      where: { id: ideaId },
      data: { ...input, updatedBy: actor.id },
    });
    await recordAudit(
      {
        ...auditFields(actor),
        action: "innovation.idea.updated",
        module: INNOVATION_MODULE,
        entityType: "InnovationIdea",
        entityId: ideaId,
        summary:
          input.status !== existing.status
            ? `Moved idea to ${IDEA_STATUS_LABELS[input.status]}: ${input.title}`
            : `Edited idea: ${input.title}`,
        changes,
      },
      tx,
    );
    if (input.status !== existing.status) {
      await publish(tx, {
        name: INNOVATION_EVENTS.IDEA_STAGE_CHANGED,
        actorId: actor.id,
        correlationId: actor.correlationId ?? null,
        payload: { ideaId, from: existing.status, to: input.status },
      });
    }
  });
}

export async function deleteIdea(actor: Actor, ideaId: string): Promise<void> {
  await requirePermission(actor, INNOVATION_PERMISSIONS.IDEA_ADMINISTER);
  const existing = await findLiveIdea(ideaId);

  await prisma.$transaction(async (tx) => {
    await tx.innovationIdea.update({
      where: { id: ideaId },
      data: { deletedAt: new Date(), updatedBy: actor.id },
    });
    await recordAudit(
      {
        ...auditFields(actor),
        action: "innovation.idea.deleted",
        module: INNOVATION_MODULE,
        entityType: "InnovationIdea",
        entityId: ideaId,
        summary: `Deleted idea: ${existing.title}`,
        severity: "WARNING",
      },
      tx,
    );
  });
}

/* -------------------------------------------------------------------------- */
/* Votes and comments                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Adds or removes the actor's vote. Counters move with raw increments, which
 * Adds or removes the actor's vote. The primary key (idea_id, user_id) makes a second
 * vote impossible, and a database trigger keeps `vote_count` in step with the votes
 * without touching `updated_at` — a vote is not an edit of the idea.
 */
export async function toggleVote(
  actor: Actor,
  ideaId: string,
): Promise<{ voted: boolean; voteCount: number }> {
  await requirePermission(actor, INNOVATION_PERMISSIONS.IDEA_VOTE);
  const idea = await findLiveIdea(ideaId);
  if (idea.createdBy === actor.id) {
    throw new BusinessRuleError("You can't vote for your own idea.");
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const removed = await tx.innovationIdeaVote.deleteMany({
        where: { ideaId, userId: actor.id },
      });
      if (removed.count === 0) {
        await tx.innovationIdeaVote.create({ data: { ideaId, userId: actor.id } });
      }
      // The idea_votes_count trigger has already moved the counter.
      const { voteCount } = await tx.innovationIdea.findUniqueOrThrow({
        where: { id: ideaId },
        select: { voteCount: true },
      });
      return { voted: removed.count === 0, voteCount };
    });
  } catch (error) {
    // A double click raced itself: the vote is there either way.
    if (isUniqueViolation(error)) {
      const current = await prisma.innovationIdea.findUniqueOrThrow({
        where: { id: ideaId },
        select: { voteCount: true },
      });
      return { voted: true, voteCount: current.voteCount };
    }
    throw error;
  }
}

export async function addComment(
  actor: Actor,
  ideaId: string,
  rawInput: unknown,
): Promise<CommentDto> {
  await requirePermission(actor, INNOVATION_PERMISSIONS.IDEA_COMMENT);
  await findLiveIdea(ideaId);
  const input = parseInput(commentSchema, rawInput);

  return prisma.$transaction(async (tx) => {
    const comment = await tx.innovationIdeaComment.create({
      data: { ideaId, authorId: actor.id, body: input.body },
      select: { id: true, body: true, createdAt: true, author: { select: personSelect } },
    });
    await tx.$executeRaw`
      UPDATE innovation.ideas SET comment_count = comment_count + 1 WHERE id = ${ideaId}::uuid
    `;
    return {
      id: comment.id,
      body: comment.body,
      author: toPerson(comment.author) ?? { id: actor.id, name: "You" },
      isMine: true,
      createdAt: comment.createdAt,
    };
  });
}

/** People remove their own comments; administrators remove anyone's. */
export async function deleteComment(actor: Actor, commentId: string): Promise<void> {
  assertId(commentId, "comment");
  const comment = await prisma.innovationIdeaComment.findFirst({
    where: { id: commentId, deletedAt: null, idea: { deletedAt: null } },
    select: { ideaId: true, authorId: true },
  });
  if (comment === null) throw new NotFoundError("comment");

  if (comment.authorId === actor.id) {
    await requirePermission(actor, INNOVATION_PERMISSIONS.IDEA_COMMENT);
  } else {
    await requirePermission(actor, INNOVATION_PERMISSIONS.IDEA_ADMINISTER);
  }

  await prisma.$transaction(async (tx) => {
    await tx.innovationIdeaComment.update({
      where: { id: commentId },
      data: { deletedAt: new Date() },
    });
    await tx.$executeRaw`
      UPDATE innovation.ideas
         SET comment_count = GREATEST(comment_count - 1, 0)
       WHERE id = ${comment.ideaId}::uuid
    `;
    if (comment.authorId !== actor.id) {
      await recordAudit(
        {
          ...auditFields(actor),
          action: "innovation.comment.removed",
          module: INNOVATION_MODULE,
          entityType: "InnovationIdeaComment",
          entityId: commentId,
          summary: "Removed a comment on an idea",
        },
        tx,
      );
    }
  });
}

/* -------------------------------------------------------------------------- */
/* Idea → project                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Turns an approved idea into a project: the project starts in Planning, led by the
 * idea's owner (or whoever converts it), and the idea moves to In progress.
 */
export async function convertIdeaToProject(
  actor: Actor,
  ideaId: string,
): Promise<{ projectId: string }> {
  await requirePermission(actor, INNOVATION_PERMISSIONS.IDEA_ADMINISTER);
  await requirePermission(actor, INNOVATION_PERMISSIONS.PROJECT_ADMINISTER);
  const idea = await findLiveIdea(ideaId);
  if (idea.status !== "APPROVED") {
    throw new BusinessRuleError("Only approved ideas can become projects.");
  }

  const ownerId = idea.ownerId ?? actor.id;
  try {
    return await prisma.$transaction(async (tx) => {
      const project = await tx.innovationProject.create({
        data: {
          name: idea.title,
          description: idea.description,
          ownerId,
          ideaId,
          createdBy: actor.id,
          updatedBy: actor.id,
          members: { create: [{ userId: ownerId }] },
        },
        select: { id: true },
      });
      await tx.innovationIdea.update({
        where: { id: ideaId },
        data: { status: "IN_PROGRESS" satisfies IdeaStatus, updatedBy: actor.id },
      });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "innovation.idea.converted",
          module: INNOVATION_MODULE,
          entityType: "InnovationIdea",
          entityId: ideaId,
          summary: `Turned idea into a project: ${idea.title}`,
          changes: {
            status: { from: idea.status, to: "IN_PROGRESS" },
            projectId: { from: null, to: project.id },
          },
        },
        tx,
      );
      await publish(tx, {
        name: INNOVATION_EVENTS.IDEA_CONVERTED_TO_PROJECT,
        actorId: actor.id,
        correlationId: actor.correlationId ?? null,
        payload: { ideaId, projectId: project.id },
      });
      await publish(tx, {
        name: INNOVATION_EVENTS.PROJECT_CREATED,
        actorId: actor.id,
        correlationId: actor.correlationId ?? null,
        payload: { projectId: project.id, ideaId },
      });
      return { projectId: project.id };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError("This idea already has a project.");
    }
    throw error;
  }
}

/** Whether the actor may manage ideas — for showing administrator controls. */
export async function canManageIdeas(actor: Actor): Promise<boolean> {
  return can(actor, INNOVATION_PERMISSIONS.IDEA_ADMINISTER);
}

export { ForbiddenError };
