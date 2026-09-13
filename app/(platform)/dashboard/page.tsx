import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, PageHeader } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { requireUser } from "@/platform/auth/current-user";
import { canAll } from "@/platform/authz/authz";
import { IAM_PERMISSIONS, PLATFORM_PERMISSIONS } from "@/platform/iam/permissions";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * The cross-module landing page, laid out as the design's widget grid: cells on a
 * 12-column grid separated by hairlines rather than floating cards.
 *
 * Phase 1 deliberately shows only what is real: who you are signed in as, and
 * what you can reach. The design's KPI tiles, revenue chart, pipeline and approval
 * queue arrive with their modules — aggregate figures with BI in Phase 9. A
 * dashboard of placeholder numbers would be decorative UI (§17.6), and reading
 * aggregates from transactional tables on page load is what §6.7 forbids.
 */
export default async function DashboardPage() {
  const user = await requireUser();
  const permitted = await canAll({ id: user.id }, [
    IAM_PERMISSIONS.ACCESS,
    IAM_PERMISSIONS.USER_READ,
    IAM_PERMISSIONS.ROLE_READ,
    PLATFORM_PERMISSIONS.AUDIT_READ,
  ]);

  const adminLinks: { href: string; label: string; description: string }[] = [];
  if (permitted[IAM_PERMISSIONS.USER_READ] === true) {
    adminLinks.push({
      href: "/admin/users",
      label: "Users",
      description: "Accounts, roles and activation.",
    });
  }
  if (permitted[IAM_PERMISSIONS.ROLE_READ] === true) {
    adminLinks.push({
      href: "/admin/roles",
      label: "Roles",
      description: "What each role is permitted to do.",
    });
  }
  if (permitted[PLATFORM_PERMISSIONS.AUDIT_READ] === true) {
    adminLinks.push({
      href: "/admin/audit",
      label: "Audit trail",
      description: "Every business- and security-significant operation.",
    });
  }

  const firstName = user.fullName?.split(" ")[0];

  return (
    <div>
      <PageHeader
        title={firstName !== undefined ? `Welcome, ${firstName}` : "Overview"}
        description="TechVault is being built out module by module. What you can reach here reflects the permissions granted to your account."
      />

      <div className="bg-border border-border grid grid-cols-12 gap-px border-y">
        <Widget
          kicker="Identity"
          title="Your account"
          className="col-span-12 lg:col-span-5"
        >
          <dl>
            <Row label="Email" value={user.email} />
            <Row label="Name" value={user.fullName ?? "—"} />
            <Row label="Organisational unit" value={user.orgUnitPath ?? "Unassigned"} />
            <Row
              label="Linked employee record"
              value={
                user.hrisEmployeeId ?? (
                  <span className="text-foreground-subtle">
                    None — HRIS arrives in Phase 7
                  </span>
                )
              }
            />
          </dl>
        </Widget>

        <Widget
          kicker="Platform"
          title="Build status"
          className="col-span-12 lg:col-span-7"
        >
          <ul>
            <StatusRow label="Identity & access" tone="success" status="Available" />
            <StatusRow label="Audit trail" tone="success" status="Available" />
            <StatusRow
              label="Events (outbox)"
              tone="warning"
              status="Recording · dispatcher pending"
            />
            <StatusRow label="Documents (ECM)" tone="neutral" status="Phase 3" />
            <StatusRow label="Workflow engine" tone="neutral" status="Phase 4" />
            <StatusRow label="CRM" tone="neutral" status="Phase 5" />
            <StatusRow label="ERP finance" tone="neutral" status="Phase 6" />
          </ul>
        </Widget>

        {permitted[IAM_PERMISSIONS.ACCESS] === true && adminLinks.length > 0 && (
          <Widget kicker="Administration" title="Manage access" className="col-span-12">
            <ul className="bg-border grid gap-px sm:grid-cols-3">
              {adminLinks.map((link) => (
                <li key={link.href} className="bg-surface">
                  <Link
                    href={link.href}
                    className="hover:bg-surface-hover flex flex-col gap-0.5 px-4 py-3"
                  >
                    <span className="text-foreground text-[13.5px] font-extrabold">
                      {link.label} <span className="text-primary-ink">→</span>
                    </span>
                    <span className="text-foreground-muted text-xs">
                      {link.description}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Widget>
        )}
      </div>
    </div>
  );
}

function Widget({
  kicker,
  title,
  className,
  children,
}: {
  kicker: string;
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("bg-surface flex min-w-0 flex-col", className)}>
      <div className="px-4 pt-3 pb-2.5">
        <p className="kicker text-primary-ink">{kicker}</p>
        <h2 className="text-foreground mt-0.5 text-base">{title}</h2>
      </div>
      <div className="border-border border-t">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="border-border flex items-baseline justify-between gap-4 border-b px-4 py-2.5 last:border-0">
      <dt className="text-foreground-muted text-[10.5px] tracking-[0.08em] uppercase">
        {label}
      </dt>
      <dd className="text-foreground min-w-0 truncate text-end text-[13px]">{value}</dd>
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
    <li className="border-border flex items-center justify-between gap-4 border-b px-4 py-2.5 last:border-0">
      <span className="text-foreground text-[13px] font-extrabold">{label}</span>
      <Badge tone={tone}>{status}</Badge>
    </li>
  );
}
