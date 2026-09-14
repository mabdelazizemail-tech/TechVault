import { CRM_PERMISSIONS } from "@/modules/crm/contracts/permissions";
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
        label: "Dashboard",
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
    label: "ERP",
    permission: "erp.module.access",
    items: [
      { label: "Invoices", href: "/erp/invoices", permission: "erp.invoice.read" },
      { label: "Payments", href: "/erp/payments", permission: "erp.payment.read" },
      {
        label: "Purchase orders",
        href: "/erp/purchase-orders",
        permission: "erp.purchase_order.read",
      },
      { label: "Inventory", href: "/erp/inventory", permission: "erp.inventory.read" },
      { label: "Projects", href: "/erp/projects", permission: "erp.project.read" },
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
    label: "Think Tank",
    permission: "innovation.module.access",
    items: [
      { label: "Ideas", href: "/innovation/ideas", permission: "innovation.idea.read" },
      {
        label: "Leaderboard",
        href: "/innovation/leaderboard",
        permission: "innovation.leaderboard.read",
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
