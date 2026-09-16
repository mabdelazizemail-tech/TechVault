import type { PermissionDefinition } from "@/platform/authz/types";
import {
  IAM_PERMISSION_DEFINITIONS,
  IAM_PERMISSIONS,
  PLATFORM_PERMISSION_DEFINITIONS,
  PLATFORM_PERMISSIONS,
  SYSTEM_ROLES,
} from "@/platform/iam/permissions";
import {
  CRM_MEMBER_PERMISSIONS,
  CRM_PERMISSION_DEFINITIONS,
  CRM_SALES_PERMISSIONS,
  CRM_SALES_ROLE,
  CRM_USER_ROLE,
} from "@/modules/crm/contracts/permissions";
import {
  MESSAGING_MEMBER_PERMISSIONS,
  MESSAGING_PERMISSION_DEFINITIONS,
} from "@/modules/messaging/contracts/permissions";
import {
  INNOVATION_ADMIN_PERMISSIONS,
  INNOVATION_ADMIN_ROLE,
  INNOVATION_MEMBER_PERMISSIONS,
  INNOVATION_MEMBER_ROLE,
  INNOVATION_PERMISSION_DEFINITIONS,
} from "@/modules/innovation/contracts/permissions";
import {
  ERP_ACCOUNTANT_PERMISSIONS,
  ERP_ACCOUNTANT_ROLE,
  ERP_FINANCE_ADMIN_PERMISSIONS,
  ERP_FINANCE_ADMIN_ROLE,
  ERP_PERMISSION_DEFINITIONS,
  ERP_USER_ROLE,
  ERP_VIEWER_PERMISSIONS,
} from "@/modules/erp/contracts/permissions";

/**
 * The permission composition root.
 *
 * Platform services must not import domain modules (enforced by the lint boundary
 * in eslint.config.mjs), but something has to assemble the union of every
 * module's declared permissions for seeding and for the admin catalogue screen.
 * That composition happens HERE — deliberately outside any single module, and
 * outside platform/.
 *
 * When a module ships, import its `contracts/permissions.ts` definitions and add
 * them to the array below. That one line is what makes the module's permissions
 * grantable and its navigation section appear.
 */
export const PERMISSION_CATALOGUE: readonly PermissionDefinition[] = [
  ...IAM_PERMISSION_DEFINITIONS,
  ...PLATFORM_PERMISSION_DEFINITIONS,
  // Phase 3: ...ECM_PERMISSION_DEFINITIONS,
  ...CRM_PERMISSION_DEFINITIONS,
  ...MESSAGING_PERMISSION_DEFINITIONS,
  ...ERP_PERMISSION_DEFINITIONS,
  // Phase 7: ...HRIS_PERMISSION_DEFINITIONS,
  ...INNOVATION_PERMISSION_DEFINITIONS,
  // Phase 9: ...BI_PERMISSION_DEFINITIONS,
];

/** Guards against two modules claiming the same permission key. */
export function findDuplicatePermissionKeys(): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const permission of PERMISSION_CATALOGUE) {
    if (seen.has(permission.key)) duplicates.add(permission.key);
    seen.add(permission.key);
  }

  return [...duplicates];
}

/**
 * The system role composition root (ADR-030).
 *
 * A role is a row, never an enum (CLAUDE.md §11.2) — but the roles TechVault
 * ships with have to be defined somewhere that both the seed and the tests can
 * read, and that is allowed to import every module. That is here, beside the
 * permission catalogue, for the same reason.
 *
 * Two tiers, and the distinction matters when granting:
 *
 *  - A **section role** is named after a navigation section and is what makes
 *    that section appear. It lets its holder look around and take part, never
 *    change the records that matter: `crm-user` logs activity but does not edit
 *    a deal; `erp-user` reads the books but posts nothing.
 *  - A **specialist role** is named after a job and carries the authority:
 *    Sales, Accountant, Finance administrator, Think Tank admin. Each already
 *    includes its own section's access, so it stands alone.
 *
 * Every staff role includes messaging, which is not a navigation section — the
 * Messenger is part of the shell, available wherever someone works.
 */
export type SystemRoleDefinition = {
  key: string;
  name: string;
  description: string;
  permissions: readonly string[];
};

