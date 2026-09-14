import type { Metadata } from "next";
import { DataTable, type Column } from "@/components/ui/data-table";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { ERP_PERMISSIONS } from "@/modules/erp/contracts/permissions";
import { listPeriods } from "@/modules/erp/contracts/service";
import type { PeriodDto } from "@/modules/erp/contracts/types";
import { PeriodStatusBadge } from "@/modules/erp/ui/badges";
import { formatDate, formatDateTime } from "@/modules/erp/ui/format";
import { flatParams, orNotFound } from "@/modules/erp/ui/page-helpers";
import {
  ClosePeriodButton,
  CreatePeriodButton,
  ReopenPeriodButton,
} from "@/modules/erp/ui/period-forms";
import { getActor } from "@/platform/auth/current-user";
import { canAll } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "Accounting periods" };

const BASE = "/erp/finance/periods";

export default async function PeriodsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = flatParams(await searchParams);
  const actor = await getActor();
  const [result, rights] = await Promise.all([
    orNotFound(listPeriods(actor, params)),
    canAll(actor, [
      ERP_PERMISSIONS.PERIOD_CREATE,
      ERP_PERMISSIONS.PERIOD_CLOSE,
      ERP_PERMISSIONS.PERIOD_REOPEN,
    ]),
  ]);
  const canClose = rights[ERP_PERMISSIONS.PERIOD_CLOSE] === true;
  const canReopen = rights[ERP_PERMISSIONS.PERIOD_REOPEN] === true;

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
