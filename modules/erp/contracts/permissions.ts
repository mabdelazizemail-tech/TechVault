import type { PermissionDefinition } from "@/platform/authz/types";

/**
 * Permissions owned by ERP (CLAUDE.md §11.2), Phase 1: finance foundation.
 *
 * Declared here, assembled into the platform catalogue in `modules/catalogue.ts`,
 * seeded into `iam.permissions`. Import the constant — never write the string.
 *
 * Posting, reversing, closing and reopening are finance controls with their own
 * actions (ADR-022). The evaluator matches keys exactly and implies nothing between
 * them: holding `erp.journal.post` never lets anyone reverse, and closing a period
 * never lets anyone reopen one.
 */
export const ERP_PERMISSIONS = {
  ACCESS: "erp.module.access",

  ACCOUNT_READ: "erp.account.read",
  ACCOUNT_CREATE: "erp.account.create",
  ACCOUNT_UPDATE: "erp.account.update",
  ACCOUNT_ADMINISTER: "erp.account.administer",

  COST_CENTRE_READ: "erp.cost_centre.read",
  COST_CENTRE_CREATE: "erp.cost_centre.create",
  COST_CENTRE_UPDATE: "erp.cost_centre.update",

  PERIOD_READ: "erp.period.read",
  PERIOD_CREATE: "erp.period.create",
  PERIOD_CLOSE: "erp.period.close",
  PERIOD_REOPEN: "erp.period.reopen",

  JOURNAL_READ: "erp.journal.read",
  JOURNAL_CREATE: "erp.journal.create",
  JOURNAL_UPDATE: "erp.journal.update",
  JOURNAL_DELETE: "erp.journal.delete",
  JOURNAL_POST: "erp.journal.post",
  JOURNAL_REVERSE: "erp.journal.reverse",
} as const;

type ErpPermissionKey = (typeof ERP_PERMISSIONS)[keyof typeof ERP_PERMISSIONS];

function define(
  key: ErpPermissionKey,
  action: PermissionDefinition["action"],
  description: string,
): PermissionDefinition {
  const resource = key.split(".")[1] ?? "module";
  return { key, module: "erp", resource, action, description };
}

export const ERP_PERMISSION_DEFINITIONS: readonly PermissionDefinition[] = [
  define(ERP_PERMISSIONS.ACCESS, "ACCESS", "Open ERP finance."),

  define(
    ERP_PERMISSIONS.ACCOUNT_READ,
    "READ",
    "View the chart of accounts and account activity.",
  ),
  define(
    ERP_PERMISSIONS.ACCOUNT_CREATE,
    "CREATE",
    "Add accounts to the chart of accounts.",
  ),
  define(
    ERP_PERMISSIONS.ACCOUNT_UPDATE,
    "UPDATE",
    "Edit accounts: names, description, parent, type and whether they take postings.",
  ),
  define(
    ERP_PERMISSIONS.ACCOUNT_ADMINISTER,
    "ADMINISTER",
    "Activate and deactivate accounts.",
  ),

  define(ERP_PERMISSIONS.COST_CENTRE_READ, "READ", "View cost centres."),
  define(ERP_PERMISSIONS.COST_CENTRE_CREATE, "CREATE", "Add cost centres."),
  define(
    ERP_PERMISSIONS.COST_CENTRE_UPDATE,
    "UPDATE",
    "Edit, activate and deactivate cost centres.",
  ),

  define(ERP_PERMISSIONS.PERIOD_READ, "READ", "View accounting periods."),
  define(ERP_PERMISSIONS.PERIOD_CREATE, "CREATE", "Create accounting periods."),
  define(
    ERP_PERMISSIONS.PERIOD_CLOSE,
    "CLOSE",
    "Close an accounting period, which stops all posting into it.",
  ),
  define(
    ERP_PERMISSIONS.PERIOD_REOPEN,
    "REOPEN",
    "Reopen a closed accounting period. Every reopening is audited with a reason.",
  ),

  define(ERP_PERMISSIONS.JOURNAL_READ, "READ", "View journal entries."),
  define(ERP_PERMISSIONS.JOURNAL_CREATE, "CREATE", "Create draft journal entries."),
  define(ERP_PERMISSIONS.JOURNAL_UPDATE, "UPDATE", "Edit draft journal entries."),
  define(ERP_PERMISSIONS.JOURNAL_DELETE, "DELETE", "Delete draft journal entries."),
  define(
    ERP_PERMISSIONS.JOURNAL_POST,
    "POST",
    "Post journal entries to the ledger. A posted entry can never be changed.",
  ),
  define(
    ERP_PERMISSIONS.JOURNAL_REVERSE,
    "REVERSE",
    "Reverse posted journal entries with an equal and opposite entry.",
  ),
];

/** Role key for the seeded finance administrator: every ERP finance permission. */
export const ERP_FINANCE_ADMIN_ROLE = "finance-admin";

export const ERP_FINANCE_ADMIN_PERMISSIONS: readonly string[] =
  Object.values(ERP_PERMISSIONS);

/** Role key for the seeded accountant. */
export const ERP_ACCOUNTANT_ROLE = "accountant";

/**
 * Day-to-day bookkeeping: journals end to end, and maintaining accounts and cost
 * centres. Not creating, closing or reopening periods, and not deactivating
 * accounts — those are controls a finance administrator holds.
 */
export const ERP_ACCOUNTANT_PERMISSIONS: readonly string[] = [
  ERP_PERMISSIONS.ACCESS,
  ERP_PERMISSIONS.ACCOUNT_READ,
  ERP_PERMISSIONS.ACCOUNT_CREATE,
  ERP_PERMISSIONS.ACCOUNT_UPDATE,
  ERP_PERMISSIONS.COST_CENTRE_READ,
  ERP_PERMISSIONS.COST_CENTRE_CREATE,
  ERP_PERMISSIONS.COST_CENTRE_UPDATE,
  ERP_PERMISSIONS.PERIOD_READ,
  ERP_PERMISSIONS.JOURNAL_READ,
  ERP_PERMISSIONS.JOURNAL_CREATE,
  ERP_PERMISSIONS.JOURNAL_UPDATE,
  ERP_PERMISSIONS.JOURNAL_DELETE,
  ERP_PERMISSIONS.JOURNAL_POST,
  ERP_PERMISSIONS.JOURNAL_REVERSE,
];
