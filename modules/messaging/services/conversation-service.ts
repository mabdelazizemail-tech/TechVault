import { Prisma } from "@prisma/client";
import { BusinessRuleError, NotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/platform/audit/audit";
import { type Actor, can, requirePermission } from "@/platform/authz/authz";
import { publish } from "@/platform/events/publish";
import {
  findDirectoryPeople,
  searchDirectory,
} from "@/platform/iam/services/directory-service";
import { MESSAGING_EVENTS } from "../contracts/events";
import { MESSAGING_PERMISSIONS } from "../contracts/permissions";
import {
  conversationIdSchema,
  openDirectConversationSchema,
  searchPeopleSchema,
} from "../contracts/schemas";
import type {
  ConversationDetailDto,
  ConversationSummaryDto,
  DirectoryMatchDto,
  InboxSummaryDto,
  MessageType,
} from "../contracts/types";
import { directKeyFor, previewOf } from "../domain/conversation-rules";
import {
  MESSAGING_MODULE,
  auditFields,
  iso,
  isUniqueViolation,
  parseInput,
} from "./support";

/**
 * Conversations: finding a colleague, opening a direct conversation, the inbox,
 * and unread counts.
 *
 * Which conversations a person may see is not a permission grant — it is
 * participation, checked in every query here. The permissions gate the feature.
 */

const INBOX_LIMIT = 50;
/** Unread counts stop at this, per conversation: "99+" is as useful as 4,812. */
const UNREAD_CAP = 99;

/* -------------------------------------------------------------------------- */
/* People                                                                     */
/* -------------------------------------------------------------------------- */

export async function searchPeople(
  actor: Actor,
  input: unknown,
): Promise<DirectoryMatchDto[]> {
  await requirePermission(actor, MESSAGING_PERMISSIONS.ACCESS);
  const { query } = parseInput(searchPeopleSchema, input);
  const matches = await searchDirectory(actor, query, { excludeUserId: actor.id });
  return matches.map((person) => ({ ...person, isActive: true }));
}

/* -------------------------------------------------------------------------- */
/* Opening a direct conversation                                              */
/* -------------------------------------------------------------------------- */

/**
 * Returns the direct conversation between the actor and another person, creating
 * it on first contact. Two people have exactly one: the unique `direct_key`
 * settles a race between two simultaneous first messages.
 */
export async function openDirectConversation(
  actor: Actor,
  input: unknown,
): Promise<{ conversationId: string; created: boolean }> {
  await requirePermission(actor, MESSAGING_PERMISSIONS.CONVERSATION_CREATE);
  const { userId } = parseInput(openDirectConversationSchema, input);

  if (userId === actor.id) {
    throw new BusinessRuleError("You cannot start a conversation with yourself.");
  }

  const [person] = await findDirectoryPeople(actor, [userId]);
  if (person === undefined || !person.isActive) throw new NotFoundError("person");

  const directKey = directKeyFor(actor.id, userId);
  const existing = await findDirect(directKey);
  if (existing !== null) return { conversationId: existing, created: false };

  if (!(await can({ id: userId }, MESSAGING_PERMISSIONS.ACCESS))) {
    throw new BusinessRuleError(`${person.name} does not have access to Messages.`);
  }

  try {
    const conversationId = await prisma.$transaction(async (tx) => {
      const conversation = await tx.msgConversation.create({
        data: {
          type: "DIRECT",
          directKey,
          createdBy: actor.id,
          updatedBy: actor.id,
          participants: {
            create: [{ userId: actor.id }, { userId }],
          },
        },
        select: { id: true },
      });

      await recordAudit(
        {
          ...auditFields(actor),
          action: "messaging.conversation.started",
          module: MESSAGING_MODULE,
          entityType: "conversation",
          entityId: conversation.id,
          summary: `Started a direct conversation with ${person.name}`,
        },
        tx,
      );

      await publish(tx, {
        name: MESSAGING_EVENTS.CONVERSATION_STARTED,
        actorId: actor.id,
        correlationId: actor.correlationId ?? null,
        payload: {
          conversationId: conversation.id,
          type: "DIRECT",
          participantIds: [actor.id, userId],
        },
      });

      return conversation.id;
    });
    return { conversationId, created: true };
  } catch (error) {
    // The other person opened the same conversation a moment earlier.
    if (isUniqueViolation(error)) {
      const winner = await findDirect(directKey);
      if (winner !== null) return { conversationId: winner, created: false };
    }
    throw error;
  }
}

async function findDirect(directKey: string): Promise<string | null> {
  const row = await prisma.msgConversation.findUnique({
    where: { directKey },
    select: { id: true, deletedAt: true },
  });
  return row === null || row.deletedAt !== null ? null : row.id;
}

/* -------------------------------------------------------------------------- */
/* Inbox                                                                      */
/* -------------------------------------------------------------------------- */

type InboxRow = {
  id: string;
  type: "DIRECT" | "GROUP";
  last_message_at: Date | null;
  lm_id: string | null;
  lm_sender_id: string | null;
  lm_type: MessageType | null;
  lm_content: string | null;
  lm_created_at: Date | null;
  my_last_read_at: Date | null;
  unread_count: number;
};

/**
 * The actor's conversations with their latest message and unread count, in ONE
 * statement. Raw SQL because Prisma cannot express a per-row count bounded by that
 * row's own watermark; every value is a bound parameter (CLAUDE.md §18.2).
 */
async function inboxRows(
  actorId: string,
  options: { conversationId?: string; limit: number },
): Promise<InboxRow[]> {
  const onlyOne =
    options.conversationId === undefined
      ? Prisma.empty
      : Prisma.sql`AND c.id = ${options.conversationId}::uuid`;

  return prisma.$queryRaw<InboxRow[]>`
    SELECT c.id,
           c.type::text AS type,
           c.last_message_at,
           lm.id AS lm_id,
           lm.sender_id AS lm_sender_id,
           lm.message_type::text AS lm_type,
           lm.content AS lm_content,
           lm.created_at AS lm_created_at,
           me.last_read_at AS my_last_read_at,
           (SELECT count(*)::int FROM (
              SELECT 1 FROM messaging.messages m
               WHERE m.conversation_id = c.id
                 AND m.deleted_at IS NULL
                 AND m.sender_id IS DISTINCT FROM ${actorId}::uuid
                 AND (me.last_read_at IS NULL OR m.created_at > me.last_read_at)
               LIMIT ${UNREAD_CAP}
           ) unread) AS unread_count
      FROM messaging.conversation_participants me
      JOIN messaging.conversations c
        ON c.id = me.conversation_id AND c.deleted_at IS NULL
      LEFT JOIN LATERAL (
        SELECT m.id, m.sender_id, m.message_type, m.content, m.created_at
          FROM messaging.messages m
         WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
         ORDER BY m.created_at DESC, m.id DESC
         LIMIT 1
      ) lm ON true
     WHERE me.user_id = ${actorId}::uuid
       AND me.left_at IS NULL
       ${onlyOne}
     ORDER BY coalesce(c.last_message_at, c.created_at) DESC, c.id DESC
     LIMIT ${options.limit}
  `;
}

/** Turns inbox rows into DTOs: participants, people and last-seen in three queries. */
async function toSummaries(
  actor: Actor,
  rows: readonly InboxRow[],
): Promise<Array<ConversationSummaryDto & { myLastReadAt: string | null }>> {
  if (rows.length === 0) return [];

  const participants = await prisma.msgParticipant.findMany({
    where: { conversationId: { in: rows.map((row) => row.id) } },
    select: {
      conversationId: true,
      userId: true,
      lastReadAt: true,
      lastDeliveredAt: true,
      leftAt: true,
    },
  });

  const otherIds = [
    ...new Set(participants.filter((p) => p.userId !== actor.id).map((p) => p.userId)),
  ];
  const [people, presence] = await Promise.all([
    findDirectoryPeople(actor, otherIds),
    prisma.msgPresence.findMany({
      where: { userId: { in: otherIds } },
      select: { userId: true, lastSeenAt: true },
    }),
  ]);
  const personById = new Map(people.map((person) => [person.id, person]));
  const lastSeenById = new Map(presence.map((row) => [row.userId, row.lastSeenAt]));

  return rows.flatMap((row) => {
    const members = participants.filter((p) => p.conversationId === row.id);
    const other = members.find((p) => p.userId !== actor.id);
    const person = other === undefined ? undefined : personById.get(other.userId);
    // A direct conversation always has a counterpart; skip anything malformed
    // rather than render a nameless row.
    if (other === undefined || person === undefined) return [];

    return [
      {
        id: row.id,
        type: row.type,
        counterpart: { ...person, lastSeenAt: iso(lastSeenById.get(person.id) ?? null) },
        lastMessage:
          row.lm_id === null || row.lm_type === null || row.lm_created_at === null
            ? null
            : {
                id: row.lm_id,
                senderId: row.lm_sender_id,
                type: row.lm_type,
                preview: previewOf({ type: row.lm_type, content: row.lm_content }),
                createdAt: row.lm_created_at.toISOString(),
              },
        lastMessageAt: iso(row.last_message_at),
        unreadCount: row.unread_count,
        receipts: members
          .filter((p) => p.leftAt === null && p.userId !== actor.id)
          .map((p) => ({
            userId: p.userId,
            lastDeliveredAt: iso(p.lastDeliveredAt),
            lastReadAt: iso(p.lastReadAt),
          })),
        myLastReadAt: iso(row.my_last_read_at),
      },
    ];
  });
}

export async function listConversations(actor: Actor): Promise<ConversationSummaryDto[]> {
  await requirePermission(actor, MESSAGING_PERMISSIONS.ACCESS);
  const rows = await inboxRows(actor.id, { limit: INBOX_LIMIT });
  const summaries = await toSummaries(actor, rows);
  return summaries.map(({ myLastReadAt: _mine, ...summary }) => summary);
}

export async function getConversation(
  actor: Actor,
  conversationId: string,
): Promise<ConversationDetailDto> {
  await requirePermission(actor, MESSAGING_PERMISSIONS.ACCESS);
  const input = parseInput(
    conversationIdSchema,
    { conversationId },
    "Conversation not found.",
  );

  const rows = await inboxRows(actor.id, {
    conversationId: input.conversationId,
    limit: 1,
  });
  const [summary] = await toSummaries(actor, rows);
  if (summary === undefined) throw new NotFoundError("conversation");

  const maySend = await can(actor, MESSAGING_PERMISSIONS.MESSAGE_CREATE);
  return { ...summary, canSend: maySend && summary.counterpart.isActive };
}

/* -------------------------------------------------------------------------- */
/* Unread and delivery                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The unread badge. Opening the application also counts as receiving everything
 * waiting, so this moves the actor's delivery watermarks first — one UPDATE,
 * touching only conversations with something new.
 */
export async function getInboxSummary(actor: Actor): Promise<InboxSummaryDto> {
  await requirePermission(actor, MESSAGING_PERMISSIONS.ACCESS);
  await markDelivered(actor);

  const [row] = await prisma.$queryRaw<[{ total: number }]>`
    SELECT coalesce(sum(unread.n), 0)::int AS total
      FROM messaging.conversation_participants me
      JOIN messaging.conversations c
        ON c.id = me.conversation_id AND c.deleted_at IS NULL
      CROSS JOIN LATERAL (
        SELECT count(*) AS n FROM (
          SELECT 1 FROM messaging.messages m
           WHERE m.conversation_id = c.id
             AND m.deleted_at IS NULL
             AND m.sender_id IS DISTINCT FROM ${actor.id}::uuid
             AND (me.last_read_at IS NULL OR m.created_at > me.last_read_at)
           LIMIT ${UNREAD_CAP}
        ) capped
      ) unread
     WHERE me.user_id = ${actor.id}::uuid
       AND me.left_at IS NULL
  `;
  return { unreadTotal: row?.total ?? 0 };
}

/**
 * Records that the actor's client has received messages — in one conversation,
 * or in all of them. Moves the watermark to the conversation's newest message and
 * never backwards; conversations already up to date are not written.
 */
export async function markDelivered(
  actor: Actor,
  input: { conversationId?: string } = {},
): Promise<void> {
  await requirePermission(actor, MESSAGING_PERMISSIONS.ACCESS);
  const onlyOne =
    input.conversationId === undefined
      ? Prisma.empty
      : Prisma.sql`AND p.conversation_id = ${
          parseInput(conversationIdSchema, input).conversationId
        }::uuid`;

  await prisma.$executeRaw`
    UPDATE messaging.conversation_participants p
       SET last_delivered_at = c.last_message_at,
           updated_at = now()
      FROM messaging.conversations c
     WHERE c.id = p.conversation_id
       AND c.deleted_at IS NULL
       AND c.last_message_at IS NOT NULL
       AND p.user_id = ${actor.id}::uuid
       AND p.left_at IS NULL
       AND (p.last_delivered_at IS NULL OR p.last_delivered_at < c.last_message_at)
       ${onlyOne}
  `;
}
