import type { PrismaTransaction } from "@/lib/prisma";

/**
 * Transactional outbox publisher (CLAUDE.md §10).
 *
 * `publish` takes a transaction client and is deliberately awkward to call
 * without one: an event must be written in the SAME transaction as the business
 * change it describes, so an event can never announce something that rolled back.
 *
 * Phase 1 writes events; the dispatcher that delivers them to subscribers arrives
 * in Phase 2. Until then events accumulate as a visible, queryable backlog —
 * a deliberate state, not lost data.
 */

export type EventEnvelope<TPayload extends Record<string, unknown>> = {
  /** "<module>.<Entity><PastTenseVerb>", past tense only — an event is a fact. */
  name: string;
  /** Payload schema version. Bump when a field is removed or retyped. */
  version?: number;
  actorId?: string | null;
  correlationId?: string | null;
  /**
   * Entity IDs plus the few fields a subscriber genuinely needs.
   *
   * NEVER include sensitive data — no salary figures, national IDs or document
   * contents. Events are logged, retried and inspected by humans (§10).
   */
  payload: TPayload;
};

export async function publish<TPayload extends Record<string, unknown>>(
  tx: PrismaTransaction,
  event: EventEnvelope<TPayload>,
): Promise<void> {
  await tx.eventOutbox.create({
    data: {
      name: event.name,
      version: event.version ?? 1,
      actorId: event.actorId ?? null,
      correlationId: event.correlationId ?? null,
      payload: event.payload as never,
    },
  });
}

/** Publishes several events in one transaction, preserving their order. */
export async function publishAll(
  tx: PrismaTransaction,
  events: readonly EventEnvelope<Record<string, unknown>>[],
): Promise<void> {
  for (const event of events) {
    await publish(tx, event);
  }
}
