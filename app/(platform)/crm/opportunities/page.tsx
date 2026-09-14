import type { Metadata } from "next";
import Link from "next/link";
import { KanbanSquare, Plus, Table2 } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { CRM_PERMISSIONS } from "@/modules/crm/contracts/permissions";
import {
  getPipeline,
  listOpportunities,
  listStages,
} from "@/modules/crm/contracts/service";
import type { OpportunityListItem } from "@/modules/crm/contracts/types";
import { Avatar, ChannelBadge, StageBadge } from "@/modules/crm/ui/badges";
import { formatDate, formatMoney } from "@/modules/crm/ui/format";
import { flatParams, orNotFound } from "@/modules/crm/ui/page-helpers";
import { PipelineBoard } from "@/modules/crm/ui/pipeline-board";
import { PipelineFilters } from "@/modules/crm/ui/pipeline-filters";
import { PipelineSummary } from "@/modules/crm/ui/pipeline-summary";
import { getActor } from "@/platform/auth/current-user";
import { canAll } from "@/platform/authz/authz";
import { listDirectory } from "@/platform/iam/services/directory-service";

export const metadata: Metadata = { title: "Pipeline" };

const FILTER_KEYS = [
  "q",
  "ownerId",
  "stageId",
  "currency",
  "channel",
  "industry",
  "source",
  "minAmount",
  "maxAmount",
  "closeFrom",
  "closeTo",
] as const;

/**
 * The opportunity pipeline: overview figures, filters, and the kanban board —
 * or the same opportunities as a sortable table.
 */
export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = flatParams(await searchParams);
  const actor = await getActor();
  const view = params.view === "table" ? "table" : "board";

  const filters = Object.fromEntries(FILTER_KEYS.map((key) => [key, params[key]]));

  const [board, table, stages, owners, rights] = await Promise.all([
    orNotFound(getPipeline(actor, filters)),
    view === "table"
      ? orNotFound(listOpportunities(actor, params, filters))
      : Promise.resolve(null),
    listStages(actor),
    listDirectory(actor),
    canAll(actor, [
      CRM_PERMISSIONS.OPPORTUNITY_CREATE,
      CRM_PERMISSIONS.OPPORTUNITY_UPDATE,
    ]),
  ]);

  const viewHref = (target: "board" | "table") => {
    const query = new URLSearchParams();
    for (const key of FILTER_KEYS) {
      const value = params[key];
      if (value !== undefined && value !== "") query.set(key, value);
    }
    if (target === "table") query.set("view", "table");
    const text = query.toString();
    return text === "" ? "/crm/opportunities" : `/crm/opportunities?${text}`;
  };

  return (
    <div>
      <PageHeader
        title="Pipeline"
        description="Drag deals between stages to update them. Every move is saved and recorded on the deal's timeline."
        actions={
          <>
            <nav aria-label="View" className="border-border-strong flex border">
              <ViewLink
                href={viewHref("board")}
                active={view === "board"}
                icon={<KanbanSquare size={15} />}
              >
                Board
              </ViewLink>
              <ViewLink
                href={viewHref("table")}
                active={view === "table"}
                icon={<Table2 size={15} />}
              >
                Table
              </ViewLink>
            </nav>
            {rights[CRM_PERMISSIONS.OPPORTUNITY_CREATE] === true && (
              <ButtonLink
                href="/crm/opportunities/new"
                variant="primary"
                icon={<Plus size={15} />}
              >
                New opportunity
              </ButtonLink>
            )}
          </>
        }
      />

      <PipelineSummary summary={board.summary} />

      <PipelineFilters
        basePath="/crm/opportunities"
        values={{ ...filters, view: view === "table" ? "table" : undefined }}
        owners={owners}
        stages={stages}
      />

      {view === "board" ? (
        <PipelineBoard
          columns={board.columns}
          canMove={rights[CRM_PERMISSIONS.OPPORTUNITY_UPDATE] === true}
        />
      ) : (
        table !== null && (
          <Panel className="overflow-hidden">
            <DataTable<OpportunityListItem>
              columns={COLUMNS}
              rows={table.rows}
              rowKey={(row) => row.id}
              rowHref={(row) => `/crm/opportunities/${row.id}`}
              basePath="/crm/opportunities"
              searchParams={{ ...filters, view: "table" }}
              sort={{
                key: params.sort ?? "closeDate",
                direction: params.dir === "desc" ? "desc" : "asc",
              }}
              page={{ page: table.page, pageSize: table.pageSize, total: table.total }}
              emptyTitle="No opportunities match"
              emptyDescription="Clear the filters, or convert a qualified lead into an opportunity."
            />
          </Panel>
        )
      )}
    </div>
  );
}

function ViewLink({
  href,
  active,
  icon,
  children,
}: {
  href: string;
  active: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-9 items-center gap-1.5 px-3 text-sm",
        active
          ? "bg-foreground text-canvas font-extrabold"
          : "text-foreground hover:bg-surface-hover",
      )}
    >
      {icon}
      {children}
    </Link>
  );
}

const COLUMNS: readonly Column<OpportunityListItem>[] = [
  {
    key: "name",
    header: "Opportunity",
    sortable: true,
    cell: (row) => <span dir="auto">{row.name}</span>,
  },
  {
    key: "account",
    header: "Company",
    sortable: true,
    hideOnMobile: true,
    cell: (row) => <span dir="auto">{row.account.name}</span>,
  },
  {
    key: "stage",
    header: "Stage",
    sortable: true,
    cell: (row) => <StageBadge name={row.stage.name} kind={row.stage.kind} />,
  },
  {
    key: "amount",
    header: "Amount",
    sortable: true,
    align: "end",
    cell: (row) => (
      <span className="font-extrabold">{formatMoney(row.amountMinor, row.currency)}</span>
    ),
  },
  {
    key: "closeDate",
    header: "Close",
    sortable: true,
    hideOnMobile: true,
    cell: (row) => formatDate(row.closeDate),
  },
  {
    key: "probability",
    header: "Prob.",
    sortable: true,
    align: "end",
    hideOnMobile: true,
    cell: (row) => `${row.probability}%`,
  },
  {
    key: "channel",
    header: "Channel",
    hideOnMobile: true,
    cell: (row) => <ChannelBadge channel={row.channel} partnerName={row.partnerName} />,
  },
  {
    key: "owner",
    header: "Owner",
    hideOnMobile: true,
    cell: (row) =>
      row.owner === null ? (
        "—"
      ) : (
        <span className="flex items-center gap-2">
          <Avatar name={row.owner.name} />
          {row.owner.name}
        </span>
      ),
  },
];