export const SYSTEM_ROLE_DEFINITIONS: readonly SystemRoleDefinition[] = [
  {
    key: SYSTEM_ROLES.PLATFORM_ADMIN,
    name: "Platform administrator",
    description:
      "Full administrative control, including granting roles. Assign sparingly — this role can change what everyone else may do.",
    // Every permission in the catalogue, explicitly. There is no implication
    // between actions in the evaluator, so an admin role must enumerate them.
    permissions: PERMISSION_CATALOGUE.map((permission) => permission.key),
  },
  {
    key: SYSTEM_ROLES.IAM_ADMIN,
    name: "Identity administrator",
    description: "Manages users, roles and organisational structure.",
    permissions: [
      IAM_PERMISSIONS.ACCESS,
      IAM_PERMISSIONS.USER_READ,
      IAM_PERMISSIONS.USER_CREATE,
      IAM_PERMISSIONS.USER_UPDATE,
      IAM_PERMISSIONS.USER_ADMINISTER,
      IAM_PERMISSIONS.ROLE_READ,
      IAM_PERMISSIONS.PERMISSION_READ,
      IAM_PERMISSIONS.ORG_UNIT_READ,
      IAM_PERMISSIONS.ORG_UNIT_CREATE,
      IAM_PERMISSIONS.ORG_UNIT_UPDATE,
      IAM_PERMISSIONS.GROUP_READ,
      IAM_PERMISSIONS.GROUP_ADMINISTER,
      IAM_PERMISSIONS.LOGIN_HISTORY_READ,
    ],
  },
  {
    key: SYSTEM_ROLES.AUDITOR,
    name: "Auditor",
    description:
      "Read-only access to the audit trail and access configuration. Cannot change anything — which is what makes the role useful for assurance.",
    permissions: [
      IAM_PERMISSIONS.ACCESS,
      IAM_PERMISSIONS.USER_READ,
      IAM_PERMISSIONS.ROLE_READ,
      IAM_PERMISSIONS.PERMISSION_READ,
      IAM_PERMISSIONS.ORG_UNIT_READ,
      IAM_PERMISSIONS.LOGIN_HISTORY_READ,
      PLATFORM_PERMISSIONS.AUDIT_READ,
      PLATFORM_PERMISSIONS.AUDIT_EXPORT,
    ],
  },
  {
    key: CRM_USER_ROLE,
    name: "CRM",
    description:
      "Shows the CRM section. View leads, opportunities, companies and contacts, and log calls, meetings, notes and tasks against them. Creating and editing those records is the Sales role.",
    permissions: [...CRM_MEMBER_PERMISSIONS, ...MESSAGING_MEMBER_PERMISSIONS],
  },
  {
    key: CRM_SALES_ROLE,
    name: "Sales",
    description:
      "Works leads, contacts, companies and opportunities, and logs activity. Cannot change how the pipeline is configured. Includes everything the CRM role gives.",
    permissions: [...CRM_SALES_PERMISSIONS, ...MESSAGING_MEMBER_PERMISSIONS],
  },
  {
    key: ERP_USER_ROLE,
    name: "ERP Finance",
    description:
      "Shows the ERP Finance section, read-only: the chart of accounts, journals, financial reports, periods, cost centres, invoices, credit notes, receipts, customers and aging. Nothing can be recorded or posted.",
    permissions: [...ERP_VIEWER_PERMISSIONS, ...MESSAGING_MEMBER_PERMISSIONS],
  },
  {
    key: ERP_ACCOUNTANT_ROLE,
    name: "Accountant",
    description:
      "Records, posts and reverses journal entries and maintains accounts and cost centres. Cannot create, close or reopen accounting periods, or deactivate accounts.",
    permissions: [...ERP_ACCOUNTANT_PERMISSIONS, ...MESSAGING_MEMBER_PERMISSIONS],
  },
  {
    key: ERP_FINANCE_ADMIN_ROLE,
    name: "Finance administrator",
    description:
      "Runs ERP finance: the chart of accounts, cost centres, accounting periods (including closing and reopening them) and the journal.",
    permissions: [...ERP_FINANCE_ADMIN_PERMISSIONS, ...MESSAGING_MEMBER_PERMISSIONS],
  },
  {
    key: INNOVATION_MEMBER_ROLE,
    name: "The Think Tank",
    description:
      "Shows THE THINK TANK. Read and search ideas, knowledge and projects, submit ideas, vote, comment, add knowledge and ask questions.",
    permissions: [...INNOVATION_MEMBER_PERMISSIONS, ...MESSAGING_MEMBER_PERMISSIONS],
  },
  {
    key: INNOVATION_ADMIN_ROLE,
    name: "Think Tank admin",
    description:
      "Manages THE THINK TANK: reviews and assigns ideas, curates knowledge, runs projects and maintains categories.",
    permissions: [...INNOVATION_ADMIN_PERMISSIONS, ...MESSAGING_MEMBER_PERMISSIONS],
  },
  {
    key: SYSTEM_ROLES.EMPLOYEE,
    name: "Employee",
    description:
      "The baseline role every member of staff receives: messaging with colleagues, and no administrative access. Each section is added by ticking its own role.",
    permissions: [...MESSAGING_MEMBER_PERMISSIONS],
  },
];

/** The section roles, in the order the navigation lists their sections. */
export const SECTION_ROLE_KEYS: readonly string[] = [
  CRM_USER_ROLE,
  ERP_USER_ROLE,
  INNOVATION_MEMBER_ROLE,
];
