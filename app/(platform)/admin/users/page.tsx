import type { Metadata } from "next";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Badge, PageHeader, Panel } from "@/components/ui/primitives";
import { getActor } from "@/platform/auth/current-user";
import { isAccountAdminConfigured } from "@/platform/auth/identity-admin";
import { canAll } from "@/platform/authz/authz";
import { IAM_PERMISSIONS } from "@/platform/iam/permissions";
import { listUserAdminOptions } from "@/platform/iam/services/user-admin-service";
import { listUsers, type UserListItem } from "@/platform/iam/services/user-service";
import { UserFilters, type UserFilterValues } from "./user-filters";
import { AddUserButton, UserDialogsHost, UserRowActions } from "./user-row-actions";
import { UsersAdminProvider } from "./users-admin-context";

export const metadata: Metadata = { title: "Users" };

const PAGE_SIZE = 25;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * User administration (ADR-019).
 *
 * Search, filters, sort and page live in the URL (CLAUDE.md §16.4) and are applied
 * by the database — the page receives one page of rows the administrator may see,
 * never the whole table (§11.5, §21). The list, the filter options and the
 * administrator's rights load in parallel against one request-cached permission
 * set. Every action behind the menu is authorised again on the server.
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
  const status =
    params.status === "active" || params.status === "inactive" ? params.status : "all";
  const roleId = uuidOrEmpty(params.roleId);
  const orgUnitId = uuidOrEmpty(params.orgUnitId);
  const search = (params.q ?? "").trim();

  const [result, options, rights] = await Promise.all([
    listUsers(actor, {
      page,
      pageSize: PAGE_SIZE,
      sort,
      direction,
      status,
      search: search === "" ? undefined : search,
      roleId: roleId === "" ? undefined : roleId,
      orgUnitId: orgUnitId === "" ? undefined : orgUnitId,
    }),
    listUserAdminOptions(actor),
    canAll(actor, [
      IAM_PERMISSIONS.USER_CREATE,
      IAM_PERMISSIONS.USER_UPDATE,
      IAM_PERMISSIONS.USER_ADMINISTER,
      IAM_PERMISSIONS.USER_DELETE,
    ]),
  ]);

  const filterValues: UserFilterValues = {
    q: search,
    status,
    roleId,
    orgUnitId,
    sort,
    dir: direction,
  };
  const accountAdminConfigured = isAccountAdminConfigured();

  return (
    <UsersAdminProvider
      value={{
        currentUserId: actor.id,
        accountAdminConfigured,
        rights: {
          create: rights[IAM_PERMISSIONS.USER_CREATE] === true,
          update: rights[IAM_PERMISSIONS.USER_UPDATE] === true,
          administer: rights[IAM_PERMISSIONS.USER_ADMINISTER] === true,
          delete: rights[IAM_PERMISSIONS.USER_DELETE] === true,
        },
        options,
      }}
    >
      <div className="max-w-6xl">
        <PageHeader
          title="Users"
          description="Accounts that can sign in to TechVault. Accounts are created deliberately — TechVault never provisions one automatically from a sign-in."
          actions={<AddUserButton />}
        />

        {!accountAdminConfigured && rights[IAM_PERMISSIONS.USER_CREATE] === true && (
          <p className="border-warning/30 bg-warning-subtle text-warning mb-3 border px-3 py-2 text-xs">
            Creating, re-addressing and deleting sign-in accounts needs
            SUPABASE_SECRET_KEY on the server. Editing, roles, units, activation and
            password resets work without it.
          </p>
        )}

        <Panel className="overflow-hidden">
          <UserFilters values={filterValues} options={options} />
          <DataTable<UserListItem>
            columns={COLUMNS}
            rows={result.rows}
            rowKey={(user) => user.id}
            rowHref={(user) => `/admin/users/${user.id}`}
            basePath="/admin/users"
            searchParams={params}
            sort={{ key: sort, direction }}
            page={{ page: result.page, pageSize: result.pageSize, total: result.total }}
            emptyTitle="No users match these filters"
            emptyDescription="Try a different search, or clear the filters."
          />
        </Panel>
      </div>
      <UserDialogsHost />
    </UsersAdminProvider>
  );
}

const COLUMNS: readonly Column<UserListItem>[] = [
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
    cell: (user) =>
      user.fullName === null ? (
        <Muted>Not set</Muted>
      ) : (
        <span dir="auto">{user.fullName}</span>
      ),
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
  {
    key: "actions",
    header: "Actions",
    align: "end",
    width: "4.5rem",
    cell: (user) => (
      <UserRowActions
        user={{
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          locale: user.locale,
          isActive: user.isActive,
          orgUnitId: user.orgUnitId,
          globalRoleIds: user.globalRoleIds,
        }}
      />
    ),
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

function uuidOrEmpty(value: string | undefined): string {
  return value !== undefined && UUID_PATTERN.test(value) ? value : "";
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
