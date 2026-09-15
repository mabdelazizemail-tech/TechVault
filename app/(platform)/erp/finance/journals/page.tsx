import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filter-bar";
import { Badge, PageHeader, Panel } from "@/components/ui/primitives";
import { ERP_PERMISSIONS } from "@/modules/erp/contracts/permissions";
import { listJournals } from "@/modules/erp/contracts/service";
import {
  JOURNAL_KINDS,
  JOURNAL_KIND_LABELS,
  JOURNAL_STATUSES,
  JOURNAL_STATUS_LABELS,
  type JournalListItem,
} from "@/modules/erp/contracts/types";
import { JournalStatusBadge } from "@/modules/erp/ui/badges";
import { formatAmount, formatDate } from "@/modules/erp/ui/format";
import { flatParams, orNotFound } from "@/modules/erp/ui/page-helpers";
import { getActor } from "@/platform/auth/current-user";
import { canGlobally } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "Journal entries" };

const BASE = "/erp/finance/journals";

export default async function JournalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = flatParams(await searchParams);
  const actor = await getActor();
  const [result, canCreate] = await Promise.all([
    orNotFound(listJournals(actor, params)),
    canGlobally(actor, ERP_PERMISSIONS.JOURNAL_CREATE),
  ]);
  const filtered = [params.q, params.status, params.kind].some(
    (value) => (value ?? "") !== "",
  );

  const columns: Column<JournalListItem>[] = [
    {
      key: "number",
      header: "Number",
      width: "11rem",
      cell: (entry) => <span dir="ltr">{entry.journalNumber ?? "Draft"}</span>,
    },
    {
      key: "date",
      header: "Date",
      width: "8rem",
      cell: (entry) => (
        <span className="whitespace-nowrap">{formatDate(entry.entryDate)}</span>
      ),
    },
    {
      key: "description",
      header: "Description",
      cell: (entry) => (
        <span className="flex flex-col">
          <span dir="auto">{entry.description}</span>
          {entry.kind !== "STANDARD" && (
            <span>
              <Badge tone="info">{JOURNAL_KIND_LABELS[entry.kind]}</Badge>
            </span>
          )}
          {entry.reverses !== null && (
            <span className="text-foreground-muted text-xs">
              Reverses {entry.reverses.journalNumber}
            </span>
          )}
          {entry.reference !== null && entry.reverses === null && (
            <span dir="auto" className="text-foreground-muted text-xs">
              Ref. {entry.reference}
            </span>
          )}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (entry) => <JournalStatusBadge status={entry.status} />,
    },
    {
      key: "lines",
      header: "Lines",
      align: "end",
      hideOnMobile: true,
      cell: (entry) => entry.lineCount,
    },
    {
      key: "amount",
      header: "Amount (EGP)",
      align: "end",
      cell: (entry) => <span dir="ltr">{formatAmount(entry.totalMinor)}</span>,
    },
    {
      key: "createdBy",
      header: "Created by",
      hideOnMobile: true,
      cell: (entry) => <span dir="auto">{entry.createdBy.name}</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Journal entries"
        description="Drafts can be changed; posted entries are permanent and are corrected by reversal."
        actions={
          canCreate ? (
            <ButtonLink
              href={`${BASE}/new`}
              variant="primary"
              icon={<Plus aria-hidden="true" className="size-4" />}
            >
              New journal entry
            </ButtonLink>
          ) : undefined
        }
      />
      <FilterBar
        basePath={BASE}
        query={params.q}
        searchLabel="Search number, description or reference…"
        selects={[
          {
            name: "status",
            label: "Status",
            value: params.status,
            allLabel: "Any status",
            options: JOURNAL_STATUSES.map((status) => ({
              value: status,
              label: JOURNAL_STATUS_LABELS[status],
            })),
          },
          {
            name: "kind",
            label: "Type",
            value: params.kind,
            allLabel: "Any type",
            options: JOURNAL_KINDS.map((kind) => ({
              value: kind,
              label: JOURNAL_KIND_LABELS[kind],
            })),
          },
        ]}
      />
      <Panel className="overflow-hidden">
        <DataTable
          columns={columns}
          rows={result.rows}
          rowKey={(entry) => entry.id}
          rowHref={(entry) => `${BASE}/${entry.id}`}
          basePath={BASE}
          searchParams={params}
          page={{ page: result.page, pageSize: result.pageSize, total: result.total }}
          emptyTitle={filtered ? "No entries match" : "No journal entries yet"}
          emptyDescription={
            filtered
              ? "Try another search or clear the filters."
              : "A journal entry records a financial transaction as balanced debits and credits."
          }
        />
      </Panel>
    </div>
  );
}
