import type { Metadata } from "next";
import Link from "next/link";
import { KanbanSquare, Plus } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, PageHeader, Panel, PanelHeader } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { CRM_PERMISSIONS } from "@/modules/crm/contracts/permissions";
import { getCrmDashboard } from "@/modules/crm/contracts/service";
import type { MoneyTotal } from "@/modules/crm/contracts/types";
import { TimelineItem } from "@/modules/crm/ui/activity-timeline";
import { formatMoney, formatTotals } from "@/modules/crm/ui/format";
import { getActor } from "@/platform/auth/current-user";
import { canAll } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "CRM" };

/**
 * The CRM landing page: where the pipeline stands, what just happened, and what
 * needs doing next. Money figures are listed per currency, never combined.
 */
export default async function CrmDashboardPage() {
  const actor = await getActor();
  const [dashboard, rights] = await Promise.all([
    getCrmDashboard(actor),
    canAll(actor, [
      CRM_PERMISSIONS.LEAD_CREATE,
      CRM_PERMISSIONS.LEAD_READ,
      CRM_PERMISSIONS.OPPORTUNITY_READ,
      CRM_PERMISSIONS.ACTIVITY_READ,
      CRM_PERMISSIONS.ACTIVITY_UPDATE,
    ]),
  ]);

  const canReadLeads = rights[CRM_PERMISSIONS.LEAD_READ] === true;
  const canReadPipeline = rights[CRM_PERMISSIONS.OPPORTUNITY_READ] === true;
  const canUpdateActivities = rights[CRM_PERMISSIONS.ACTIVITY_UPDATE] === true;
  const maxCount = Math.max(1, ...dashboard.stageBreakdown.map((row) => row.count));

  return (
    <div>
      <PageHeader
        title="CRM"
        description="Where the pipeline stands, what just happened, and what needs doing next."
        actions={
          <>
            {canReadPipeline && (
              <ButtonLink
                href="/crm/opportunities"
                icon={<KanbanSquare aria-hidden="true" size={15} />}
              >
                Pipeline
              </ButtonLink>
            )}
            {rights[CRM_PERMISSIONS.LEAD_CREATE] === true && (
              <ButtonLink
                href="/crm/leads/new"
                variant="primary"
                icon={<Plus aria-hidden="true" size={15} />}
              >
                New lead
              </ButtonLink>
            )}
          </>
        }
      />

      <section
        aria-label="Key figures"
        className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-5"
      >
        <Kpi
          label="Leads"
          value={dashboard.totalLeads}
          note={`${dashboard.newLeads} new`}
          href={canReadLeads ? "/crm/leads" : undefined}
        />
        <Kpi
          label="Qualified leads"
          value={dashboard.qualifiedLeads}
          note="Ready to convert"
          href={canReadLeads ? "/crm/leads?status=QUALIFIED" : undefined}
        />
        <Kpi
          label="Open opportunities"
          value={dashboard.openOpportunities}
          totals={dashboard.pipeline}
          href={canReadPipeline ? "/crm/opportunities" : undefined}
        />
        <Kpi
          label="Won"
          value={dashboard.wonCount}
          totals={dashboard.won}
          note={`${dashboard.lostCount} lost`}
          tone="success"
        />
        <Kpi
          label="Lead conversion"
          value={
            dashboard.conversionRate === null
              ? "—"
              : `${Math.round(dashboard.conversionRate)}%`
          }
          note="Converted of all leads"
          className="col-span-2 lg:col-span-1"
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <PanelHeader
            kicker="Pipeline"
            title="Opportunities by stage"
            actions={
              canReadPipeline ? (
                <Link
                  href="/crm/opportunities"
                  className="text-primary-ink text-xs font-extrabold hover:underline"
                >
                  Open pipeline
                </Link>
              ) : undefined
            }
          />
          {dashboard.stageBreakdown.length === 0 ? (
            <EmptyState
              title="No pipeline yet"
              description="Opportunities appear here once leads are converted."
            />
          ) : (
            <ul className="px-4 py-1">
              {dashboard.stageBreakdown.map((row) => (
                <li
                  key={row.stage.id}
                  className="border-border grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 border-b py-2.5 last:border-0 sm:grid-cols-[8.5rem_minmax(0,1fr)_minmax(0,14rem)]"
                >
                  <span className="text-foreground truncate text-[13px]">
                    {row.stage.name}
                  </span>
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="bg-surface-sunken relative h-2 flex-1"
                    >
                      <span
                        className={cn(
                          "absolute inset-y-0 start-0",
                          row.stage.kind === "WON"
                            ? "bg-success"
                            : row.stage.kind === "LOST"
                              ? "bg-danger"
                              : "bg-primary",
                        )}
                        style={{ width: `${(row.count / maxCount) * 100}%` }}
                      />
                    </span>
                    <span className="text-foreground w-6 text-end text-[13px] font-extrabold tabular-nums">
                      {row.count}
                    </span>
                  </span>
                  <span className="text-foreground-muted col-start-2 truncate text-xs tabular-nums sm:col-start-auto sm:text-end">
                    {formatTotals(row.totals, { empty: "—" })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <PanelHeader
            kicker="Next up"
            title="My open tasks"
            actions={
              <Link
                href="/crm/tasks?mine=1"
                className="text-primary-ink text-xs font-extrabold hover:underline"
              >
                All tasks
              </Link>
            }
          />
          {dashboard.openTasks.length === 0 ? (
            <EmptyState
              title="Nothing due"
              description="Tasks you log on a lead, company, contact or deal show up here."
            />
          ) : (
            <ol>
              {dashboard.openTasks.map((task) => (
                <TimelineItem
                  key={task.id}
                  activity={task}
                  canUpdateActivities={canUpdateActivities}
                />
              ))}
            </ol>
          )}
        </Panel>

        <Panel className="lg:col-span-3">
          <PanelHeader
            kicker="Timeline"
            title="Recent activity"
            actions={
              rights[CRM_PERMISSIONS.ACTIVITY_READ] === true ? (
                <Link
                  href="/crm/activities"
                  className="text-primary-ink text-xs font-extrabold hover:underline"
                >
                  All activity
                </Link>
              ) : undefined
            }
          />
          {dashboard.recentActivity.length === 0 ? (
            <EmptyState
              title="No activity yet"
              description="Calls, emails, meetings and stage changes across the CRM appear here as they happen."
            />
          ) : (
            <ol className="lg:columns-2 lg:gap-0">
              {dashboard.recentActivity.map((activity) => (
                <div key={activity.id} className="break-inside-avoid">
                  <TimelineItem
                    activity={activity}
                    canUpdateActivities={canUpdateActivities}
                  />
                </div>
              ))}
            </ol>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  note,
  totals,
  href,
  tone,
  className,
}: {
  label: string;
  value: number | string;
  note?: string;
  totals?: MoneyTotal[];
  href?: string;
  tone?: "success";
  className?: string;
}) {
  const body = (
    <>
      <p className="label-caps">{label}</p>
      <p
        className={cn(
          "mt-1 text-3xl leading-none font-bold tracking-tight tabular-nums",
          tone === "success" ? "text-success" : "text-foreground",
        )}
      >
        {value}
      </p>
      {totals?.map((total) => (
        <p
          key={total.currency}
          className="text-foreground-muted truncate text-xs tabular-nums"
        >
          {formatMoney(total.amountMinor, total.currency)}
        </p>
      ))}
      {note !== undefined && <p className="text-foreground-muted text-xs">{note}</p>}
    </>
  );
  const classes = cn("panel flex min-w-0 flex-col gap-1.5 p-4", className);
  return href === undefined ? (
    <div className={classes}>{body}</div>
  ) : (
    <Link href={href} className={cn(classes, "hover:bg-surface-hover")}>
      {body}
    </Link>
  );
}
