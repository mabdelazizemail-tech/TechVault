import type { PermissionDefinition } from "@/platform/authz/types";

/**
 * Permissions owned by IAM and the platform services (CLAUDE.md §11.2).
 *
 * Each domain module declares its own permissions in
 * `modules/<module>/contracts/permissions.ts`; the union of all of them is
 * assembled in `modules/catalogue.ts` and seeded into `iam.permissions`.
 *
 * Never write a permission string as an inline literal at a call site — import
 * the constant, so renaming one is a compile error rather than a silent hole.
 */

export const IAM_PERMISSIONS = {
  ACCESS: "iam.module.access",

  USER_READ: "iam.user.read",
  USER_CREATE: "iam.user.create",
  USER_UPDATE: "iam.user.update",
  USER_ADMINISTER: "iam.user.administer",

  ROLE_READ: "iam.role.read",
  ROLE_CREATE: "iam.role.create",
  ROLE_UPDATE: "iam.role.update",
  ROLE_DELETE: "iam.role.delete",

  PERMISSION_READ: "iam.permission.read",

  ORG_UNIT_READ: "iam.org_unit.read",
  ORG_UNIT_CREATE: "iam.org_unit.create",
  ORG_UNIT_UPDATE: "iam.org_unit.update",
  ORG_UNIT_DELETE: "iam.org_unit.delete",

  GROUP_READ: "iam.group.read",
  GROUP_ADMINISTER: "iam.group.administer",

  API_TOKEN_READ: "iam.api_token.read",
  API_TOKEN_CREATE: "iam.api_token.create",
  API_TOKEN_REVOKE: "iam.api_token.delete",

  LOGIN_HISTORY_READ: "iam.login_history.read",
} as const;

export const PLATFORM_PERMISSIONS = {
  AUDIT_READ: "platform.audit.read",
  AUDIT_EXPORT: "platform.audit.export",
  SETTINGS_READ: "platform.settings.read",
  SETTINGS_ADMINISTER: "platform.settings.administer",
  FEATURE_FLAG_ADMINISTER: "platform.feature_flag.administer",
} as const;

