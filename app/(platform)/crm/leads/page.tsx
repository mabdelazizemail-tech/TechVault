import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { CRM_PERMISSIONS } from "@/modules/crm/contracts/permissions";
import { listLeads } from "@/modules/crm/contracts/service";
import {
  LEAD_SOURCES,
  LEAD_SOURCE_LABELS,
  LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  type LeadListItem,
} from "@/modules/crm/contracts/types";
import { Avatar, LeadStatusBadge, ScoreMeter } from "@/modules/crm/ui/badges";
import { FilterBar } from "@/modules/crm/ui/filter-bar";
import { formatDate } from "@/modules/crm/ui/format";
import { LeadBulkActions } from "@/modules/crm/ui/lead-bulk-actions";
import { flatParams, oneOf, uuidParam } from "@/modules/crm/ui/page-helpers";
import { getActor } from "@/platform/auth/current-user";
import { canAll } from "@/platform/authz/authz";
import { listDirectory } from "@/platform/iam/services/directory-service";

export const metadata: Metadata = { title: "Leads" };

const BULK_FORM_ID = "lead-bulk-actions";

/** The leads list: status tabs, search and filters, sortable columns, bulk changes. */
export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = flatParams(await searchParams);
  const actor = await getActor();

  const status = oneOf(LEAD_STATUSES, params.status);
  const source = oneOf(LEAD_SOURCES, params.source);
  const ownerId = uuidParam(params.ownerId);

  const [result, owners, rights] = await Promise.all([
    listLeads(actor, params, { status, source, ownerId }),
    listDirectory(actor),
    canAll(actor, [CRM_PERMISSIONS.LEAD_CREATE, CRM_PERMISSIONS.LEAD_UPDATE]),
  ]);
  const canCreate = rights[CRM_PERMISSIONS.LEAD_CREATE] === true;
  const canBulkEdit = rights[CRM_PERMISSIONS.LEAD_UPDATE] === true;

  const tabHref = (value: string | undefined) => {
    const query = new URLSearchParams();
    for (const key of ["q", "source", "ownerId"] as const) {
      const current = params[key];
      if (current !== undefined && current !== "") query.set(key, current);
    }
    if (value !== undefined) query.set("status", value);
    const text = query.toString();
    return text === "" ? "/crm/leads" : `/crm/leads?${text}`;
  };

  return (
    <div>
      <PageHeader
        title="Leads"
        description="People and companies that might buy. Qualify them, then convert the promising ones into opportunities."
        actions={
          canCreate ? (
            <ButtonLink
              href="/crm/leads/new"
              variant="primary"
              icon={<Plus aria-hidden="true" size={15} />}
            >
              New lead
            </ButtonLink>
          ) : undefined
        }
      />

      <nav
        aria-label="Lead status"
        className="border-border-strong mb-3 flex gap-5 overflow-x-auto border-b-2"
      >
        {[undefined, ...LEAD_STATUSES].map((value) => {
          const active = value === status;
          return (
            <Link
              key={value ?? "all"}
              href={tabHref(value)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-0.5 border-b-2 pb-2 text-[13px] whitespace-nowrap",
                active
                  ? "border-primary text-foreground font-extrabold"
                  : "text-foreground-muted hover:text-foreground border-transparent",
              )}
            >
              {value === undefined ? "All leads" : LEAD_STATUS_LABELS[value]}
            </Link>
          );
        })}
      </nav>

      <FilterBar
        basePath="/crm/leads"
        query={params.q}
        searchLabel="Search name, company or email…"
        preserve={{ status }}
        selects={[
          {
            name: "source",
            label: "Lead source",
            value: source,
            allLabel: "All sources",
            options: LEAD_SOURCES.map((value) => ({
              value,
              label: LEAD_SOURCE_LABELS[value],
            })),
          },
          {
            name: "ownerId",
            label: "Owner",
            value: ownerId,
            allLabel: "All owners",
            options: owners.map((owner) => ({ value: owner.id, label: owner.name })),
          },
        ]}
      />

      <Panel className="overflow-hidden">
        {canBulkEdit && result.rows.length > 0 && (
          <LeadBulkActions
            key={JSON.stringify(params)}
            formId={BULK_FORM_ID}
            owners={owners}
          />
        )}
        <DataTable<LeadListItem>
          columns={COLUMNS}
          rows={result.rows}
          rowKey={(lead) => lead.id}
          rowHref={(lead) => `/crm/leads/${lead.id}`}
          basePath="/crm/leads"
          searchParams={params}
          sort={{
            key: params.sort ?? "createdAt",
            direction: params.dir === "asc" ? "asc" : "desc",
          }}
          page={{ page: result.page, pageSize: result.pageSize, total: result.total }}
          selection={
            canBulkEdit
              ? { formId: BULK_FORM_ID, name: "leadIds", rowLabel: (lead) => lead.name }
              : undefined
          }
          emptyTitle={
            status === undefined && params.q === undefined
              ? "No leads yet"
              : "No leads match"
          }
          emptyDescription="A lead is someone who might buy. Capture one with the New lead wizard, or clear the filters."
          emptyAction={
            canCreate ? (
              <ButtonLink
                href="/crm/leads/new"
                variant="primary"
                icon={<Plus aria-hidden="true" size={15} />}
              >
                New lead
              </ButtonLink>
            ) : undefined
          }
        />
      </Panel>
    </div>
  );
}

const COLUMNS: readonly Column<LeadListItem>[] = [
  {
    key: "name",
    header: "Name",
    sortable: true,
    cell: (lead) => (
      <span className="flex flex-col">
        <span dir="auto">{lead.name}</span>
        <span className="text-foreground-muted text-xs font-normal md:hidden" dir="auto">
          {lead.company}
        </span>
      </span>
    ),
  },
  {
    key: "company",
    header: "Company",
    sortable: true,
    hideOnMobile: true,
    cell: (lead) => <span dir="auto">{lead.company}</span>,
  },
  {
    key: "status",
    header: "Status",
    sortable: true,
    cell: (lead) => <LeadStatusBadge status={lead.status} />,
  },
  {
    key: "score",
    header: "Score",
    sortable: true,
    hideOnMobile: true,
    cell: (lead) => <ScoreMeter score={lead.score} />,
  },
  {
    key: "source",
    header: "Source",
    sortable: true,
    hideOnMobile: true,
    cell: (lead) => LEAD_SOURCE_LABELS[lead.source],
  },
  {
    key: "owner",
    header: "Owner",
    hideOnMobile: true,
    cell: (lead) =>
      lead.owner === null ? (
        <span className="text-foreground-subtle">Unassigned</span>
      ) : (
        <span className="flex items-center gap-2">
          <Avatar name={lead.owner.name} />
          {lead.owner.name}
        </span>
      ),
  },
  {
    key: "createdAt",
    header: "Created",
    sortable: true,
    align: "end",
    hideOnMobile: true,
    cell: (lead) => formatDate(lead.createdAt),
  },
];
