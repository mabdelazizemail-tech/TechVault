/**
 * Events published by the messaging module (CLAUDE.md §10).
 *
 * Deliberately few. Sending a message publishes no outbox event: the message row
 * is itself the record, Realtime delivers it, and an outbox row per chat message
 * would double every write for no subscriber. Payloads carry ids, never content.
 */
export const MESSAGING_EVENTS = {
  /** Payload: { conversationId, type, participantIds }. */
  CONVERSATION_STARTED: "messaging.ConversationStarted",
} as const;
