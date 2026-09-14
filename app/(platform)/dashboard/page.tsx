import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  EmptyState,
  PageHeader,
  Panel,
  PanelHeader,
  StatCard,
} from "@/components/ui/primitives";
import { CRM_PERMISSIONS } from "@/modules/crm/contracts/permissions";
import { getCrmDashboard } from "@/modules/crm/contracts/service";
import { TimelineItem } from "@/modules/crm/ui/activity-timeline";
import { formatMoney } from "@/modules/crm/ui/format";
import { INNOVATION_PERMISSIONS } from "@/modules/innovation/contracts/permissions";
import { listIdeas } from "@/modules/innovation/contracts/service";
import { IdeaStatusBadge } from "@/modules/innovation/ui/badges";
import { getActor, requireUser } from "@/platform/auth/current-user";
import { canAll } from "@/platform/authz/authz";
import { IAM_PERMISSIONS, PLATFORM_PERMISSIONS } from "@/platform/iam/permissions";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * The cross-module landing page: a row of key figures, the tasks waiting for you,
 * and the ideas with the most support. Each block appears only for people who may
 * read what it shows, and each reads through its module's own permission-checked
 * service — money stays per currency, never summed across currencies.
 */
export default async function DashboardPage() {
  const [user, actor] = await Promise.all([requireUser(), getActor()]);
  const rights = await canAll(actor, [
    CRM_PERMISSIONS.ACCESS,
    CRM_PERMISSIONS.LEAD_READ,
    CRM_PERMISSIONS.ACTIVITY_READ,
    CRM_PERMISSIONS.ACTIVITY_UPDATE,
    INNOVATION_PERMISSIONS.IDEA_READ,
    IAM_PERMISSIONS.ACCESS,
    IAM_PERMISSIONS.USER_READ,
    IAM_PERMISSIONS.ROLE_READ,
    PLATFORM_PERMISSIONS.AUDIT_READ,
  ]);
  const hasCrm = rights[CRM_PERMISSIONS.ACCESS] === true;
  const hasIdeas = rights[INNOVATION_PERMISSIONS.IDEA_READ] === true;

  const [crm, topIdeas, newIdeas] = await Promise.all([
    hasCrm ? getCrmDashboard(actor) : null,
    hasIdeas ? listIdeas(actor, { sort: "top" }) : null,
    hasIdeas ? listIdeas(actor, { status: "NEW" }) : null,
  ]);

  const adminLinks = [
    {
      permission: IAM_PERMISSIONS.USER_READ,
      href: "/admin/users",
      label: "Users",
      description: "Accounts, roles and activation.",
    },
    {
      permission: IAM_PERMISSIONS.ROLE_READ,
      href: "/admin/roles",
      label: "Roles",
      description: "What each role is permitted to do.",
    },
    {
      permission: PLATFORM_PERMISSIONS.AUDIT_READ,
      href: "/admin/audit",
      label: "Audit trail",
      description: "Every business- and security-significant operation.",
    },
  ].filter((link) => rights[link.permission] === true);
  const showAdmin = rights[IAM_PERMISSIONS.ACCESS] === true && adminLinks.length > 0;

  const today = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Africa/Cairo",
  }).format(new Date());
  const firstName = user.fullName?.split(" ")[0];
  const ranked = (topIdeas?.rows ?? []).filter((idea) => idea.voteCount > 0).slice(0, 5);

  return (
    <div>
      <PageHeader
        title={firstName !== undefined ? `Welcome, ${firstName}` : "Dashboard"}
        description={`${today} — what needs your attention across TechVault.`}
      />

      {(crm !== null || newIdeas !== null) && (
        <section
          aria-label="Key figures"
          className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        >
          {crm !== null && rights[CRM_PERMISSIONS.LEAD_READ] === true && (
            <StatCardLink href="/crm/leads">
              <StatCard
                label="Leads"
                value={crm.totalLeads}
                note={`${crm.newLeads} new · ${crm.qualifiedLeads} qualified`}
                className="h-full"
              />
            </StatCardLink>
          )}
          {crm !== null &&
            (crm.pipeline.length === 0 ? (
              <StatCard label="Open pipeline" value="—" note="No open opportunities" />
            ) : (
              crm.pipeline.map((total) => (
                <StatCard
                  key={total.currency}
                  label={`Open pipeline (${total.currency})`}
                  value={formatMoney(total.amountMinor, total.currency)}
                  note={`${total.currency} deals only`}
                />
              ))
            ))}
          {newIdeas !== null && (
            <StatCardLink href="/innovation/ideas?status=NEW">
              <StatCard
                label="New ideas to review"
                value={newIdeas.total}
                note="The Think Tank"
                className="h-full"
              />
            </StatCardLink>
          )}
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {crm !== null && rights[CRM_PERMISSIONS.ACTIVITY_READ] === true && (
          <Panel>
            <PanelHeader
              title="My tasks due"
              actions={<HeaderLink href="/crm/tasks?mine=1">All tasks</HeaderLink>}
            />
            {crm.openTasks.length === 0 ? (
              <EmptyState
                title="Nothing due"
                description="Tasks you log on a lead, company, contact or deal show up here."
              />
            ) : (
              <ol>
                {crm.openTasks.map((task) => (
                  <TimelineItem
                    key={task.id}
                    activity={task}
                    canUpdateActivities={rights[CRM_PERMISSIONS.ACTIVITY_UPDATE] === true}
                  />
                ))}
              </ol>
            )}
          </Panel>
        )}

        {topIdeas !== null && (
          <Panel>
            <PanelHeader
              title="Top voted ideas"
              actions={
                <HeaderLink href="/innovation/ideas?sort=top">Open ideas</HeaderLink>
              }
            />
            {ranked.length === 0 ? (
              <EmptyState
                title="No votes yet"
                description="Ideas appear here as people give them a 👍."
              />
            ) : (
              <ol className="divide-border divide-y-2">
                {ranked.map((idea, index) => (
                  <li key={idea.id}>
                    <Link
                      href={`/innovation/ideas/${idea.id}`}
                      className="hover:bg-surface-hover flex items-center gap-3 px-4 py-3"
                    >
                      <span className="text-foreground-muted w-6 shrink-0 text-lg font-bold tabular-nums">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          dir="auto"
                          className="text-foreground block truncate text-sm font-semibold"
                        >
                          {idea.title}
                        </span>
                        <span dir="auto" className="text-foreground-muted text-xs">
                          {idea.submitter.name}
                        </span>
                      </span>
                      <IdeaStatusBadge status={idea.status} />
                      <span
                        className="text-foreground shrink-0 text-sm font-bold tabular-nums"
                        aria-label={`${idea.voteCount} votes`}
                      >
                        <span aria-hidden="true">👍 {idea.voteCount}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        )}

        {showAdmin && (
          <Panel className="lg:col-span-2">
            <PanelHeader title="Manage access" />
            <ul className="bg-border grid gap-0.5 sm:grid-cols-3">
              {adminLinks.map((link) => (
                <li key={link.href} className="bg-surface">
                  <Link
                    href={link.href}
                    className="hover:bg-surface-hover flex flex-col gap-0.5 px-4 py-3"
                  >
                    <span className="text-foreground text-sm font-bold">
                      {link.label} <span className="text-primary-ink">→</span>
                    </span>
                    <span className="text-foreground-muted text-xs">
                      {link.description}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {crm === null && topIdeas === null && !showAdmin && (
          <Panel className="lg:col-span-2">
            <EmptyState
              title="Nothing to show yet"
              description="Your dashboard fills in as modules are opened to your account. Ask an administrator if you expected to see something here."
            />
          </Panel>
        )}
      </div>
    </div>
  );
}

/** The red text link at the end of a panel header. */
function HeaderLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-primary-ink text-xs font-bold underline">
      {children}
    </Link>
  );
}

function StatCardLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="hover:[&>div]:bg-surface-hover block">
      {children}
    </Link>
  );
}
