import type { Metadata } from "next";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { listCreditNotes } from "@/modules/erp/contracts/service";
import {
  AR_CREDIT_NOTE_STATUSES,
  AR_CREDIT_NOTE_STATUS_LABELS,
  type ArCreditNoteListItem,
} from "@/modules/erp/contracts/types";
import { CustomerName } from "@/modules/erp/ui/ar-badges";
import { CreditNoteStatusBadge } from "@/modules/erp/ui/credit-note-actions";
import { formatAmount, formatDate } from "@/modules/erp/ui/format";
import { flatParams, orNotFound } from "@/modules/erp/ui/page-helpers";
import { getActor } from "@/platform/auth/current-user";

export const metadata: Metadata = { title: "Credit notes" };

const BASE = "/erp/finance/credit-notes";

/** Credit notes: corrections against posted invoices (ADR-029). */
export default async function CreditNotesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = flatParams(await searchParams);
  const actor = await getActor();
  const result = await orNotFound(listCreditNotes(actor, params));
  const filtered = [params.q, params.status].some((value) => (value ?? "") !== "");

  const columns: Column<ArCreditNoteListItem>[] = [
    {
      key: "number",
      header: "Number",
      width: "11rem",
      cell: (note) => <span dir="ltr">{note.creditNoteNumber ?? "Draft"}</span>,
    },
    {
      key: "customer",
      header: "Customer",
      cell: (note) => <CustomerName customer={note.customer} />,
    },
    {
      key: "invoice",
      header: "Against invoice",
      hideOnMobile: true,
      cell: (note) => <span dir="ltr">{note.invoice.invoiceNumber ?? "—"}</span>,
    },
    {
      key: "date",
      header: "Date",
      width: "8rem",
      cell: (note) => (
        <span className="whitespace-nowrap">{formatDate(note.creditNoteDate)}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (note) => <CreditNoteStatusBadge status={note.status} />,
    },
    {
      key: "total",
      header: "Total (EGP)",
      align: "end",
      cell: (note) => <span dir="ltr">{formatAmount(note.totalMinor)}</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Credit notes"
        description="A credit note corrects one posted invoice, for at most what that invoice still owes. Raise one from the invoice."
      />
      <FilterBar
        basePath={BASE}
        query={params.q}
        searchLabel="Search customer name…"
        selects={[
          {
            name: "status",
            label: "Status",
            value: params.status,
            allLabel: "Any status",
            options: AR_CREDIT_NOTE_STATUSES.map((status) => ({
              value: status,
              label: AR_CREDIT_NOTE_STATUS_LABELS[status],
            })),
          },
        ]}
      />
      <Panel className="overflow-hidden">
        <DataTable
          columns={columns}
          rows={result.rows}
          rowKey={(note) => note.id}
          rowHref={(note) => `${BASE}/${note.id}`}
          basePath={BASE}
          searchParams={params}
          page={{ page: result.page, pageSize: result.pageSize, total: result.total }}
          emptyTitle={filtered ? "No credit notes match" : "No credit notes yet"}
          emptyDescription={
            filtered
              ? "Try another search or clear the filters."
              : "Open a posted invoice and choose Credit note to correct it."
          }
        />
      </Panel>
    </div>
  );
}
