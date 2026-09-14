import type { Metadata } from "next";
import { DataTable, type Column } from "@/components/ui/data-table";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { CRM_PERMISSIONS } from "@/modules/crm/contracts/permissions";
import { listAccounts } from "@/modules/crm/contracts/service";
import type { AccountListItem } from "@/modules/crm/contracts/types";
import { AccountFormButton } from "@/modules/crm/ui/account-form";
import { Avatar } from "@/modules/crm/ui/badges";
import { FilterBar } from "@/modules/crm/ui/filter-bar";
import { formatTotals } from "@/modules/crm/ui/format";
import { flatParams } from "@/modules/crm/ui/page-helpers";
import { getActor } from "@/platform/auth/current-user";
import { canAll } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "Companies" };

/** Companies: the customer record every deal, contact and activity hangs off. */
export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = flatParams(await searchParams);
  const actor = await getActor();

  const sort = params.sort ?? "name";
  const dir =
    params.dir === "asc" || params.dir === "desc"
      ? params.dir
      : sort === "createdAt"
        ? "desc"
        : "asc";

  const [result, rights] = await Promise.all([
    listAccounts(actor, { ...params, sort, dir }),
    canAll(actor, [CRM_PERMISSIONS.ACCOUNT_CREATE]),
  ]);
  const canCreate = rights[CRM_PERMISSIONS.ACCOUNT_CREATE] === true;

  return (
    <div>
      <PageHeader
        title="Companies"
        description="Organisations you sell to. Open pipeline is shown per currency and never added across currencies."
        actions={canCreate ? <AccountFormButton currentUserId={actor.id} /> : undefined}
      />

      <FilterBar
        basePath="/crm/accounts"
        query={params.q}
        searchLabel="Search name, industry or city…"
      />

      <Panel className="overflow-hidden">
        <DataTable<AccountListItem>
          columns={COLUMNS}
          rows={result.rows}
          rowKey={(account) => account.id}
          rowHref={(account) => `/crm/accounts/${account.id}`}
          basePath="/crm/accounts"
          searchParams={params}
          sort={{ key: sort, direction: dir }}
          page={{ page: result.page, pageSize: result.pageSize, total: result.total }}
          emptyTitle={params.q === undefined ? "No companies yet" : "No companies match"}
          emptyDescription="Companies are created when a lead converts, or directly with New company."
          emptyAction={
            canCreate ? <AccountFormButton currentUserId={actor.id} /> : undefined
          }
        />
      </Panel>
    </div>
  );
}

const COLUMNS: readonly Column<AccountListItem>[] = [
  {
    key: "name",
    header: "Company",
    sortable: true,
    cell: (account) => <span dir="auto">{account.name}</span>,
  },
  {
    key: "industry",
    header: "Industry",
    sortable: true,
    hideOnMobile: true,
    cell: (account) =>
      account.industry ?? <span className="text-foreground-subtle">—</span>,
  },
  {
    key: "location",
    header: "Location",
    hideOnMobile: true,
    cell: (account) =>
      [account.city, account.country].filter((part) => part !== null).join(", ") || (
        <span className="text-foreground-subtle">—</span>
      ),
  },
  {
    key: "contacts",
    header: "Contacts",
    align: "end",
    hideOnMobile: true,
    cell: (account) => account.contactCount,
  },
  {
    key: "openDeals",
    header: "Open deals",
    align: "end",
    cell: (account) => account.openOpportunityCount,
  },
  {
    key: "pipeline",
    header: "Open pipeline",
    align: "end",
    hideOnMobile: true,
    cell: (account) => (
      <span className="font-extrabold">{formatTotals(account.pipeline)}</span>
    ),
  },
  {
    key: "owner",
    header: "Owner",
    hideOnMobile: true,
    cell: (account) =>
      account.owner === null ? (
        <span className="text-foreground-subtle">Unassigned</span>
      ) : (
        <span className="flex items-center gap-2">
          <Avatar name={account.owner.name} />
          {account.owner.name}
        </span>
      ),
  },
];
