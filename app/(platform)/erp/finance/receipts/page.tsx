import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { ERP_PERMISSIONS } from "@/modules/erp/contracts/permissions";
import { listReceipts } from "@/modules/erp/contracts/service";
import {
  AR_RECEIPT_STATUSES,
  AR_RECEIPT_STATUS_LABELS,
  type ArReceiptListItem,
} from "@/modules/erp/contracts/types";
import { CustomerName, ReceiptStatusBadge } from "@/modules/erp/ui/ar-badges";
import { formatAmount, formatDate } from "@/modules/erp/ui/format";
import { flatParams, orNotFound } from "@/modules/erp/ui/page-helpers";
import { getActor } from "@/platform/auth/current-user";
import { can } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "Receipts" };

const BASE = "/erp/finance/receipts";

export default async function ReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = flatParams(await searchParams);
  const actor = await getActor();
  const [result, canCreate] = await Promise.all([
    orNotFound(listReceipts(actor, params)),
    can(actor, ERP_PERMISSIONS.AR_RECEIPT_CREATE),
  ]);
  const filtered = [params.q, params.status].some((value) => (value ?? "") !== "");

  const columns: Column<ArReceiptListItem>[] = [
    {
      key: "number",
      header: "Number",
      sortable: true,
      width: "11rem",
      cell: (receipt) => <span dir="ltr">{receipt.receiptNumber ?? "Draft"}</span>,
    },
    {
      key: "customer",
      header: "Customer",
      cell: (receipt) => <CustomerName customer={receipt.customer} />,
    },
    {
      key: "date",
      header: "Date",
      sortable: true,
      cell: (receipt) => (
        <span className="whitespace-nowrap">{formatDate(receipt.receiptDate)}</span>
      ),
    },
    {
      key: "method",
      header: "Method",
      hideOnMobile: true,
      cell: (receipt) => receipt.paymentMethod.name,
    },
    {
      key: "status",
      header: "Status",
      cell: (receipt) => <ReceiptStatusBadge status={receipt.status} />,
    },
    {
      key: "amount",
      header: "Amount (EGP)",
      sortable: true,
      align: "end",
      cell: (receipt) => <span dir="ltr">{formatAmount(receipt.amountMinor)}</span>,
    },
    {
      key: "unallocated",
      header: "Unallocated",
      align: "end",
      hideOnMobile: true,
      cell: (receipt) => <span dir="ltr">{formatAmount(receipt.unallocatedMinor)}</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Receipts"
        description="Money received from customers, posted to the ledger and allocated to their invoices. Amounts in EGP."
        actions={
          canCreate ? (
            <ButtonLink
              href={`${BASE}/new`}
              variant="primary"
              icon={<Plus aria-hidden="true" className="size-4" />}
            >
              New receipt
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
            options: AR_RECEIPT_STATUSES.map((status) => ({
              value: status,
              label: AR_RECEIPT_STATUS_LABELS[status],
            })),
          },
        ]}
      />
      <Panel className="overflow-hidden">
        <DataTable
          columns={columns}
          rows={result.rows}
          rowKey={(receipt) => receipt.id}
          rowHref={(receipt) => `${BASE}/${receipt.id}`}
          basePath={BASE}
          searchParams={params}
          sort={{
            key: params.sort ?? "date",
            direction: params.dir === "asc" ? "asc" : "desc",
          }}
          page={{ page: result.page, pageSize: result.pageSize, total: result.total }}
          emptyTitle={filtered ? "No receipts match" : "No receipts yet"}
          emptyDescription={
            filtered
              ? "Try another search or clear the filters."
              : "A receipt records money a customer paid. Post it, then allocate it to their invoices."
          }
        />
      </Panel>
    </div>
  );
}
