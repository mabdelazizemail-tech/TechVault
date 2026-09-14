import type { MessageDto, MessageStatus, ReceiptDto } from "../contracts/types";

/**
 * Pure messaging rules: no I/O, so they are exhaustively unit-testable and shared
 * by the service and the browser.
 */

/**
 * The deduplication key of a direct conversation: both ids, sorted, so A→B and
 * B→A produce the same key and the unique index admits one conversation per pair.
 */
export function directKeyFor(userA: string, userB: string): string {
  const [first, second] = [userA.toLowerCase(), userB.toLowerCase()].sort();
  return `${first}:${second}`;
}

/**
 * Status of a message the viewer sent, derived from the other participants'
 * watermarks rather than stored per message. With several recipients a message
 * is only as far along as the least advanced of them. Returns null for messages
 * the viewer did not send — status is shown on one's own messages only.
 */
export function messageStatus(
  message: Pick<MessageDto, "senderId" | "createdAt">,
  viewerId: string,
  receipts: readonly ReceiptDto[],
): MessageStatus | null {
  if (message.senderId !== viewerId) return null;
  const others = receipts.filter((receipt) => receipt.userId !== viewerId);
  if (others.length === 0) return "sent";

  const sentAt = Date.parse(message.createdAt);
  const reached = (watermark: string | null) =>
    watermark !== null && Date.parse(watermark) >= sentAt;

  if (others.every((receipt) => reached(receipt.lastReadAt))) return "read";
  if (
    others.every(
      (receipt) => reached(receipt.lastDeliveredAt) || reached(receipt.lastReadAt),
    )
  ) {
    return "delivered";
  }
  return "sent";
}

/** Message order everywhere: oldest first, ties broken by id so every client agrees. */
export function compareMessages(
  a: Pick<MessageDto, "createdAt" | "id">,
  b: Pick<MessageDto, "createdAt" | "id">,
): number {
  const byTime = Date.parse(a.createdAt) - Date.parse(b.createdAt);
  if (byTime !== 0) return byTime;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Merges newly fetched messages into those already shown. A message present in
 * both is replaced by the incoming copy — which is how an optimistic message is
 * confirmed, since the client chose its id. Returns the same array when nothing
 * changed, so React can skip the render.
 */
export function mergeMessages<T extends MessageDto>(
  current: readonly T[],
  incoming: readonly T[],
): readonly T[] {
  if (incoming.length === 0) return current;
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort(compareMessages);
}

export type TimelineItem<T extends MessageDto> =
  | { kind: "day"; key: string; dayKey: string; firstAt: string }
  | { kind: "unread"; key: string }
  | {
      kind: "message";
      key: string;
      message: T;
      /** Same sender as the previous message, within five minutes, on the same day. */
      continuesGroup: boolean;
    };

const GROUP_WINDOW_MS = 5 * 60 * 1000;

/**
 * Lays out a conversation: a day separator before each new day, and an "unread"
 * divider before the first message from someone else newer than the viewer's
 * read watermark. `dayKeyOf` maps a timestamp to a calendar day in the display
 * time zone, which the caller owns.
 */
export function buildTimeline<T extends MessageDto>(
  messages: readonly T[],
  options: {
    viewerId: string;
    lastReadAt: string | null;
    dayKeyOf: (iso: string) => string;
  },
): TimelineItem<T>[] {
  const items: TimelineItem<T>[] = [];
  const readUntil = options.lastReadAt === null ? null : Date.parse(options.lastReadAt);
  let unreadPlaced = false;
  let previous: T | undefined;

  for (const message of messages) {
    const dayKey = options.dayKeyOf(message.createdAt);
    const newDay =
      previous === undefined || options.dayKeyOf(previous.createdAt) !== dayKey;
    if (newDay) {
      items.push({
        kind: "day",
        key: `day-${dayKey}`,
        dayKey,
        firstAt: message.createdAt,
      });
    }

    const isUnread =
      !unreadPlaced &&
      message.senderId !== options.viewerId &&
      (readUntil === null || Date.parse(message.createdAt) > readUntil);
    if (isUnread) {
      items.push({ kind: "unread", key: "unread" });
      unreadPlaced = true;
    }

    const continuesGroup =
      previous !== undefined &&
      !newDay &&
      !isUnread &&
      previous.senderId === message.senderId &&
      Date.parse(message.createdAt) - Date.parse(previous.createdAt) < GROUP_WINDOW_MS;

    items.push({ kind: "message", key: message.id, message, continuesGroup });
    previous = message;
  }

  return items;
}

/** A one-line inbox preview of a message. */
export function previewOf(
  message: Pick<MessageDto, "type" | "content">,
  maxLength = 140,
): string {
  if (message.type === "DOCUMENT") return "Shared a document";
  const text = (message.content ?? "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}