export const IAM_PERMISSION_DEFINITIONS: readonly PermissionDefinition[] = [
  {
    key: IAM_PERMISSIONS.ACCESS,
    module: "iam",
    resource: "module",
    action: "ACCESS",
    description: "Open the administration area.",
  },
  {
    key: IAM_PERMISSIONS.USER_READ,
    module: "iam",
    resource: "user",
    action: "READ",
    description: "View user accounts and their assigned roles.",
  },
  {
    key: IAM_PERMISSIONS.USER_CREATE,
    module: "iam",
    resource: "user",
    action: "CREATE",
    description: "Invite or create a user account.",
  },
  {
    key: IAM_PERMISSIONS.USER_UPDATE,
    module: "iam",
    resource: "user",
    action: "UPDATE",
    description: "Edit a user's profile, organisational unit or active state.",
  },
  {
    key: IAM_PERMISSIONS.USER_ADMINISTER,
    module: "iam",
    resource: "user",
    action: "ADMINISTER",
    description:
      "Grant and revoke a user's roles and permissions. This confers control over " +
      "what everyone else can do, so treat it as the most powerful permission.",
    isSensitive: true,
  },
  {
    key: IAM_PERMISSIONS.ROLE_READ,
    module: "iam",
    resource: "role",
    action: "READ",
    description: "View roles and the permissions they bundle.",
  },
  {
    key: IAM_PERMISSIONS.ROLE_CREATE,
    module: "iam",
    resource: "role",
    action: "CREATE",
    description: "Create a role.",
  },
  {
    key: IAM_PERMISSIONS.ROLE_UPDATE,
    module: "iam",
    resource: "role",
    action: "UPDATE",
    description: "Change a role's details or the permissions it grants.",
    isSensitive: true,
  },
  {
    key: IAM_PERMISSIONS.ROLE_DELETE,
    module: "iam",
    resource: "role",
    action: "DELETE",
    description: "Delete a non-system role.",
  },
  {
    key: IAM_PERMISSIONS.PERMISSION_READ,
    module: "iam",
    resource: "permission",
    action: "READ",
    description: "View the permission catalogue.",
  },
  {
    key: IAM_PERMISSIONS.ORG_UNIT_READ,
    module: "iam",
    resource: "org_unit",
    action: "READ",
    description: "View the organisational structure.",
  },
  {
    key: IAM_PERMISSIONS.ORG_UNIT_CREATE,
    module: "iam",
    resource: "org_unit",
    action: "CREATE",
    description: "Create an organisational unit.",
  },
  {
    key: IAM_PERMISSIONS.ORG_UNIT_UPDATE,
    module: "iam",
    resource: "org_unit",
    action: "UPDATE",
    description: "Rename or re-parent an organisational unit.",
  },
  {
    key: IAM_PERMISSIONS.ORG_UNIT_DELETE,
    module: "iam",
    resource: "org_unit",
    action: "DELETE",
    description: "Remove an organisational unit.",
  },
  {
    key: IAM_PERMISSIONS.GROUP_READ,
    module: "iam",
    resource: "group",
    action: "READ",
    description: "View groups and their members.",
  },
  {
    key: IAM_PERMISSIONS.GROUP_ADMINISTER,
    module: "iam",
    resource: "group",
    action: "ADMINISTER",
    description: "Create groups and manage their membership and roles.",
  },
  {
    key: IAM_PERMISSIONS.API_TOKEN_READ,
    module: "iam",
    resource: "api_token",
    action: "READ",
    description: "View issued API tokens (never their values).",
  },
  {
    key: IAM_PERMISSIONS.API_TOKEN_CREATE,
    module: "iam",
    resource: "api_token",
    action: "CREATE",
    description: "Issue an API token.",
    isSensitive: true,
  },
  {
    key: IAM_PERMISSIONS.API_TOKEN_REVOKE,
    module: "iam",
    resource: "api_token",
    action: "DELETE",
    description: "Revoke an API token.",
  },
  {
    key: IAM_PERMISSIONS.LOGIN_HISTORY_READ,
    module: "iam",
    resource: "login_history",
    action: "READ",
    description: "View sign-in history and failed attempts.",
  },
];

export const PLATFORM_PERMISSION_DEFINITIONS: readonly PermissionDefinition[] = [
  {
    key: PLATFORM_PERMISSIONS.AUDIT_READ,
    module: "platform",
    resource: "audit",
    action: "READ",
    description: "Read the audit trail.",
    isSensitive: true,
  },
  {
    key: PLATFORM_PERMISSIONS.AUDIT_EXPORT,
    module: "platform",
    resource: "audit",
    action: "EXPORT",
    description: "Export audit records.",
    isSensitive: true,
  },
  {
    key: PLATFORM_PERMISSIONS.SETTINGS_READ,
    module: "platform",
    resource: "settings",
    action: "READ",
    description: "View platform settings.",
  },
  {
    key: PLATFORM_PERMISSIONS.SETTINGS_ADMINISTER,
    module: "platform",
    resource: "settings",
    action: "ADMINISTER",
    description: "Change platform settings.",
  },
  {
    key: PLATFORM_PERMISSIONS.FEATURE_FLAG_ADMINISTER,
    module: "platform",
    resource: "feature_flag",
    action: "ADMINISTER",
    description: "Turn feature flags on and off.",
  },
];

/** Role keys seeded by `prisma/seed.ts`. System roles cannot be deleted in the UI. */
export const SYSTEM_ROLES = {
  PLATFORM_ADMIN: "platform-admin",
  IAM_ADMIN: "iam-admin",
  AUDITOR: "auditor",
  EMPLOYEE: "employee",
} as const;
