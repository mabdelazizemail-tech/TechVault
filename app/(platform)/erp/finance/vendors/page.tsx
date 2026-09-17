import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filter-bar";
import { Badge, PageHeader, Panel } from "@/components/ui/primitives";
import { ERP_PERMISSIONS } from "@/modules/erp/contracts/permissions";
import { listVendors } from "@/modules/erp/contracts/service";
import type { VendorListItem } from "@/modules/erp/contracts/types";
import { formatAmount } from "@/modules/erp/ui/format";
import { flatParams, orNotFound } from "@/modules/erp/ui/page-helpers";
import { getActor } from "@/platform/auth/current-user";
import { canGlobally } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "Vendors" };

const BASE = "/erp/finance/vendors";

/** Suppliers and what is owed to each on posted bills. */
export default async function VendorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = flatParams(await searchParams);
  const actor = await getActor();
  const [result, canCreate] = await Promise.all([
    orNotFound(listVendors(actor, params)),
    canGlobally(actor, ERP_PERMISSIONS.AP_VENDOR_CREATE),
  ]);
  const filtered = [params.q, params.status].some((value) => (value ?? "") !== "");

  const columns: Column<VendorListItem>[] = [
    {
      key: "name",
      header: "Vendor",
      cell: (vendor) => (
        <span className="flex flex-wrap items-center gap-2">
          <span dir="auto" className="font-semibold">
            {vendor.name}
          </span>
          {!vendor.isActive && <Badge tone="warning">Inactive</Badge>}
        </span>
      ),
    },
    {
      key: "trn",
      header: "Tax registration",
      hideOnMobile: true,
      cell: (vendor) => <span dir="ltr">{vendor.taxRegistrationNumber ?? "—"}</span>,
    },
    {
      key: "open",
      header: "Open bills",
      align: "end",
      hideOnMobile: true,
      cell: (vendor) => vendor.openBillCount,
    },
    {
      key: "outstanding",
      header: "Owed (EGP)",
      align: "end",
      cell: (vendor) => <strong dir="ltr">{formatAmount(vendor.outstandingMinor)}</strong>,
    },
    {
      key: "overdue",
      header: "Overdue",
      align: "end",
      cell: (vendor) => (
        <span
          dir="ltr"
          className={vendor.overdueMinor > 0 ? "text-danger font-semibold" : undefined}
        >
          {formatAmount(vendor.overdueMinor)}
        </span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Vendors"
        description="Suppliers the organisation buys from, with what is still owed on posted bills. Amounts in EGP."
        actions={
          canCreate ? (
            <ButtonLink
              href={`${BASE}/new`}
              variant="primary"
              icon={<Plus aria-hidden="true" className="size-4" />}
            >
              New vendor
            </ButtonLink>
          ) : undefined
        }
      />
      <FilterBar
        basePath={BASE}
        query={params.q}
        searchLabel="Search name or tax registration…"
        selects={[
          {
            name: "status",
            label: "Status",
            value: params.status,
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
          rowKey={(vendor) => vendor.id}
          rowHref={(vendor) => `${BASE}/${vendor.id}`}
          basePath={BASE}
          searchParams={params}
          page={{ page: result.page, pageSize: result.pageSize, total: result.total }}
          emptyTitle={filtered ? "No vendors match" : "No vendors yet"}
          emptyDescription={
            filtered
              ? "Try another search or clear the filters."
              : "A vendor is a supplier whose bills you record and pay."
          }
        />
      </Panel>
    </div>
  );
}
