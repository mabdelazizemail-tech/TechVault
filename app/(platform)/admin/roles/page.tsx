import type { Metadata } from "next";
import { Badge, PageHeader, Panel } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { getActor } from "@/platform/auth/current-user";
import { listRoles, type RoleSummary } from "@/platform/iam/services/catalogue-service";

export const metadata: Metadata = { title: "Roles" };

/**
 * Roles are rows, not an enum (CLAUDE.md §6.4) — which is why this screen exists
 * at all. Adding a role must never require a deploy.
 */
export default async function RolesPage() {
  const actor = await getActor();
  const roles = await listRoles(actor);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Roles"
        description="A role is a named bundle of permissions. Users are granted roles, optionally narrowed to an organisational unit."
      />

      <Panel className="overflow-hidden">
        <DataTable<RoleSummary>
          columns={COLUMNS}
          rows={roles}
          rowKey={(role) => role.id}
          basePath="/admin/roles"
          emptyTitle="No roles defined"
          emptyDescription="Run the database seed to create the system roles."
        />
      </Panel>
    </div>
  );
}

const COLUMNS: readonly Column<RoleSummary>[] = [
  {
    key: "key",
    header: "Key",
    cell: (role) => <code className="font-mono text-xs">{role.key}</code>,
  },
  { key: "name", header: "Name", cell: (role) => role.name },
  {
    key: "description",
    header: "Description",
    hideOnMobile: true,
    cell: (role) => (
      <span className="text-foreground-muted">{role.description ?? "—"}</span>
    ),
  },
  {
    key: "permissionCount",
    header: "Permissions",
    align: "end",
    cell: (role) => role.permissionCount,
  },
  { key: "userCount", header: "Users", align: "end", cell: (role) => role.userCount },
  {
    key: "isSystem",
    header: "Type",
    cell: (role) =>
      role.isSystem ? <Badge tone="info">System</Badge> : <Badge>Custom</Badge>,
  },
];
