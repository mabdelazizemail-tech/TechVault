import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { ERP_PERMISSIONS } from "@/modules/erp/contracts/permissions";
import { listBills } from "@/modules/erp/contracts/service";
import {
  AP_BILL_STATUSES,
  AP_BILL_STATUS_LABELS,
  type ApBillListItem,
} from "@/modules/erp/contracts/types";
import { BillStatusBadge, VendorName } from "@/modules/erp/ui/ap-badges";
import { formatAmount, formatDate, todayInCairo } from "@/modules/erp/ui/format";
import { flatParams, orNotFound } from "@/modules/erp/ui/page-helpers";
import { getActor } from "@/platform/auth/current-user";
import { canGlobally } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "Bills" };

const BASE = "/erp/finance/bills";

export default async function BillsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = flatParams(await searchParams);
  const actor = await getActor();
  const [result, canCreate] = await Promise.all([
    orNotFound(listBills(actor, params)),
    canGlobally(actor, ERP_PERMISSIONS.AP_BILL_CREATE),
  ]);
  const today = todayInCairo();
  const filtered = [params.q, params.status, params.overdue, params.vendor].some(
    (value) => (value ?? "") !== "",
  );

  const columns: Column<ApBillListItem>[] = [
    {
      key: "number",
      header: "Number",
      sortable: true,
      width: "11rem",
      cell: (bill) => <span dir="ltr">{bill.billNumber ?? "Draft"}</span>,
    },
    {
      key: "vendor",
      header: "Vendor",
      cell: (bill) => (
        <span>
          <VendorName vendor={bill.vendor} />
          <span className="text-foreground-muted block text-xs" dir="auto">
            {bill.vendorInvoiceNumber}
          </span>
        </span>
      ),
    },
    {
      key: "date",
      header: "Date",
      sortable: true,
      cell: (bill) => <span className="whitespace-nowrap">{formatDate(bill.billDate)}</span>,
    },
    {
      key: "due",
      header: "Due",
      sortable: true,
      hideOnMobile: true,
      cell: (bill) => {
        const overdue = bill.outstandingMinor > 0 && bill.dueDate < today;
        return (
          <span
            className={
              overdue ? "text-danger font-semibold whitespace-nowrap" : "whitespace-nowrap"
            }
          >
            {formatDate(bill.dueDate)}
            {overdue && <span className="sr-only"> (overdue)</span>}
          </span>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      cell: (bill) => <BillStatusBadge status={bill.status} />,
    },
    {
      key: "total",
      header: "Total (EGP)",
      sortable: true,
      align: "end",
      cell: (bill) => <span dir="ltr">{formatAmount(bill.totalMinor)}</span>,
    },
    {
      key: "outstanding",
      header: "Outstanding",
      sortable: true,
      align: "end",
      hideOnMobile: true,
      cell: (bill) => <span dir="ltr">{formatAmount(bill.outstandingMinor)}</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Bills"
        description="Vendor bills: drafted, approved, posted to payables and settled by payments. Amounts in EGP."
        actions={
          canCreate ? (
            <ButtonLink
              href={`${BASE}/new`}
              variant="primary"
              icon={<Plus aria-hidden="true" className="size-4" />}
            >
              New bill
            </ButtonLink>
          ) : undefined
        }
      />
      <FilterBar
        basePath={BASE}
        query={params.q}
        searchLabel="Search number, supplier invoice, reference or vendor…"
        preserve={{ sort: params.sort, dir: params.dir, vendor: params.vendor }}
        selects={[
          {
            name: "status",
            label: "Status",
            value: params.status,
            allLabel: "Any status",
            options: AP_BILL_STATUSES.map((status) => ({
              value: status,
              label: AP_BILL_STATUS_LABELS[status],
            })),
          },
          {
            name: "overdue",
            label: "Due",
            value: params.overdue,
            allLabel: "Any due date",
            options: [{ value: "1", label: "Overdue only" }],
          },
        ]}
      />
      <Panel className="overflow-hidden">
        <DataTable
          columns={columns}
          rows={result.rows}
          rowKey={(bill) => bill.id}
          rowHref={(bill) => `${BASE}/${bill.id}`}
          basePath={BASE}
          searchParams={params}
          sort={{
            key: params.sort ?? "date",
            direction: params.dir === "asc" ? "asc" : "desc",
          }}
          page={{ page: result.page, pageSize: result.pageSize, total: result.total }}
          emptyTitle={filtered ? "No bills match" : "No bills yet"}
          emptyDescription={
            filtered
              ? "Try another search or clear the filters."
              : "A bill records what a vendor has invoiced. It is approved, then posted to expenses, input VAT and payables."
          }
        />
      </Panel>
    </div>
  );
}
