import type { Metadata } from "next";
import Link from "next/link";
import { Panel, PanelHeader, PageHeader, Badge } from "@/components/ui/primitives";
import { requireUser } from "@/platform/auth/current-user";
import { canAll } from "@/platform/authz/authz";
import { IAM_PERMISSIONS, PLATFORM_PERMISSIONS } from "@/platform/iam/permissions";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * The cross-module landing page.
 *
 * Phase 1 deliberately shows only what is real: who you are signed in as, and
 * what you can reach. Module KPI tiles arrive with the modules themselves, and
 * aggregate figures arrive with BI in Phase 9 — reading them from transactional
 * tables on page load is exactly what §6.7 forbids. A dashboard of placeholder
 * numbers would be decorative UI (§17.6).
 */
export default async function DashboardPage() {
  const user = await requireUser();
  const permitted = await canAll({ id: user.id }, [
    IAM_PERMISSIONS.ACCESS,
    IAM_PERMISSIONS.USER_READ,
    PLATFORM_PERMISSIONS.AUDIT_READ,
  ]);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={`Welcome${user.fullName !== null ? `, ${user.fullName.split(" ")[0]}` : ""}`}
        description="TechVault is being built out module by module. What you can reach here reflects the permissions granted to your account."
      />

      <div className="grid gap-4 md:grid-cols-2">
        <Panel>
          <PanelHeader title="Your account" />
          <dl className="divide-border divide-y text-sm">
            <Row label="Email" value={user.email} />
            <Row label="Name" value={user.fullName ?? "—"} />
            <Row label="Organisational unit" value={user.orgUnitPath ?? "Unassigned"} />
            <Row
              label="Linked employee record"
              value={
                user.hrisEmployeeId !== null ? (
                  user.hrisEmployeeId
                ) : (
                  <span className="text-foreground-subtle">
                    None — HRIS arrives in Phase 7
                  </span>
                )
              }
            />
          </dl>
        </Panel>

        <Panel>
          <PanelHeader
            title="Platform status"
            description="Implementation progress, per CLAUDE.md §28."
          />
          <ul className="divide-border divide-y text-sm">
            <StatusRow label="Identity & access" tone="success" status="Available" />
            <StatusRow label="Audit trail" tone="success" status="Available" />
            <StatusRow
              label="Events (outbox)"
              tone="warning"
              status="Recording, dispatcher pending"
            />
            <StatusRow label="Documents (ECM)" tone="neutral" status="Phase 3" />
            <StatusRow label="Workflow engine" tone="neutral" status="Phase 4" />
            <StatusRow label="CRM" tone="neutral" status="Phase 5" />
            <StatusRow label="ERP finance" tone="neutral" status="Phase 6" />
          </ul>
        </Panel>
      </div>

      {permitted[IAM_PERMISSIONS.ACCESS] === true && (
        <Panel className="mt-4">
          <PanelHeader title="Administration" />
          <ul className="divide-border divide-y text-sm">
            {permitted[IAM_PERMISSIONS.USER_READ] === true && (
              <QuickLink
                href="/admin/users"
                label="Users"
                description="Accounts, roles and activation."
              />
            )}
            <QuickLink
              href="/admin/roles"
              label="Roles"
              description="What each role is permitted to do."
            />
            {permitted[PLATFORM_PERMISSIONS.AUDIT_READ] === true && (
              <QuickLink
                href="/admin/audit"
                label="Audit trail"
                description="Every business- and security-significant operation."
              />
            )}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
      <dt className="text-foreground-muted text-xs">{label}</dt>
      <dd className="text-foreground min-w-0 truncate text-end">{value}</dd>
    </div>
  );
}

function StatusRow({
  label,
  status,
  tone,
}: {
  label: string;
  status: string;
  tone: "success" | "warning" | "neutral";
}) {
  return (
    <li className="flex items-center justify-between gap-4 px-4 py-2.5">
      <span className="text-foreground">{label}</span>
      <Badge tone={tone}>{status}</Badge>
    </li>
  );
}

function QuickLink({
  href,
  label,
  description,
}: {
  href: string;
  label: string;
  description: string;
}) {
  return (
    <li>
      <Link href={href} className="hover:bg-surface-hover block px-4 py-2.5">
        <span className="text-primary font-medium">{label}</span>
        <span className="text-foreground-muted ms-2 text-xs">{description}</span>
      </Link>
    </li>
  );
}
