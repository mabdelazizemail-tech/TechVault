import type { Metadata } from "next";
import Link from "next/link";
import { DataTable, type Column } from "@/components/ui/data-table";
import {
  Badge,
  EmptyState,
  PageHeader,
  Panel,
  PanelHeader,
} from "@/components/ui/primitives";
import { ERP_PERMISSIONS } from "@/modules/erp/contracts/permissions";
import { listFiscalYears, listPeriods } from "@/modules/erp/contracts/service";
import type { PeriodDto } from "@/modules/erp/contracts/types";
import { PeriodStatusBadge } from "@/modules/erp/ui/badges";
import { formatAmount, formatDate, formatDateTime } from "@/modules/erp/ui/format";
import { flatParams, orNotFound } from "@/modules/erp/ui/page-helpers";
import {
  ClosePeriodButton,
  CreatePeriodButton,
  ReopenPeriodButton,
} from "@/modules/erp/ui/period-forms";
import { CloseYearButton, ReopenYearButton } from "@/modules/erp/ui/year-end-forms";
import { getActor } from "@/platform/auth/current-user";
import { canAllGlobally } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "Accounting periods" };

const BASE = "/erp/finance/periods";

export default async function PeriodsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = flatParams(await searchParams);
  const actor = await getActor();
  const [result, years, rights] = await Promise.all([
    orNotFound(listPeriods(actor, params)),
    orNotFound(listFiscalYears(actor)),
    canAllGlobally(actor, [
      ERP_PERMISSIONS.PERIOD_CREATE,
      ERP_PERMISSIONS.PERIOD_CLOSE,
      ERP_PERMISSIONS.PERIOD_REOPEN,
      ERP_PERMISSIONS.FISCAL_YEAR_CLOSE,
      ERP_PERMISSIONS.FISCAL_YEAR_REOPEN,
    ]),
  ]);
  const canClose = rights[ERP_PERMISSIONS.PERIOD_CLOSE] === true;
  const canReopen = rights[ERP_PERMISSIONS.PERIOD_REOPEN] === true;
  const canCloseYear = rights[ERP_PERMISSIONS.FISCAL_YEAR_CLOSE] === true;
  const canReopenYear = rights[ERP_PERMISSIONS.FISCAL_YEAR_REOPEN] === true;

  const columns: Column<PeriodDto>[] = [
    {
      key: "name",
      header: "Period",
      cell: (period) => (
        <span dir="auto" className="font-semibold">
          {period.name}
        </span>
      ),
    },
    { key: "start", header: "Start", cell: (period) => formatDate(period.startDate) },
    { key: "end", header: "End", cell: (period) => formatDate(period.endDate) },
    {
      key: "status",
      header: "Status",
      cell: (period) => <PeriodStatusBadge status={period.status} />,
    },
    {
      key: "entries",
      header: "Posted entries",
      align: "end",
      hideOnMobile: true,
      cell: (period) => period.postedEntryCount,
    },
    {
      key: "history",
      header: "Last change",
      hideOnMobile: true,
      cell: (period) =>
        period.status === "CLOSED" &&
        period.closedBy !== null &&
        period.closedAt !== null ? (
          <span className="text-foreground-muted text-xs">
            Closed by <span dir="auto">{period.closedBy.name}</span>,{" "}
            {formatDateTime(period.closedAt)}
          </span>
        ) : period.reopenedBy !== null && period.reopenedAt !== null ? (
          <span className="text-foreground-muted text-xs">
            Reopened by <span dir="auto">{period.reopenedBy.name}</span>,{" "}
            {formatDateTime(period.reopenedAt)}
          </span>
        ) : (
          "—"
        ),
    },
    {
      key: "actions",
      header: "Actions",
      align: "end",
      cell: (period) =>
        period.status === "OPEN"
          ? canClose && <ClosePeriodButton periodId={period.id} name={period.name} />
          : canReopen && <ReopenPeriodButton periodId={period.id} name={period.name} />,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Accounting periods"
        description="A journal entry is posted into the open period containing its date. Closing a period stops all posting into it."
        actions={
          rights[ERP_PERMISSIONS.PERIOD_CREATE] === true ? (
            <CreatePeriodButton />
          ) : undefined
        }
      />
      <Panel className="mb-4 overflow-hidden">
        <PanelHeader
          title="Fiscal years"
          description="Calendar years. Closing a year moves its profit or loss into retained earnings and stops all posting into it."
        />
        {years.length === 0 ? (
          <EmptyState
            title="No fiscal years yet"
            description="A year appears here once an accounting period falls in it."
          />
        ) : (
          <ul className="divide-border divide-y">
            {years.map((fiscalYear) => (
              <li
                key={fiscalYear.year}
                className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="font-semibold tabular-nums">{fiscalYear.year}</span>
                    <Badge tone={fiscalYear.status === "CLOSED" ? "neutral" : "success"}>
                      {fiscalYear.status === "CLOSED" ? "Closed" : "Open"}
                    </Badge>
                  </span>
                  <span className="text-foreground-muted block text-xs">
                    {fiscalYear.status === "CLOSED" ? (
                      <>
                        {(fiscalYear.netIncomeMinor ?? 0) < 0 ? "Net loss" : "Net profit"}{" "}
                        <span dir="ltr">
                          {formatAmount(Math.abs(fiscalYear.netIncomeMinor ?? 0))}
                        </span>{" "}
                        closed
                        {fiscalYear.closingJournal !== null && (
                          <>
                            {" "}
                            with{" "}
                            <Link
                              href={`/erp/finance/journals/${fiscalYear.closingJournal.id}`}
                              className="font-semibold hover:underline"
                            >
                              {fiscalYear.closingJournal.journalNumber}
                            </Link>
                          </>
                        )}
                        {fiscalYear.closedBy !== null && fiscalYear.closedAt !== null && (
                          <>
                            {" "}
                            by <span dir="auto">{fiscalYear.closedBy.name}</span>,{" "}
                            {formatDateTime(fiscalYear.closedAt)}
                          </>
                        )}
                      </>
                    ) : fiscalYear.reopenedAt !== null &&
                      fiscalYear.reopenedBy !== null ? (
                      <>
                        Reopened by <span dir="auto">{fiscalYear.reopenedBy.name}</span>,{" "}
                        {formatDateTime(fiscalYear.reopenedAt)}
                      </>
                    ) : fiscalYear.hasEnded ? (
                      "Ended and not yet closed."
                    ) : (
                      "In progress."
                    )}
                  </span>
                </span>
                {fiscalYear.status === "OPEN" && fiscalYear.hasEnded && canCloseYear && (
                  <CloseYearButton year={fiscalYear.year} />
                )}
                {fiscalYear.status === "CLOSED" && canReopenYear && (
                  <ReopenYearButton year={fiscalYear.year} />
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel className="overflow-hidden">
        <DataTable
          columns={columns}
          rows={result.rows}
          rowKey={(period) => period.id}
          basePath={BASE}
          searchParams={params}
          page={{ page: result.page, pageSize: result.pageSize, total: result.total }}
          emptyTitle="No accounting periods yet"
          emptyDescription="Create a period — a month, a quarter or a year — before posting journal entries into it."
        />
      </Panel>
    </div>
  );
}
