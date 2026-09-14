/**
 * The messaging module's public service surface (CLAUDE.md §4).
 *
 * Routes and other modules import messaging operations from HERE. Every function
 * checks the feature permission and the actor's participation itself.
 */

export {
  getConversation,
  getInboxSummary,
  listConversations,
  markDelivered,
  openDirectConversation,
  searchPeople,
} from "../services/conversation-service";

export { listMessages, markRead, sendMessage } from "../services/message-service";

export { recordLastSeen } from "../services/presence-service";
