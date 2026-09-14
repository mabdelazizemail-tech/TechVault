/**
 * DTOs returned by the messaging service (CLAUDE.md §9.5). Never Prisma entities.
 *
 * Timestamps are ISO strings so they cross the Server Action boundary unchanged.
 */

export const MESSAGE_PAGE_SIZE = 50;
export const MESSAGE_MAX_LENGTH = 4000;

export type MessageType = "TEXT" | "DOCUMENT" | "SYSTEM";

/** Derived, never stored per message: see `messageStatus` in domain/receipts.ts. */
export type MessageStatus = "sent" | "delivered" | "read";

export type PersonDto = {
  id: string;
  name: string;
  email: string;
  /** False once an administrator deactivates or deletes the account. */
  isActive: boolean;
};

/** The other participants' watermarks, from which message status is derived. */
export type ReceiptDto = {
  userId: string;
  lastDeliveredAt: string | null;
  lastReadAt: string | null;
};

export type ConversationSummaryDto = {
  id: string;
  type: "DIRECT" | "GROUP";
  /** The other person in a direct conversation. */
  counterpart: PersonDto & { lastSeenAt: string | null };
  lastMessage: {
    id: string;
    senderId: string | null;
    type: MessageType;
    /** At most 140 characters. */
    preview: string;
    createdAt: string;
  } | null;
  lastMessageAt: string | null;
  unreadCount: number;
  receipts: ReceiptDto[];
};

export type MessageDto = {
  id: string;
  conversationId: string;
  senderId: string | null;
  type: MessageType;
  content: string | null;
  createdAt: string;
  editedAt: string | null;
};

export type ConversationDetailDto = ConversationSummaryDto & {
  /** The signed-in participant's own read watermark, for the unread divider. */
  myLastReadAt: string | null;
  /** False when the counterpart can no longer receive messages. */
  canSend: boolean;
};

export type MessagePage = {
  messages: MessageDto[];
  /** True when older messages exist before the first one returned. */
  hasOlder: boolean;
};

export type InboxSummaryDto = {
  /** Unread messages across every conversation, each conversation capped at 99. */
  unreadTotal: number;
};

export type DirectoryMatchDto = PersonDto;
