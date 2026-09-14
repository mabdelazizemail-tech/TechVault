import type { PermissionDefinition } from "@/platform/authz/types";

/**
 * Permissions owned by the messaging module (CLAUDE.md §11.2).
 *
 * These gate the FEATURE. Which conversations a person may read is not a grant:
 * it is participation, checked on every operation (ADR-020).
 */
export const MESSAGING_PERMISSIONS = {
  /** Open Messages, see who is online, read one's own conversations. */
  ACCESS: "messaging.module.access",
  /** Start a conversation with a colleague. */
  CONVERSATION_CREATE: "messaging.conversation.create",
  /** Send messages in a conversation one belongs to. */
  MESSAGE_CREATE: "messaging.message.create",
} as const;

type MessagingPermissionKey =
  (typeof MESSAGING_PERMISSIONS)[keyof typeof MESSAGING_PERMISSIONS];

function define(
  key: MessagingPermissionKey,
  action: PermissionDefinition["action"],
  description: string,
): PermissionDefinition {
  const resource = key.split(".")[1] ?? "module";
  return { key, module: "messaging", resource, action, description };
}

export const MESSAGING_PERMISSION_DEFINITIONS: readonly PermissionDefinition[] = [
  define(
    MESSAGING_PERMISSIONS.ACCESS,
    "ACCESS",
    "Open Messages, see colleagues' online status and read one's own conversations.",
  ),
  define(
    MESSAGING_PERMISSIONS.CONVERSATION_CREATE,
    "CREATE",
    "Start a conversation with a colleague.",
  ),
  define(
    MESSAGING_PERMISSIONS.MESSAGE_CREATE,
    "CREATE",
    "Send messages in conversations one takes part in.",
  ),
];

/** Every messaging permission: what a member of staff needs to chat. */
export const MESSAGING_MEMBER_PERMISSIONS: readonly string[] =
  Object.values(MESSAGING_PERMISSIONS);
