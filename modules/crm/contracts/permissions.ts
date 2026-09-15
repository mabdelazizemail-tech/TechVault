import type { PermissionDefinition } from "@/platform/authz/types";

/**
 * Permissions owned by the CRM module (CLAUDE.md §11.2).
 *
 * Declared here, assembled into the platform catalogue in `modules/catalogue.ts`,
 * seeded into `iam.permissions`. Import the constant — never write the string.
 *
 * Record-level operations are checked with a scope target (the record's owner), so
 * a grant scoped OWN lets a salesperson work their own records only.
 */
export const CRM_PERMISSIONS = {
  ACCESS: "crm.module.access",

  LEAD_READ: "crm.lead.read",
  LEAD_CREATE: "crm.lead.create",
  LEAD_UPDATE: "crm.lead.update",
  LEAD_DELETE: "crm.lead.delete",

  ACCOUNT_READ: "crm.account.read",
  ACCOUNT_CREATE: "crm.account.create",
  ACCOUNT_UPDATE: "crm.account.update",
  ACCOUNT_DELETE: "crm.account.delete",

  CONTACT_READ: "crm.contact.read",
  CONTACT_CREATE: "crm.contact.create",
  CONTACT_UPDATE: "crm.contact.update",
  CONTACT_DELETE: "crm.contact.delete",

  OPPORTUNITY_READ: "crm.opportunity.read",
  OPPORTUNITY_CREATE: "crm.opportunity.create",
  OPPORTUNITY_UPDATE: "crm.opportunity.update",
  OPPORTUNITY_DELETE: "crm.opportunity.delete",

  ACTIVITY_READ: "crm.activity.read",
  ACTIVITY_CREATE: "crm.activity.create",
  ACTIVITY_UPDATE: "crm.activity.update",
  ACTIVITY_DELETE: "crm.activity.delete",

  PIPELINE_ADMINISTER: "crm.pipeline.administer",
} as const;

type CrmPermissionKey = (typeof CRM_PERMISSIONS)[keyof typeof CRM_PERMISSIONS];

function define(
  key: CrmPermissionKey,
  action: PermissionDefinition["action"],
  description: string,
): PermissionDefinition {
  const resource = key.split(".")[1] ?? "module";
  return { key, module: "crm", resource, action, description };
}

export const CRM_PERMISSION_DEFINITIONS: readonly PermissionDefinition[] = [
  define(CRM_PERMISSIONS.ACCESS, "ACCESS", "Open the CRM module."),

  define(CRM_PERMISSIONS.LEAD_READ, "READ", "View leads and their activity."),
  define(CRM_PERMISSIONS.LEAD_CREATE, "CREATE", "Capture new leads."),
  define(
    CRM_PERMISSIONS.LEAD_UPDATE,
    "UPDATE",
    "Edit, qualify and convert leads (conversion also needs opportunity creation).",
  ),
  define(CRM_PERMISSIONS.LEAD_DELETE, "DELETE", "Remove leads."),

  define(
    CRM_PERMISSIONS.ACCOUNT_READ,
    "READ",
    "View companies and their related records.",
  ),
  define(CRM_PERMISSIONS.ACCOUNT_CREATE, "CREATE", "Create companies."),
  define(CRM_PERMISSIONS.ACCOUNT_UPDATE, "UPDATE", "Edit companies."),
  define(CRM_PERMISSIONS.ACCOUNT_DELETE, "DELETE", "Remove companies."),

  define(CRM_PERMISSIONS.CONTACT_READ, "READ", "View contacts and their activity."),
  define(CRM_PERMISSIONS.CONTACT_CREATE, "CREATE", "Create contacts."),
  define(CRM_PERMISSIONS.CONTACT_UPDATE, "UPDATE", "Edit contacts."),
  define(CRM_PERMISSIONS.CONTACT_DELETE, "DELETE", "Remove contacts."),

  define(
    CRM_PERMISSIONS.OPPORTUNITY_READ,
    "READ",
    "View opportunities and the pipeline.",
  ),
  define(CRM_PERMISSIONS.OPPORTUNITY_CREATE, "CREATE", "Create opportunities."),
  define(
    CRM_PERMISSIONS.OPPORTUNITY_UPDATE,
    "UPDATE",
    "Edit opportunities and move them through the pipeline, including closing them.",
  ),
  define(CRM_PERMISSIONS.OPPORTUNITY_DELETE, "DELETE", "Remove opportunities."),

  define(
    CRM_PERMISSIONS.ACTIVITY_READ,
    "READ",
    "View calls, emails, meetings, tasks and notes.",
  ),
  define(CRM_PERMISSIONS.ACTIVITY_CREATE, "CREATE", "Log activities, tasks and notes."),
  define(
    CRM_PERMISSIONS.ACTIVITY_UPDATE,
    "UPDATE",
    "Edit activities and complete tasks.",
  ),
  define(CRM_PERMISSIONS.ACTIVITY_DELETE, "DELETE", "Remove activities."),

  define(
    CRM_PERMISSIONS.PIPELINE_ADMINISTER,
    "ADMINISTER",
    "Configure pipeline stages and their default probabilities.",
  ),
];

/** Role key for the seeded sales role. */
export const CRM_SALES_ROLE = "sales";

/**
 * The CRM's delete permissions. Deleting is administration, not day-to-day sales
 * work (ADR-024): only `platform-admin`, which holds the whole catalogue, has them.
 */
export const CRM_DELETE_PERMISSIONS: readonly string[] = [
  CRM_PERMISSIONS.LEAD_DELETE,
  CRM_PERMISSIONS.ACCOUNT_DELETE,
  CRM_PERMISSIONS.CONTACT_DELETE,
  CRM_PERMISSIONS.OPPORTUNITY_DELETE,
  CRM_PERMISSIONS.ACTIVITY_DELETE,
];

/** Everything a salesperson needs day to day — no pipeline configuration, no deleting. */
export const CRM_SALES_PERMISSIONS: readonly string[] = Object.values(
  CRM_PERMISSIONS,
).filter(
  (key) =>
    key !== CRM_PERMISSIONS.PIPELINE_ADMINISTER && !CRM_DELETE_PERMISSIONS.includes(key),
);
