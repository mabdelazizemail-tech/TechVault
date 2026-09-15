import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ButtonLink } from "@/components/ui/button";
import {
  EmptyState,
  PageHeader,
  Panel,
  PanelHeader,
  StatCard,
} from "@/components/ui/primitives";
import { ERP_PERMISSIONS } from "@/modules/erp/contracts/permissions";
import { getFinanceOverview } from "@/modules/erp/contracts/service";
import { JournalStatusBadge, PeriodStatusBadge } from "@/modules/erp/ui/badges";
import { formatAmount, formatDate } from "@/modules/erp/ui/format";
import { getActor } from "@/platform/auth/current-user";
import { canAllGlobally } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "Finance" };

/** The finance landing page: what needs doing, and what was just posted. */
export default async function FinanceDashboardPage() {
  const actor = await getActor();
  const [overview, rights] = await Promise.all([
    getFinanceOverview(actor),
    canAllGlobally(actor, [ERP_PERMISSIONS.JOURNAL_CREATE, ERP_PERMISSIONS.PERIOD_READ]),
  ]);

  return (
    <div>
      <PageHeader
        title="Finance"
        description="The chart of accounts, journal entries and accounting periods. Amounts are in EGP."
        actions={
          rights[ERP_PERMISSIONS.JOURNAL_CREATE] === true ? (
            <ButtonLink
              href="/erp/finance/journals/new"
              variant="primary"
              icon={<Plus aria-hidden="true" className="size-4" />}
            >
              New journal entry
            </ButtonLink>
          ) : undefined
        }
      />

      <section
        aria-label="Key figures"
        className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        {overview.draftCount !== null && (
          <CardLink href="/erp/finance/journals?status=DRAFT">
            <StatCard
              label="Draft entries"
              value={overview.draftCount}
              note="Waiting to be posted"
              className="h-full"
            />
          </CardLink>
        )}
        {overview.postedThisMonthCount !== null && (
          <StatCard
            label="Posted this month"
            value={overview.postedThisMonthCount}
            note="Entries dated this month"
          />
        )}
        {overview.activeAccountCount !== null && (
          <CardLink href="/erp/finance/accounts">
            <StatCard
              label="Postable accounts"
              value={overview.activeAccountCount}
              note="Active, taking postings"
              className="h-full"
            />
          </CardLink>
        )}
        {overview.openPeriods !== null && (
          <CardLink href="/erp/finance/periods">
            <StatCard
              label="Open periods"
              value={overview.openPeriods.length}
              note={
                overview.openPeriods.length === 0
                  ? "Create a period to post"
                  : "Accepting postings"
              }
              className="h-full"
            />
          </CardLink>
        )}
        {overview.arOutstandingMinor !== null && (
          <CardLink href="/erp/finance/aging">
            <StatCard
              label="Receivables outstanding"
              value={formatAmount(overview.arOutstandingMinor)}
              note="Posted invoices not yet paid, EGP"
              className="h-full"
            />
          </CardLink>
        )}
        {overview.arOverdueMinor !== null && (
          <CardLink href="/erp/finance/invoices?overdue=1">
            <StatCard
              label="Overdue"
              value={formatAmount(overview.arOverdueMinor)}
              note="Past the due date, EGP"
              className="h-full"
            />
          </CardLink>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {overview.recentJournals !== null && (
          <Panel>
            <PanelHeader
              title="Recently posted"
              actions={<HeaderLink href="/erp/finance/journals">All entries</HeaderLink>}
            />
            {overview.recentJournals.length === 0 ? (
              <EmptyState
                title="Nothing posted yet"
                description="Posted journal entries appear here, newest first."
              />
            ) : (
              <ol className="divide-border divide-y-2">
                {overview.recentJournals.map((entry) => (
                  <li key={entry.id}>
                    <Link
                      href={`/erp/finance/journals/${entry.id}`}
                      className="hover:bg-surface-hover flex items-center gap-3 px-4 py-3"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="text-foreground block truncate text-sm font-semibold">
                          {entry.journalNumber} ·{" "}
                          <span dir="auto">{entry.description}</span>
                        </span>
                        <span className="text-foreground-muted text-xs">
                          {formatDate(entry.entryDate)}
                        </span>
                      </span>
                      <JournalStatusBadge status={entry.status} />
                      <span
                        className="text-foreground shrink-0 text-sm font-bold tabular-nums"
                        dir="ltr"
                      >
                        {formatAmount(entry.totalMinor)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        )}

        {overview.openPeriods !== null && (
          <Panel>
            <PanelHeader
              title="Open periods"
              actions={<HeaderLink href="/erp/finance/periods">All periods</HeaderLink>}
            />
            {overview.openPeriods.length === 0 ? (
              <EmptyState
                title="No open periods"
                description="A journal entry can only be posted into an open accounting period that contains its date."
              />
            ) : (
              <ul className="divide-border divide-y-2">
                {overview.openPeriods.map((period) => (
                  <li key={period.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="min-w-0 flex-1">
                      <span
                        dir="auto"
                        className="text-foreground block text-sm font-semibold"
                      >
                        {period.name}
                      </span>
                      <span className="text-foreground-muted text-xs">
                        {formatDate(period.startDate)} – {formatDate(period.endDate)}
                      </span>
                    </span>
                    <PeriodStatusBadge status={period.status} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}
      </div>
    </div>
  );
}

function HeaderLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-primary-ink text-xs font-bold underline">
      {children}
    </Link>
  );
}

function CardLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="hover:[&>div]:bg-surface-hover block">
      {children}
    </Link>
  );
}
