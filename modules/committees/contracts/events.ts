/**
 * Events published by Committees (CLAUDE.md §10). Payloads carry ids only.
 * Replies publish nothing: the discussion is its own record, and the people who
 * need to know are notified directly (ADR-036).
 */
export const COMMITTEES_EVENTS = {
  /** { committeeId } */
  COMMITTEE_CREATED: "committees.CommitteeCreated",
  /** { meetingId, committeeId } */
  MEETING_SCHEDULED: "committees.MeetingScheduled",
  /** { taskId, meetingId } */
  TASK_CREATED: "committees.TaskCreated",
  /** { taskId, meetingId, from, to } */
  TASK_STATUS_CHANGED: "committees.TaskStatusChanged",
} as const;

/** Notification kinds Committees writes (platform/notifications). */
export const COMMITTEES_NOTIFICATIONS = {
  TASK_ASSIGNED: "committees.task.assigned",
  TASK_REPLIED: "committees.task.replied",
  TASK_STATUS_CHANGED: "committees.task.status_changed",
} as const;
