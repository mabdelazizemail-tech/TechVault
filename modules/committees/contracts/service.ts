/**
 * Committees' public service surface (CLAUDE.md §4). Every function checks its own
 * permission and the actor's membership; callers pass an `Actor` and trust nothing
 * else.
 */

export {
  canAdministerCommittees,
  createCommittee,
  getCommittee,
  listCommitteeOptions,
  listCommittees,
  listSchedulableCommittees,
  updateCommittee,
} from "../services/committee-service";

export {
  addAgendaItem,
  createMeeting,
  deleteMeeting,
  getMeeting,
  listMeetings,
  listUpcomingMeetings,
  moveAgendaItem,
  removeAgendaItem,
  updateAgendaItem,
  updateMeeting,
} from "../services/meeting-service";

export { searchPeople } from "../services/people";

export {
  changeTaskStatus,
  createTask,
  deleteTask,
  getTask,
  getTaskSummary,
  listMeetingAssignees,
  listTasks,
  replyToTask,
  updateTask,
} from "../services/task-service";
