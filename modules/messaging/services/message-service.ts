import type { Prisma } from "@prisma/client";
import { BusinessRuleError, ConflictError, NotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { type Actor, requirePermission } from "@/platform/authz/authz";
import { findDirectoryPeople } from "@/platform/iam/services/directory-service";
import { MESSAGING_PERMISSIONS } from "../contracts/permissions";
import {
  listMessagesSchema,
  markReadSchema,
  sendMessageSchema,
} from "../contracts/schemas";
import type { MessageDto, MessagePage } from "../contracts/types";
import { isUniqueViolation, parseInput, requireParticipation } from "./support";

/**
 * Messages: history pages, sending, and read receipts.
 *
 * Sending writes no audit record and no outbox event. A chat message is not a
 * business-significant change to another record — the message row IS the record,
 * kept append-only and soft-deleted — and doubling every send for no reader would
 * make the busiest table in the platform twice as expensive (ADR-020).
 */

const messageSelect = {
  id: true,
  conversationId: true,
  senderId: true,
  type: true,
  content: true,
  createdAt: true,
  editedAt: true,
} satisfies Prisma.MsgMessageSelect;

type MessageRow = Prisma.MsgMessageGetPayload<{ select: typeof messageSelect }>;

function toMessageDto(row: MessageRow): MessageDto {
  return {
    id: row.id,
    conversationId: row.conversationId,
    senderId: row.senderId,
    type: row.type,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt === null ? null : row.editedAt.toISOString(),
  };
}

/**
 * One page of a conversation, oldest first. Without a cursor, the newest page;
 * with `before`, the page preceding that message (scrolling up); with `after`,
 * messages newer than it (catching up after a Realtime signal). Keyset
 * pagination on (created_at, id), served by the conversation index, so page 40 is
 * as fast as page 1.
 */
export async function listMessages(actor: Actor, input: unknown): Promise<MessagePage> {
  await requirePermission(actor, MESSAGING_PERMISSIONS.ACCESS);
  const { conversationId, before, after, limit } = parseInput(listMessagesSchema, input);
  await requireParticipation(actor, conversationId);

  const cursorId = before ?? after;
  let cursor: { createdAt: Date; id: string } | null = null;
  if (cursorId !== undefined) {
    cursor = await prisma.msgMessage.findFirst({
      where: { id: cursorId, conversationId },
      select: { createdAt: true, id: true },
    });
    if (cursor === null) throw new NotFoundError("message");
  }

  const base: Prisma.MsgMessageWhereInput = { conversationId, deletedAt: null };

  if (after !== undefined && before === undefined && cursor !== null) {
    const rows = await prisma.msgMessage.findMany({
      where: {
        ...base,
        OR: [
          { createdAt: { gt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { gt: cursor.id } },
        ],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit,
      select: messageSelect,
    });
    return { messages: rows.map(toMessageDto), hasOlder: true };
  }

  const rows = await prisma.msgMessage.findMany({
    where:
      cursor === null
        ? base
        : {
            ...base,
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    // One extra row answers "is there more?" without a count.
    take: limit + 1,
    select: messageSelect,
  });

  const hasOlder = rows.length > limit;
  return {
    messages: rows.slice(0, limit).reverse().map(toMessageDto),
    hasOlder,
  };
}

/**
 * Sends a text message. The client supplies the message id, so a send retried
 * after a dropped response returns the original message instead of a duplicate.
 * Replying also marks everything before it as read.
 */
export async function sendMessage(actor: Actor, input: unknown): Promise<MessageDto> {
  await requirePermission(actor, MESSAGING_PERMISSIONS.MESSAGE_CREATE);
  const { conversationId, clientMessageId, content } = parseInput(
    sendMessageSchema,
    input,
  );
  await requireParticipation(actor, conversationId);

  const others = await prisma.msgParticipant.findMany({
    where: { conversationId, leftAt: null, userId: { not: actor.id } },
    select: { userId: true },
  });
  const people = await findDirectoryPeople(
    actor,
    others.map((other) => other.userId),
  );
  if (people.length === 0 || people.every((person) => !person.isActive)) {
    const name = people[0]?.name ?? "This person";
    throw new BusinessRuleError(
      `${name}'s account is deactivated, so they can no longer receive messages.`,
    );
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const row = await tx.msgMessage.create({
        data: {
          id: clientMessageId,
          conversationId,
          senderId: actor.id,
          type: "TEXT",
          content,
        },
        select: messageSelect,
      });

      await advanceWatermarks(tx, actor.id, conversationId, row.createdAt);
      return toMessageDto(row);
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await prisma.msgMessage.findUnique({
      where: { id: clientMessageId },
      select: messageSelect,
    });
    if (
      existing !== null &&
      existing.senderId === actor.id &&
      existing.conversationId === conversationId
    ) {
      return toMessageDto(existing);
    }
    throw new ConflictError("This message could not be sent. Please try again.");
  }
}

/**
 * Marks a conversation read up to a message the reader has seen. The watermark
 * only moves forward, and a call that would not move it writes nothing — so a
 * reader scrolling through history causes no writes at all.
 */
export async function markRead(actor: Actor, input: unknown): Promise<void> {
  await requirePermission(actor, MESSAGING_PERMISSIONS.ACCESS);
  const { conversationId, messageId } = parseInput(markReadSchema, input);
  await requireParticipation(actor, conversationId);

  const message = await prisma.msgMessage.findFirst({
    where: { id: messageId, conversationId },
    select: { createdAt: true },
  });
  if (message === null) throw new NotFoundError("message");

  await advanceWatermarks(prisma, actor.id, conversationId, message.createdAt);
}

async function advanceWatermarks(
  client: Prisma.TransactionClient,
  userId: string,
  conversationId: string,
  readUpTo: Date,
): Promise<void> {
  await client.$executeRaw`
    UPDATE messaging.conversation_participants
       SET last_read_at = ${readUpTo},
           last_delivered_at = GREATEST(coalesce(last_delivered_at, ${readUpTo}), ${readUpTo}),
           updated_at = now()
     WHERE conversation_id = ${conversationId}::uuid
       AND user_id = ${userId}::uuid
       AND (last_read_at IS NULL OR last_read_at < ${readUpTo})
  `;
}
