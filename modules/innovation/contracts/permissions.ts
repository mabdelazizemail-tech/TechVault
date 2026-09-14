import type { PermissionDefinition } from "@/platform/authz/types";

/**
 * Permissions owned by THE THINK TANK (CLAUDE.md §11.2).
 *
 * Two tiers, kept deliberately few (ADR-021): what every member of staff may do —
 * read, submit ideas, vote, comment, add knowledge, ask — and one `administer`
 * permission per area for full management.
 */
export const INNOVATION_PERMISSIONS = {
  ACCESS: "innovation.module.access",

  IDEA_READ: "innovation.idea.read",
  IDEA_CREATE: "innovation.idea.create",
  IDEA_VOTE: "innovation.idea_vote.create",
  IDEA_COMMENT: "innovation.idea_comment.create",
  /** Edit any idea, change status and owner, delete, convert to a project, remove comments. */
  IDEA_ADMINISTER: "innovation.idea.administer",

  KNOWLEDGE_READ: "innovation.knowledge.read",
  KNOWLEDGE_DOWNLOAD: "innovation.knowledge.download",
  KNOWLEDGE_CREATE: "innovation.knowledge.create",
  /** Edit and delete any knowledge item. */
  KNOWLEDGE_ADMINISTER: "innovation.knowledge.administer",

  PROJECT_READ: "innovation.project.read",
  /** Create, edit and delete projects. */
  PROJECT_ADMINISTER: "innovation.project.administer",

  CATEGORY_ADMINISTER: "innovation.category.administer",

  ASSISTANT_ACCESS: "innovation.assistant.access",
} as const;

type InnovationPermissionKey =
  (typeof INNOVATION_PERMISSIONS)[keyof typeof INNOVATION_PERMISSIONS];

function define(
  key: InnovationPermissionKey,
  action: PermissionDefinition["action"],
  description: string,
): PermissionDefinition {
  const resource = key.split(".")[1] ?? "module";
  return { key, module: "innovation", resource, action, description };
}

export const INNOVATION_PERMISSION_DEFINITIONS: readonly PermissionDefinition[] = [
  define(INNOVATION_PERMISSIONS.ACCESS, "ACCESS", "Open THE THINK TANK."),

  define(INNOVATION_PERMISSIONS.IDEA_READ, "READ", "View and search ideas."),
  define(INNOVATION_PERMISSIONS.IDEA_CREATE, "CREATE", "Submit ideas."),
  define(INNOVATION_PERMISSIONS.IDEA_VOTE, "CREATE", "Vote for other people's ideas."),
  define(INNOVATION_PERMISSIONS.IDEA_COMMENT, "CREATE", "Comment on ideas."),
  define(
    INNOVATION_PERMISSIONS.IDEA_ADMINISTER,
    "ADMINISTER",
    "Edit, review, assign and delete ideas, remove comments, and turn approved ideas into projects.",
  ),

  define(INNOVATION_PERMISSIONS.KNOWLEDGE_READ, "READ", "View and search knowledge."),
  define(
    INNOVATION_PERMISSIONS.KNOWLEDGE_DOWNLOAD,
    "DOWNLOAD",
    "Preview and download knowledge files and idea attachments.",
  ),
  define(INNOVATION_PERMISSIONS.KNOWLEDGE_CREATE, "CREATE", "Add knowledge."),
  define(
    INNOVATION_PERMISSIONS.KNOWLEDGE_ADMINISTER,
    "ADMINISTER",
    "Edit and delete any knowledge item.",
  ),

  define(INNOVATION_PERMISSIONS.PROJECT_READ, "READ", "View projects."),
  define(
    INNOVATION_PERMISSIONS.PROJECT_ADMINISTER,
    "ADMINISTER",
    "Create, edit and delete projects.",
  ),

  define(
    INNOVATION_PERMISSIONS.CATEGORY_ADMINISTER,
    "ADMINISTER",
    "Add, rename and archive idea and knowledge categories.",
  ),

  define(
    INNOVATION_PERMISSIONS.ASSISTANT_ACCESS,
    "ACCESS",
    "Use Ask Think Tank to find knowledge.",
  ),
];

/** What every member of staff may do. */
export const INNOVATION_MEMBER_PERMISSIONS: readonly string[] = [
  INNOVATION_PERMISSIONS.ACCESS,
  INNOVATION_PERMISSIONS.IDEA_READ,
  INNOVATION_PERMISSIONS.IDEA_CREATE,
  INNOVATION_PERMISSIONS.IDEA_VOTE,
  INNOVATION_PERMISSIONS.IDEA_COMMENT,
  INNOVATION_PERMISSIONS.KNOWLEDGE_READ,
  INNOVATION_PERMISSIONS.KNOWLEDGE_DOWNLOAD,
  INNOVATION_PERMISSIONS.KNOWLEDGE_CREATE,
  INNOVATION_PERMISSIONS.PROJECT_READ,
  INNOVATION_PERMISSIONS.ASSISTANT_ACCESS,
];

/** Role key for the seeded Think Tank administrator role. */
export const INNOVATION_ADMIN_ROLE = "think-tank-admin";

/** Everything in THE THINK TANK. */
export const INNOVATION_ADMIN_PERMISSIONS: readonly string[] =
  Object.values(INNOVATION_PERMISSIONS);
