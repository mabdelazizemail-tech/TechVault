import { CRM_PERMISSIONS } from "@/modules/crm/contracts/permissions";
import { ERP_PERMISSIONS } from "@/modules/erp/contracts/permissions";
import { INNOVATION_PERMISSIONS } from "@/modules/innovation/contracts/permissions";
import { IAM_PERMISSIONS, PLATFORM_PERMISSIONS } from "@/platform/iam/permissions";

/**
 * The single navigation definition for the whole platform (CLAUDE.md §16.2).
 *
 * No module ships its own sidebar. Every entry names the permission that gates
 * it, and the shell renders only what the signed-in user may reach — so the
 * navigation is accurate by construction rather than by maintenance.
 *
 * Entries for modules that are not built yet are listed here deliberately. Their
 * permissions do not exist in the catalogue, so they never render; the day a
 * module seeds its `*.module.access` permission, its section appears. That is
 * better than a hardcoded list somebody forgets to update — and better than
 * showing dead links to screens that do not exist.
 */

export type NavItem = {
  label: string;
  href: string;
  /** The permission required to see this entry. */
  permission: string;
  /** Highlight only on an exact path match — for a section's own landing page. */
  exact?: boolean;
};

export type NavSection = {
  key: string;
  label: string;
  /** Permission gating the whole section. */
  permission: string;
  items: readonly NavItem[];
};

