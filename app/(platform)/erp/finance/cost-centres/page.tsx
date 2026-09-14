import type { Metadata } from "next";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { ERP_PERMISSIONS } from "@/modules/erp/contracts/permissions";
import { listCostCentreOptions, listCostCentres } from "@/modules/erp/contracts/service";
import type { CostCentreListItem } from "@/modules/erp/contracts/types";
import { ActiveBadge } from "@/modules/erp/ui/badges";
import { CostCentreFormButton } from "@/modules/erp/ui/cost-centre-form";
import { flatParams, orNotFound } from "@/modules/erp/ui/page-helpers";
import { getActor } from "@/platform/auth/current-user";
import { canAll } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "Cost centres" };

const BASE = "/erp/finance/cost-centres";

export default async function CostCentresPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = flatParams(await searchParams);
  const actor = await getActor();
  const [result, rights] = await Promise.all([
    orNotFound(listCostCentres(actor, params)),
    canAll(actor, [
      ERP_PERMISSIONS.COST_CENTRE_CREATE,
      ERP_PERMISSIONS.COST_CENTRE_UPDATE,
    ]),
  ]);
  const canCreate = rights[ERP_PERMISSIONS.COST_CENTRE_CREATE] === true;
  const canUpdate = rights[ERP_PERMISSIONS.COST_CENTRE_UPDATE] === true;
  const parents = canCreate || canUpdate ? await listCostCentreOptions(actor) : [];
  const filtered = [params.q, params.active].some((value) => (value ?? "") !== "");

  const columns: Column<CostCentreListItem>[] = [
    {
      key: "code",
      header: "Code",
      width: "10rem",
      cell: (centre) => (
        <span
          className="inline-block font-semibold"
          style={{ paddingInlineStart: `${centre.depth * 1.25}rem` }}
          dir="ltr"
        >
          {centre.code}
        </span>
      ),
    },
    {
      key: "name",
      header: "Name",
      cell: (centre) => (
        <span className="flex flex-col">
          <span dir="auto">{centre.name}</span>
          {centre.nameAr !== null && (
            <span dir="rtl" lang="ar" className="text-foreground-muted text-xs">
              {centre.nameAr}
            </span>
          )}
        </span>
      ),
    },
    {
      key: "children",
      header: "Sub-centres",
      align: "end",
      hideOnMobile: true,
      cell: (centre) => centre.childCount,
    },
    {
      key: "status",
      header: "Status",
      cell: (centre) => <ActiveBadge isActive={centre.isActive} />,
    },
    ...(canUpdate
      ? [
          {
            key: "actions",
            header: "Actions",
            align: "end" as const,
            cell: (centre: CostCentreListItem) => (
              <CostCentreFormButton
                parents={parents}
                centre={{
                  id: centre.id,
                  code: centre.code,
                  name: centre.name,
                  nameAr: centre.nameAr,
                  parentId: centre.parentId,
                  isActive: centre.isActive,
                }}
              />
            ),
          },
        ]
      : []),
  ];

  return (
    <div>
      <PageHeader
        title="Cost centres"
        description="An optional second dimension on journal lines: who or what a cost or income belongs to."
        actions={canCreate ? <CostCentreFormButton parents={parents} /> : undefined}
      />
      <FilterBar
        basePath={BASE}
        query={params.q}
        searchLabel="Search code or name…"
        selects={[
          {
            name: "active",
            label: "Status",
            value: params.active,
            allLabel: "Active and inactive",
            options: [
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
            ],
          },
        ]}
      />
      <Panel className="overflow-hidden">
        <DataTable
          columns={columns}
          rows={result.rows}
          rowKey={(centre) => centre.id}
          basePath={BASE}
          searchParams={params}
          page={{ page: result.page, pageSize: result.pageSize, total: result.total }}
          emptyTitle={filtered ? "No cost centres match" : "No cost centres yet"}
          emptyDescription={
            filtered
              ? "Try another search or clear the filters."
              : "Cost centres let journal lines be analysed by department, branch or activity."
          }
        />
      </Panel>
    </div>
  );
}
