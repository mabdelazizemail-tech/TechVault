import type { Metadata } from "next";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filter-bar";
import { Badge, PageHeader, Panel } from "@/components/ui/primitives";
import { ERP_PERMISSIONS } from "@/modules/erp/contracts/permissions";
import { listAccountOptions, listAccounts } from "@/modules/erp/contracts/service";
import {
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_LABELS,
  NORMAL_BALANCE_LABELS,
  type AccountListItem,
} from "@/modules/erp/contracts/types";
import { AccountFormButton } from "@/modules/erp/ui/account-forms";
import { ActiveBadge } from "@/modules/erp/ui/badges";
import { flatParams, orNotFound } from "@/modules/erp/ui/page-helpers";
import { getActor } from "@/platform/auth/current-user";
import { canAllGlobally } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "Chart of accounts" };

const BASE = "/erp/finance/accounts";

/** The chart of accounts as a tree, in code order, with search and filters. */
export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = flatParams(await searchParams);
  const actor = await getActor();
  const [result, rights] = await Promise.all([
    orNotFound(listAccounts(actor, params)),
    canAllGlobally(actor, [ERP_PERMISSIONS.ACCOUNT_CREATE]),
  ]);
  const canCreate = rights[ERP_PERMISSIONS.ACCOUNT_CREATE] === true;
  const headings = canCreate ? await listAccountOptions(actor, { postable: false }) : [];
  const filtered = [params.q, params.type, params.active].some(
    (value) => (value ?? "") !== "",
  );

  const columns: Column<AccountListItem>[] = [
    {
      key: "code",
      header: "Code",
      width: "9rem",
      cell: (account) => (
        <span
          className="inline-block tabular-nums"
          style={{ paddingInlineStart: `${account.depth * 1.25}rem` }}
          dir="ltr"
        >
          {account.isPostable ? account.code : <strong>{account.code}</strong>}
        </span>
      ),
    },
    {
      key: "name",
      header: "Name",
      cell: (account) => (
        <span className="flex flex-col">
          <span dir="auto" className={account.isPostable ? "" : "font-bold"}>
            {account.name}
          </span>
          {account.nameAr !== null && (
            <span dir="rtl" lang="ar" className="text-foreground-muted text-xs">
              {account.nameAr}
            </span>
          )}
        </span>
      ),
    },
    { key: "type", header: "Type", cell: (account) => ACCOUNT_TYPE_LABELS[account.type] },
    {
      key: "normalBalance",
      header: "Normal balance",
      hideOnMobile: true,
      cell: (account) => NORMAL_BALANCE_LABELS[account.normalBalance],
    },
    {
      key: "posting",
      header: "Posting",
      hideOnMobile: true,
      cell: (account) => (account.isPostable ? "Postable" : <Badge>Heading</Badge>),
    },
    {
      key: "status",
      header: "Status",
      cell: (account) => <ActiveBadge isActive={account.isActive} />,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Chart of accounts"
        description="Headings group accounts; journal lines post to the accounts beneath them."
        actions={canCreate ? <AccountFormButton headings={headings} /> : undefined}
      />
      <FilterBar
        basePath={BASE}
        query={params.q}
        searchLabel="Search code or name…"
        selects={[
          {
            name: "type",
            label: "Type",
            value: params.type,
            allLabel: "All types",
            options: ACCOUNT_TYPES.map((type) => ({
              value: type,
              label: ACCOUNT_TYPE_LABELS[type],
            })),
          },
          {
            name: "active",
            label: "Status",
            value: params.active,
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
          rowKey={(account) => account.id}
          rowHref={(account) => `${BASE}/${account.id}`}
          basePath={BASE}
          searchParams={params}
          page={{ page: result.page, pageSize: result.pageSize, total: result.total }}
          emptyTitle={filtered ? "No accounts match" : "No accounts yet"}
          emptyDescription={
            filtered
              ? "Try another search or clear the filters."
              : "The chart of accounts lists every ledger account. Start with a heading for each account type."
          }
        />
      </Panel>
    </div>
  );
}
