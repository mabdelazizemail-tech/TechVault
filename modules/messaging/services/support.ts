import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { Actor } from "@/platform/authz/authz";

/**
 * Shared plumbing for messaging services. Module-private.
 */

export const MESSAGING_MODULE = "messaging";

/** Parses input with a contract schema, throwing a field-level `ValidationError`. */
export function parseInput<TSchema extends z.ZodType>(
  schema: TSchema,
  input: unknown,
  message = "The request is not valid.",
): z.output<TSchema> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const fields: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      (fields[issue.path.join(".") || "_"] ??= []).push(issue.message);
    }
    throw new ValidationError(
      parsed.error.issues[0]?.path.length === 0
        ? (parsed.error.issues[0]?.message ?? message)
        : message,
      fields,
    );
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

/**
 * Asserts the actor is an active participant of a live conversation. Anyone else
 * — including a former participant — is told the conversation does not exist, so
 * the error confirms nothing (CLAUDE.md §11.6).
 */
export async function requireParticipation(
  actor: Actor,
  conversationId: string,
): Promise<{ lastReadAt: Date | null; type: "DIRECT" | "GROUP" }> {
  const participation = await prisma.msgParticipant.findFirst({
    where: {
      conversationId,
      userId: actor.id,
      leftAt: null,
      conversation: { deletedAt: null },
    },
    select: { lastReadAt: true, conversation: { select: { type: true } } },
  });
  if (participation === null) throw new NotFoundError("conversation");
  return { lastReadAt: participation.lastReadAt, type: participation.conversation.type };
}

export const iso = (value: Date | null): string | null =>
  value === null ? null : value.toISOString();
