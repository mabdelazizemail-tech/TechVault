import type { Metadata } from "next";
import { Badge, PageHeader, Panel } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { getActor } from "@/platform/auth/current-user";
import {
  listPermissions,
  type PermissionSummary,
} from "@/platform/iam/services/catalogue-service";

export const metadata: Metadata = { title: "Permissions" };

/**
 * The permission catalogue.
 *
 * Rows here are seeded from each module's `contracts/permissions.ts` — modules
 * declare, IAM stores and grants (CLAUDE.md §11.2). A permission missing from this
 * list means its module has not been seeded, which is why unbuilt modules do not
 * appear in navigation.
 */
export default async function PermissionsPage() {
  const actor = await getActor();
  const permissions = await listPermissions(actor);

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Permissions"
        description="The catalogue of every permission TechVault can grant, in the form module.resource.action."
      />

      <Panel className="overflow-hidden">
        <DataTable<PermissionSummary>
          columns={COLUMNS}
          rows={permissions}
          rowKey={(permission) => permission.id}
          basePath="/admin/permissions"
          emptyTitle="The catalogue is empty"
          emptyDescription="Run the database seed to populate the permission catalogue."
        />
      </Panel>
    </div>
  );
}

const COLUMNS: readonly Column<PermissionSummary>[] = [
  {
    key: "key",
    header: "Permission",
    cell: (permission) => <code className="font-mono text-xs">{permission.key}</code>,
  },
  { key: "module", header: "Module", cell: (permission) => permission.module },
  {
    key: "description",
    header: "Description",
    hideOnMobile: true,
    cell: (permission) => (
      <span className="text-foreground-muted">{permission.description}</span>
    ),
  },
  {
    key: "isSensitive",
    header: "Sensitivity",
    cell: (permission) =>
      permission.isSensitive ? (
        // Sensitive permissions require their own grant and every use is audited.
        <Badge tone="danger">Sensitive</Badge>
      ) : (
        <Badge>Standard</Badge>
      ),
  },
  {
    key: "roleCount",
    header: "In roles",
    align: "end",
    cell: (permission) => permission.roleCount,
  },
];
