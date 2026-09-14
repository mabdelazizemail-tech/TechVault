import type { Metadata } from "next";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { listArCustomers } from "@/modules/erp/contracts/service";
import type { ArCustomerListItem } from "@/modules/erp/contracts/types";
import { CustomerName } from "@/modules/erp/ui/ar-badges";
import { formatAmount, formatDate } from "@/modules/erp/ui/format";
import { flatParams, orNotFound } from "@/modules/erp/ui/page-helpers";
import { getActor } from "@/platform/auth/current-user";

export const metadata: Metadata = { title: "Customers" };

const BASE = "/erp/finance/customers";

/** CRM customers with receivables activity, highest balance first. */
export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = flatParams(await searchParams);
  const actor = await getActor();
  const result = await orNotFound(listArCustomers(actor, params));

  const columns: Column<ArCustomerListItem>[] = [
    {
      key: "customer",
      header: "Customer",
      cell: (row) => <CustomerName customer={row.customer} />,
    },
    {
      key: "invoiced",
      header: "Invoiced",
      align: "end",
      hideOnMobile: true,
      cell: (row) => <span dir="ltr">{formatAmount(row.invoicedMinor)}</span>,
    },
    {
      key: "received",
      header: "Received",
      align: "end",
      hideOnMobile: true,
      cell: (row) => <span dir="ltr">{formatAmount(row.receivedMinor)}</span>,
    },
    {
      key: "balance",
      header: "Balance (EGP)",
      align: "end",
      cell: (row) => <strong dir="ltr">{formatAmount(row.balanceMinor)}</strong>,
    },
    {
      key: "overdue",
      header: "Overdue",
      align: "end",
      cell: (row) => (
        <span
          dir="ltr"
          className={row.overdueMinor > 0 ? "text-danger font-semibold" : undefined}
        >
          {formatAmount(row.overdueMinor)}
        </span>
      ),
    },
    {
      key: "open",
      header: "Open invoices",
      align: "end",
      hideOnMobile: true,
      cell: (row) => row.openInvoiceCount,
    },
    {
      key: "last",
      header: "Last activity",
      hideOnMobile: true,
      cell: (row) =>
        row.lastActivityDate === null ? "—" : formatDate(row.lastActivityDate),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Customers"
        description="Receivables by CRM customer: invoiced, received and what is still owed. Customer details stay in CRM."
      />
      <FilterBar
        basePath={BASE}
        query={params.q}
        searchLabel="Search CRM company name…"
      />
      <Panel className="overflow-hidden">
        <DataTable
          columns={columns}
          rows={result.rows}
          rowKey={(row) => row.customer.id}
          rowHref={(row) => `${BASE}/${row.customer.id}`}
          basePath={BASE}
          searchParams={params}
          page={{ page: result.page, pageSize: result.pageSize, total: result.total }}
          emptyTitle={
            params.q !== undefined && params.q !== ""
              ? "No customers match"
              : "No receivables yet"
          }
          emptyDescription="Customers appear here once an invoice or receipt of theirs is posted."
        />
      </Panel>
    </div>
  );
}
