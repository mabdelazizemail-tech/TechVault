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
  /** { expenseId, missionId, currency, amountMinor } */
  MISSION_EXPENSE_SUBMITTED: "committees.MissionExpenseSubmitted",
  /** { expenseId, status } */
  MISSION_EXPENSE_REVIEWED: "committees.MissionExpenseReviewed",
  /** { expenseId, missionId } */
  MISSION_EXPENSE_DELETED: "committees.MissionExpenseDeleted",
  /** { expenseIds, paidOn } — approved claims recorded as paid (ADR-040). */
  MISSION_EXPENSES_PAID: "committees.MissionExpensesPaid",
  /** { expenseId } — a recorded payment cleared. */
  MISSION_EXPENSE_PAYMENT_UNDONE: "committees.MissionExpensePaymentUndone",
} as const;

/** Notification kinds Committees writes (platform/notifications). */
export const COMMITTEES_NOTIFICATIONS = {
  TASK_ASSIGNED: "committees.task.assigned",
  TASK_REPLIED: "committees.task.replied",
  TASK_STATUS_CHANGED: "committees.task.status_changed",
  EXPENSE_REVIEWED: "committees.expense.reviewed",
  EXPENSE_DELETED: "committees.expense.deleted",
  EXPENSE_PAID: "committees.expense.paid",
  EXPENSE_PAYMENT_UNDONE: "committees.expense.payment_undone",
} as const;
