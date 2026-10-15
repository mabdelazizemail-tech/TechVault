import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filter-bar";
import { Badge, PageHeader, Panel } from "@/components/ui/primitives";
import { listMissions } from "@/modules/committees/contracts/service";
import type { MissionDto } from "@/modules/committees/contracts/types";
import { formatExpenseAmount } from "@/modules/committees/domain/expenses";
import {
  EditMissionButton,
  NewMissionButton,
} from "@/modules/committees/ui/mission-form";
import { flatParams, orNotFound } from "@/modules/committees/ui/page-helpers";
import { getActor } from "@/platform/auth/current-user";

export const metadata: Metadata = { title: "Missions" };

const BASE = "/committees/missions";

const columns: Column<MissionDto>[] = [
  {
    key: "name",
    header: "Mission",
    cell: (mission) => (
      <span className="block max-w-sm">
        <span dir="auto">{mission.name}</span>
        {mission.description !== null && (
          <span dir="auto" className="text-foreground-muted block text-xs font-normal">
            {mission.description}
          </span>
        )}
      </span>
    ),
  },
  {
    key: "currency",
    header: "Default currency",
    cell: (mission) => mission.defaultCurrency,
  },
  {
    key: "expenses",
    header: "Expenses",
    align: "end",
    cell: (mission) =>
      mission.expenseCount === 0 ? (
        0
      ) : (
        <Link
          href={`/committees/expenses?mission=${mission.id}`}
          className="text-primary-ink font-bold hover:underline"
        >
          {mission.expenseCount}
        </Link>
      ),
  },
  {
    key: "total",
    header: "Total claimed (USD)",
    align: "end",
    cell: (mission) =>
      mission.totals === null || mission.totals.currencies.length === 0 ? (
        <span className="text-foreground-muted">—</span>
      ) : (
        <span className="inline-flex flex-col items-end gap-0.5 tabular-nums">
          <span className="text-foreground font-semibold">
            {formatExpenseAmount(mission.totals.usd.claimedMinor, "USD")}
          </span>
          <span className="text-foreground-muted text-xs">
            {formatExpenseAmount(mission.totals.usd.approvedMinor, "USD")} approved
          </span>
          {mission.totals.usd.pendingCount > 0 && (
            <span className="text-warning text-xs">
              {mission.totals.usd.pendingCount} not converted yet
            </span>
          )}
          {/* What was actually spent, before conversion. */}
          <span className="text-foreground-muted mt-1 text-xs">
            {mission.totals.currencies
              .map((total) => formatExpenseAmount(total.claimedMinor, total.currency))
              .join(" · ")}
          </span>
        </span>
      ),
  },
  {
    key: "status",
    header: "Status",
    cell: (mission) =>
      mission.isActive ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>,
  },
  {
    key: "edit",
    header: "",
    align: "end",
    cell: (mission) => (
      <EditMissionButton
        mission={{
          id: mission.id,
          name: mission.name,
          description: mission.description,
          defaultCurrency: mission.defaultCurrency,
          isActive: mission.isActive,
        }}
      />
    ),
  },
];

/** The missions expenses are claimed against: add, edit and deactivate (administrators). */
export default async function MissionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = flatParams(await searchParams);
  const show = params.show === "inactive" ? "inactive" : "active";
  const actor = await getActor();
  const page = await orNotFound(
    listMissions(actor, { page: Number(params.page) || 1, show, q: params.q }),
  );

  return (
    <div>
      <PageHeader
        title="Missions"
        description="Trips and visits that expenses are claimed against, with what has been claimed on each in USD — every claim at the exchange rate of the moment it was submitted, rejected claims left out. Deactivate a finished mission: its expenses stay, and it is no longer offered on the expense form."
        actions={<NewMissionButton />}
      />

      <nav aria-label="Show" className="mb-3 flex gap-2">
        <ButtonLink
          href={BASE}
          size="sm"
          variant={show === "active" ? "primary" : "secondary"}
          aria-current={show === "active" ? "page" : undefined}
        >
          Active
        </ButtonLink>
        <ButtonLink
          href={`${BASE}?show=inactive`}
          size="sm"
          variant={show === "inactive" ? "primary" : "secondary"}
          aria-current={show === "inactive" ? "page" : undefined}
        >
          Inactive
        </ButtonLink>
      </nav>

      <FilterBar
        basePath={BASE}
        query={params.q}
        searchLabel="Search missions"
        preserve={{ show: show === "inactive" ? "inactive" : undefined }}
      />

      <Panel>
        <DataTable
          columns={columns}
          rows={page.rows}
          rowKey={(mission) => mission.id}
          basePath={BASE}
          searchParams={{
            show: show === "inactive" ? "inactive" : undefined,
            q: params.q,
          }}
          page={{ page: page.page, pageSize: page.pageSize, total: page.total }}
          emptyTitle={show === "active" ? "No missions yet" : "No inactive missions"}
          emptyDescription="Add a mission — a trip such as Turkey Trip, or a customer visit — so people can claim expenses against it."
          emptyAction={show === "active" ? <NewMissionButton /> : undefined}
        />
      </Panel>
    </div>
  );
}
