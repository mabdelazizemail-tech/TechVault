import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { ERP_PERMISSIONS } from "@/modules/erp/contracts/permissions";
import { listInvoices } from "@/modules/erp/contracts/service";
import {
  AR_INVOICE_STATUSES,
  AR_INVOICE_STATUS_LABELS,
  type ArInvoiceListItem,
} from "@/modules/erp/contracts/types";
import { CustomerName, InvoiceStatusBadge } from "@/modules/erp/ui/ar-badges";
import { formatAmount, formatDate, todayInCairo } from "@/modules/erp/ui/format";
import { flatParams, orNotFound } from "@/modules/erp/ui/page-helpers";
import { getActor } from "@/platform/auth/current-user";
import { can } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "Invoices" };

const BASE = "/erp/finance/invoices";

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = flatParams(await searchParams);
  const actor = await getActor();
  const [result, canCreate] = await Promise.all([
    orNotFound(listInvoices(actor, params)),
    can(actor, ERP_PERMISSIONS.AR_INVOICE_CREATE),
  ]);
  const today = todayInCairo();
  const filtered = [params.q, params.status, params.overdue].some(
    (value) => (value ?? "") !== "",
  );

  const columns: Column<ArInvoiceListItem>[] = [
    {
      key: "number",
      header: "Number",
      sortable: true,
      width: "11rem",
      cell: (invoice) => <span dir="ltr">{invoice.invoiceNumber ?? "Draft"}</span>,
    },
    {
      key: "customer",
      header: "Customer",
      cell: (invoice) => <CustomerName customer={invoice.customer} />,
    },
    {
      key: "date",
      header: "Date",
      sortable: true,
      cell: (invoice) => (
        <span className="whitespace-nowrap">{formatDate(invoice.invoiceDate)}</span>
      ),
    },
    {
      key: "due",
      header: "Due",
      sortable: true,
      hideOnMobile: true,
      cell: (invoice) => (
        <span
          className={
            invoice.outstandingMinor > 0 && invoice.dueDate < today
              ? "text-danger font-semibold whitespace-nowrap"
              : "whitespace-nowrap"
          }
        >
          {formatDate(invoice.dueDate)}
          {invoice.outstandingMinor > 0 && invoice.dueDate < today && (
            <span className="sr-only"> (overdue)</span>
          )}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (invoice) => <InvoiceStatusBadge status={invoice.status} />,
    },
    {
      key: "total",
      header: "Total (EGP)",
      sortable: true,
      align: "end",
      cell: (invoice) => <span dir="ltr">{formatAmount(invoice.totalMinor)}</span>,
    },
    {
      key: "outstanding",
      header: "Outstanding",
      sortable: true,
      align: "end",
      hideOnMobile: true,
      cell: (invoice) => <span dir="ltr">{formatAmount(invoice.outstandingMinor)}</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Invoices"
        description="Customer invoices: drafted, approved, posted to the ledger and paid by allocated receipts. Amounts in EGP."
        actions={
          canCreate ? (
            <ButtonLink
              href={`${BASE}/new`}
              variant="primary"
              icon={<Plus aria-hidden="true" className="size-4" />}
            >
              New invoice
            </ButtonLink>
          ) : undefined
        }
      />
      <FilterBar
        basePath={BASE}
        query={params.q}
        searchLabel="Search number, reference or customer…"
        preserve={{ sort: params.sort, dir: params.dir }}
        selects={[
          {
            name: "status",
            label: "Status",
            value: params.status,
            allLabel: "Any status",
            options: AR_INVOICE_STATUSES.map((status) => ({
              value: status,
              label: AR_INVOICE_STATUS_LABELS[status],
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
          rowKey={(invoice) => invoice.id}
          rowHref={(invoice) => `${BASE}/${invoice.id}`}
          basePath={BASE}
          searchParams={params}
          sort={{
            key: params.sort ?? "date",
            direction: params.dir === "asc" ? "asc" : "desc",
          }}
          page={{ page: result.page, pageSize: result.pageSize, total: result.total }}
          emptyTitle={filtered ? "No invoices match" : "No invoices yet"}
          emptyDescription={
            filtered
              ? "Try another search or clear the filters."
              : "An invoice bills a CRM customer. It is approved, then posted to receivables and revenue."
          }
        />
      </Panel>
    </div>
  );
}
