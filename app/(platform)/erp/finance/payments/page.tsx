import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { ERP_PERMISSIONS } from "@/modules/erp/contracts/permissions";
import { listPayments } from "@/modules/erp/contracts/service";
import {
  AP_PAYMENT_STATUSES,
  AP_PAYMENT_STATUS_LABELS,
  type ApPaymentListItem,
} from "@/modules/erp/contracts/types";
import { PaymentStatusBadge, VendorName } from "@/modules/erp/ui/ap-badges";
import { formatAmount, formatDate } from "@/modules/erp/ui/format";
import { flatParams, orNotFound } from "@/modules/erp/ui/page-helpers";
import { getActor } from "@/platform/auth/current-user";
import { canGlobally } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "Payments" };

const BASE = "/erp/finance/payments";

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = flatParams(await searchParams);
  const actor = await getActor();
  const [result, canCreate] = await Promise.all([
    orNotFound(listPayments(actor, params)),
    canGlobally(actor, ERP_PERMISSIONS.AP_PAYMENT_CREATE),
  ]);
  const filtered = [params.q, params.status, params.vendor].some(
    (value) => (value ?? "") !== "",
  );

  const columns: Column<ApPaymentListItem>[] = [
    {
      key: "number",
      header: "Number",
      sortable: true,
      width: "11rem",
      cell: (payment) => <span dir="ltr">{payment.paymentNumber ?? "Draft"}</span>,
    },
    {
      key: "vendor",
      header: "Vendor",
      cell: (payment) => <VendorName vendor={payment.vendor} />,
    },
    {
      key: "date",
      header: "Date",
      sortable: true,
      cell: (payment) => (
        <span className="whitespace-nowrap">{formatDate(payment.paymentDate)}</span>
      ),
    },
    {
      key: "method",
      header: "Method",
      hideOnMobile: true,
      cell: (payment) => <span dir="auto">{payment.paymentMethod.name}</span>,
    },
    {
      key: "status",
      header: "Status",
      cell: (payment) => <PaymentStatusBadge status={payment.status} />,
    },
    {
      key: "amount",
      header: "Settled (EGP)",
      sortable: true,
      align: "end",
      hideOnMobile: true,
      cell: (payment) => <span dir="ltr">{formatAmount(payment.amountMinor)}</span>,
    },
    {
      key: "withheld",
      header: "Withheld",
      align: "end",
      hideOnMobile: true,
      cell: (payment) => <span dir="ltr">{formatAmount(payment.withheldMinor)}</span>,
    },
    {
      key: "cash",
      header: "Paid out",
      align: "end",
      cell: (payment) => <strong dir="ltr">{formatAmount(payment.cashMinor)}</strong>,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Payments"
        description="Money paid to vendors against posted bills, with the tax withheld. Amounts in EGP."
        actions={
          canCreate ? (
            <ButtonLink
              href={`${BASE}/new`}
              variant="primary"
              icon={<Plus aria-hidden="true" className="size-4" />}
            >
              New payment
            </ButtonLink>
          ) : undefined
        }
      />
      <FilterBar
        basePath={BASE}
        query={params.q}
        searchLabel="Search number, reference or vendor…"
        preserve={{ sort: params.sort, dir: params.dir, vendor: params.vendor }}
        selects={[
          {
            name: "status",
            label: "Status",
            value: params.status,
            allLabel: "Any status",
            options: AP_PAYMENT_STATUSES.map((status) => ({
              value: status,
              label: AP_PAYMENT_STATUS_LABELS[status],
            })),
          },
        ]}
      />
      <Panel className="overflow-hidden">
        <DataTable
          columns={columns}
          rows={result.rows}
          rowKey={(payment) => payment.id}
          rowHref={(payment) => `${BASE}/${payment.id}`}
          basePath={BASE}
          searchParams={params}
          sort={{
            key: params.sort ?? "date",
            direction: params.dir === "asc" ? "asc" : "desc",
          }}
          page={{ page: result.page, pageSize: result.pageSize, total: result.total }}
          emptyTitle={filtered ? "No payments match" : "No payments yet"}
          emptyDescription={
            filtered
              ? "Try another search or clear the filters."
              : "A payment settles one or more posted bills of a vendor, withholding tax where it applies."
          }
        />
      </Panel>
    </div>
  );
}
