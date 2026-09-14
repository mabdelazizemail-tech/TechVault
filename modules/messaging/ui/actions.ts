"use server";

import { isAppError } from "@/lib/errors";
import type { Actor } from "@/platform/authz/authz";
import { getActor } from "@/platform/auth/current-user";
import { logger, newCorrelationId } from "@/platform/observability/logger";
import * as messaging from "../contracts/service";
import type {
  ConversationDetailDto,
  ConversationSummaryDto,
  DirectoryMatchDto,
  InboxSummaryDto,
  MessageDto,
  MessagePage,
} from "../contracts/types";

/**
 * Messaging Server Actions — the only way the browser reads or writes messages
 * (CLAUDE.md §9). They authenticate and delegate; the service authorises and
 * validates. Realtime tells the browser WHEN to call these, never what the data is.
 */

export type MessagingResult<T> = { ok: true; data: T } | { ok: false; message: string };

async function run<T>(
  operation: string,
  work: (actor: Actor) => Promise<T>,
): Promise<MessagingResult<T>> {
  try {
    const actor = await getActor();
    return { ok: true, data: await work(actor) };
  } catch (error) {
    if (isAppError(error)) return { ok: false, message: error.message };
    const traceId = newCorrelationId();
    logger.error("Messaging action failed", {
      module: "messaging",
      operation,
      traceId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      message: `Something went wrong. Please try again. Reference: ${traceId}`,
    };
  }
}

export async function searchPeopleAction(
  query: string,
): Promise<MessagingResult<DirectoryMatchDto[]>> {
  return run("messaging.people.search", (actor) =>
    messaging.searchPeople(actor, { query }),
  );
}

export async function openDirectConversationAction(
  userId: string,
): Promise<MessagingResult<{ conversationId: string }>> {
  return run("messaging.conversation.open", async (actor) => {
    const { conversationId } = await messaging.openDirectConversation(actor, { userId });
    return { conversationId };
  });
}

export async function listConversationsAction(): Promise<
  MessagingResult<ConversationSummaryDto[]>
> {
  return run("messaging.conversation.list", (actor) =>
    messaging.listConversations(actor),
  );
}

export async function getConversationAction(
  conversationId: string,
): Promise<MessagingResult<ConversationDetailDto>> {
  return run("messaging.conversation.get", (actor) =>
    messaging.getConversation(actor, conversationId),
  );
}

export async function listMessagesAction(input: {
  conversationId: string;
  before?: string;
  after?: string;
}): Promise<MessagingResult<MessagePage>> {
  return run("messaging.message.list", (actor) => messaging.listMessages(actor, input));
}

export async function sendMessageAction(input: {
  conversationId: string;
  clientMessageId: string;
  content: string;
}): Promise<MessagingResult<MessageDto>> {
  return run("messaging.message.send", (actor) => messaging.sendMessage(actor, input));
}

export async function markReadAction(input: {
  conversationId: string;
  messageId: string;
}): Promise<MessagingResult<null>> {
  return run("messaging.message.read", async (actor) => {
    await messaging.markRead(actor, input);
    return null;
  });
}

export async function getInboxSummaryAction(): Promise<MessagingResult<InboxSummaryDto>> {
  return run("messaging.inbox.summary", (actor) => messaging.getInboxSummary(actor));
}
