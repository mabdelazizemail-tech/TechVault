import type { Metadata } from "next";
import { Badge, PageHeader, Panel } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { getActor } from "@/platform/auth/current-user";
import { listUsers, type UserSummary } from "@/platform/iam/services/user-service";

export const metadata: Metadata = { title: "Users" };

const PAGE_SIZE = 25;

/**
 * The user administration list.
 *
 * Sort, page and search live in the URL (CLAUDE.md §16.4), and are applied by the
 * database query — the page never receives rows the signed-in administrator may
 * not see, because `listUsers` narrows by scope before returning (§11.5).
 */
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const actor = await getActor();

  const page = positiveInt(params.page) ?? 1;
  const sort = sortKeyOf(params.sort);
  const direction = params.dir === "desc" ? "desc" : "asc";

  const result = await listUsers(actor, {
    page,
    pageSize: PAGE_SIZE,
    sort,
    direction,
    search: params.q,
    includeInactive: params.inactive === "1",
  });

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Users"
        description="Accounts that can sign in to TechVault. Accounts are created deliberately — TechVault never provisions one automatically from a sign-in."
      />

      <Panel className="overflow-hidden">
        <DataTable<UserSummary>
          columns={COLUMNS}
          rows={result.rows}
          rowKey={(user) => user.id}
          basePath="/admin/users"
          searchParams={params}
          sort={{ key: sort, direction }}
          page={{ page: result.page, pageSize: result.pageSize, total: result.total }}
          emptyTitle="No users match these filters"
          emptyDescription="Try clearing the search, or include inactive accounts."
        />
      </Panel>
    </div>
  );
}

const COLUMNS: readonly Column<UserSummary>[] = [
  {
    key: "email",
    header: "Email",
    sortable: true,
    cell: (user) => user.email,
  },
  {
    key: "fullName",
    header: "Name",
    sortable: true,
    cell: (user) => user.fullName ?? <Muted>Not set</Muted>,
  },
  {
    key: "roles",
    header: "Roles",
    hideOnMobile: true,
    cell: (user) =>
      user.roleKeys.length === 0 ? (
        // A user with no roles can sign in and do nothing. Surfacing that is more
        // useful than rendering an empty cell.
        <Badge tone="warning">No roles</Badge>
      ) : (
        <span className="flex flex-wrap gap-1">
          {user.roleKeys.map((key) => (
            <Badge key={key}>{key}</Badge>
          ))}
        </span>
      ),
  },
  {
    key: "orgUnit",
    header: "Unit",
    hideOnMobile: true,
    cell: (user) => user.orgUnitName ?? <Muted>Unassigned</Muted>,
  },
  {
    key: "isActive",
    header: "Status",
    cell: (user) =>
      user.isActive ? (
        <Badge tone="success">Active</Badge>
      ) : (
        <Badge tone="danger">Inactive</Badge>
      ),
  },
  {
    key: "lastLoginAt",
    header: "Last sign-in",
    sortable: true,
    align: "end",
    hideOnMobile: true,
    cell: (user) =>
      user.lastLoginAt === null ? <Muted>Never</Muted> : formatDate(user.lastLoginAt),
  },
];

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-foreground-subtle">{children}</span>;
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function positiveInt(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/** Only whitelisted sort keys reach the query — never pass a raw param to an ORDER BY. */
function sortKeyOf(
  value: string | undefined,
): "email" | "fullName" | "createdAt" | "lastLoginAt" {
  switch (value) {
    case "fullName":
    case "createdAt":
    case "lastLoginAt":
      return value;
    default:
      return "email";
  }
}
