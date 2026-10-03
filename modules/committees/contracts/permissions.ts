import type { PermissionDefinition } from "@/platform/authz/types";

/**
 * Permissions owned by Committees (CLAUDE.md §11.2, ADR-036).
 *
 * Permissions say what kind of thing a person may do; membership says where.
 * Holding `committees.task.create` lets a person add tasks to meetings they can
 * see — the meetings of committees they belong to, meetings they organise, and
 * meetings where they are responsible for a task. `administer` sees and manages
 * every committee, and is the only right that deletes meetings and tasks; it
 * passes only when granted organisation-wide (ADR-025), because these records
 * carry no org unit to scope it by.
 */
export const COMMITTEES_PERMISSIONS = {
  ACCESS: "committees.module.access",

  /** See the meetings, agendas and tasks of one's own committees. */
  MEETING_READ: "committees.meeting.read",
  /** Schedule meetings for a committee one belongs to (and so organise them). */
  MEETING_CREATE: "committees.meeting.create",
  /** Edit a meeting one organises, and its agenda. */
  MEETING_UPDATE: "committees.meeting.update",

  /** Add tasks to a meeting's Team To-Do List. */
  TASK_CREATE: "committees.task.create",
  /**
   * Edit tasks one created or whose meeting one organises, and change the status
   * of tasks one created, organises or is responsible for.
   */
  TASK_UPDATE: "committees.task.update",
  /** Reply in a task's discussion. */
  TASK_REPLY: "committees.task_reply.create",

  /** Create and edit committees and their members; see, edit and delete everything. */
  ADMINISTER: "committees.committee.administer",
} as const;

type CommitteesPermissionKey =
  (typeof COMMITTEES_PERMISSIONS)[keyof typeof COMMITTEES_PERMISSIONS];

function define(
  key: CommitteesPermissionKey,
  action: PermissionDefinition["action"],
  description: string,
): PermissionDefinition {
  const resource = key.split(".")[1] ?? "module";
  return { key, module: "committees", resource, action, description };
}

export const COMMITTEES_PERMISSION_DEFINITIONS: readonly PermissionDefinition[] = [
  define(COMMITTEES_PERMISSIONS.ACCESS, "ACCESS", "Open Committees."),
  define(
    COMMITTEES_PERMISSIONS.MEETING_READ,
    "READ",
    "See the meetings, agendas and to-do lists of one's own committees.",
  ),
  define(
    COMMITTEES_PERMISSIONS.MEETING_CREATE,
    "CREATE",
    "Schedule meetings for a committee one belongs to.",
  ),
  define(
    COMMITTEES_PERMISSIONS.MEETING_UPDATE,
    "UPDATE",
    "Edit a meeting one organises, and its agenda.",
  ),
  define(
    COMMITTEES_PERMISSIONS.TASK_CREATE,
    "CREATE",
    "Add tasks to a meeting's Team To-Do List.",
  ),
  define(
    COMMITTEES_PERMISSIONS.TASK_UPDATE,
    "UPDATE",
    "Edit one's own tasks and update the status of tasks one is responsible for.",
  ),
  define(COMMITTEES_PERMISSIONS.TASK_REPLY, "CREATE", "Reply in a task's discussion."),
  define(
    COMMITTEES_PERMISSIONS.ADMINISTER,
    "ADMINISTER",
    "Create committees and choose their members; see, edit and delete every meeting and task.",
  ),
];

/** What every committee member may do: take part, never delete. */
export const COMMITTEES_MEMBER_PERMISSIONS: readonly string[] = [
  COMMITTEES_PERMISSIONS.ACCESS,
  COMMITTEES_PERMISSIONS.MEETING_READ,
  COMMITTEES_PERMISSIONS.MEETING_CREATE,
  COMMITTEES_PERMISSIONS.MEETING_UPDATE,
  COMMITTEES_PERMISSIONS.TASK_CREATE,
  COMMITTEES_PERMISSIONS.TASK_UPDATE,
  COMMITTEES_PERMISSIONS.TASK_REPLY,
];

/** Everything in Committees. */
export const COMMITTEES_ADMIN_PERMISSIONS: readonly string[] =
  Object.values(COMMITTEES_PERMISSIONS);

/** The section role (ADR-030): shows Committees and lets its holder take part. */
export const COMMITTEES_USER_ROLE = "committees-user";

/** The specialist role: runs committees. */
export const COMMITTEES_ADMIN_ROLE = "committees-admin";