/** Reachable by anyone signed in — it shows only what the user may already see. */
export const DASHBOARD_ITEM: NavItem = {
  label: "Dashboard",
  href: "/dashboard",
  permission: "*",
};

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    key: "crm",
    label: "CRM",
    permission: CRM_PERMISSIONS.ACCESS,
    items: [
      {
        label: "CRM dashboard",
        href: "/crm",
        permission: CRM_PERMISSIONS.ACCESS,
        exact: true,
      },
      { label: "Leads", href: "/crm/leads", permission: CRM_PERMISSIONS.LEAD_READ },
      {
        label: "Opportunities",
        href: "/crm/opportunities",
        permission: CRM_PERMISSIONS.OPPORTUNITY_READ,
      },
      {
        label: "Companies",
        href: "/crm/accounts",
        permission: CRM_PERMISSIONS.ACCOUNT_READ,
      },
      {
        label: "Contacts",
        href: "/crm/contacts",
        permission: CRM_PERMISSIONS.CONTACT_READ,
      },
      {
        label: "Activities",
        href: "/crm/activities",
        permission: CRM_PERMISSIONS.ACTIVITY_READ,
      },
      { label: "Tasks", href: "/crm/tasks", permission: CRM_PERMISSIONS.ACTIVITY_READ },
      { label: "Notes", href: "/crm/notes", permission: CRM_PERMISSIONS.ACTIVITY_READ },
    ],
  },
  {
    key: "erp",
    label: "ERP Finance",
    permission: ERP_PERMISSIONS.ACCESS,
    items: [
      {
        label: "Finance dashboard",
        href: "/erp/finance",
        permission: ERP_PERMISSIONS.ACCESS,
        exact: true,
      },
      {
        label: "Chart of accounts",
        href: "/erp/finance/accounts",
        permission: ERP_PERMISSIONS.ACCOUNT_READ,
      },
      {
        label: "Journal entries",
        href: "/erp/finance/journals",
        permission: ERP_PERMISSIONS.JOURNAL_READ,
      },
      {
        label: "Financial reports",
        href: "/erp/finance/reports",
        permission: ERP_PERMISSIONS.JOURNAL_READ,
      },
      {
        label: "Accounting periods",
        href: "/erp/finance/periods",
        permission: ERP_PERMISSIONS.PERIOD_READ,
      },
      {
        label: "Cost centres",
        href: "/erp/finance/cost-centres",
        permission: ERP_PERMISSIONS.COST_CENTRE_READ,
      },
      {
        label: "Finance settings",
        href: "/erp/finance/settings",
        permission: ERP_PERMISSIONS.FINANCE_SETTINGS_ADMINISTER,
      },
      {
        label: "Invoices",
        href: "/erp/finance/invoices",
        permission: ERP_PERMISSIONS.AR_INVOICE_READ,
      },
      {
        label: "Credit notes",
        href: "/erp/finance/credit-notes",
        permission: ERP_PERMISSIONS.AR_CREDIT_NOTE_READ,
      },
      {
        label: "Receipts",
        href: "/erp/finance/receipts",
        permission: ERP_PERMISSIONS.AR_RECEIPT_READ,
      },
      {
        label: "Customers",
        href: "/erp/finance/customers",
        permission: ERP_PERMISSIONS.AR_CUSTOMER_READ,
      },
      {
        label: "AR aging",
        href: "/erp/finance/aging",
        permission: ERP_PERMISSIONS.AR_AGING_READ,
      },
      {
        label: "AR settings",
        href: "/erp/finance/ar-settings",
        permission: ERP_PERMISSIONS.AR_SETTINGS_ADMINISTER,
      },
    ],
  },
  {
    key: "ecm",
    label: "Documents",
    permission: "ecm.module.access",
    items: [
      { label: "All documents", href: "/ecm/documents", permission: "ecm.document.read" },
      { label: "Batches", href: "/ecm/batches", permission: "ecm.batch.read" },
      {
        label: "Document types",
        href: "/ecm/document-types",
        permission: "ecm.document_type.read",
      },
    ],
  },
  {
    key: "hris",
    label: "People",
    permission: "hris.module.access",
    items: [
      { label: "Employees", href: "/hris/employees", permission: "hris.employee.read" },
      { label: "Leave", href: "/hris/leave", permission: "hris.leave.read" },
      {
        label: "Organisation",
        href: "/hris/organisation",
        permission: "hris.org_structure.read",
      },
    ],
  },
  {
    key: "innovation",
    label: "The Think Tank",
    permission: INNOVATION_PERMISSIONS.ACCESS,
    items: [
      {
        label: "Overview",
        href: "/innovation",
        permission: INNOVATION_PERMISSIONS.ACCESS,
        exact: true,
      },
      {
        label: "Ideas",
        href: "/innovation/ideas",
        permission: INNOVATION_PERMISSIONS.IDEA_READ,
      },
      {
        label: "Knowledge",
        href: "/innovation/knowledge",
        permission: INNOVATION_PERMISSIONS.KNOWLEDGE_READ,
      },
      {
        label: "Projects",
        href: "/innovation/projects",
        permission: INNOVATION_PERMISSIONS.PROJECT_READ,
      },
      {
        label: "Ask Think Tank",
        href: "/innovation/ask",
        permission: INNOVATION_PERMISSIONS.ASSISTANT_ACCESS,
      },
      {
        label: "Categories",
        href: "/innovation/categories",
        permission: INNOVATION_PERMISSIONS.CATEGORY_ADMINISTER,
      },
    ],
  },
  {
    key: "bi",
    label: "Analytics",
    permission: "bi.module.access",
    items: [
      { label: "Dashboards", href: "/bi/dashboards", permission: "bi.dashboard.read" },
      { label: "Reports", href: "/bi/reports", permission: "bi.report.read" },
    ],
  },
  {
    key: "admin",
    label: "Administration",
    permission: IAM_PERMISSIONS.ACCESS,
    items: [
      { label: "Users", href: "/admin/users", permission: IAM_PERMISSIONS.USER_READ },
      { label: "Roles", href: "/admin/roles", permission: IAM_PERMISSIONS.ROLE_READ },
      {
        label: "Permissions",
        href: "/admin/permissions",
        permission: IAM_PERMISSIONS.PERMISSION_READ,
      },
      {
        label: "Organisation units",
        href: "/admin/org-units",
        permission: IAM_PERMISSIONS.ORG_UNIT_READ,
      },
      {
        label: "Audit trail",
        href: "/admin/audit",
        permission: PLATFORM_PERMISSIONS.AUDIT_READ,
      },
    ],
  },
];

/** Every permission the shell needs to decide what to render, in one batch. */
export function navigationPermissionKeys(): string[] {
  const keys = new Set<string>();
  for (const section of NAV_SECTIONS) {
    keys.add(section.permission);
    for (const item of section.items) keys.add(item.permission);
  }
  return [...keys];
}

/**
 * Label for a breadcrumb: the navigation entry at exactly this path when there is
 * one, so /erp/finance/accounts reads "Chart of accounts" rather than CRM's
 * "Companies", which also ends in /accounts.
 */
export function labelForPath(href: string, segment: string): string {
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      if (item.href === href) return item.label;
    }
  }
  return labelForSegment(segment);
}

/** Human-readable label for a path segment, used by breadcrumbs. */
export function labelForSegment(segment: string): string {
  for (const section of NAV_SECTIONS) {
    if (section.key === segment) return section.label;
    for (const item of section.items) {
      if (item.href.endsWith(`/${segment}`)) return item.label;
    }
  }
  return segment
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
