import type { Metadata } from "next";
import { Badge, type BadgeTone, PageHeader, Panel } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { getActor } from "@/platform/auth/current-user";
import {
  listAuditRecords,
  type AuditRecord,
} from "@/platform/iam/services/catalogue-service";

export const metadata: Metadata = { title: "Audit trail" };

const PAGE_SIZE = 50;

/**
 * The audit trail (CLAUDE.md §18.6).
 *
 * Append-only: there is no edit or delete action on this screen, and no service
 * function that could back one. Reading it requires `platform.audit.read`, which
 * is itself a sensitive permission — the trail reveals who did what, when.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const actor = await getActor();

  const page = Number.parseInt(params.page ?? "1", 10);

  const result = await listAuditRecords(actor, {
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: PAGE_SIZE,
    module: params.module,
    action: params.action,
    entityId: params.entity,
  });

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Audit trail"
        description="Every business- and security-significant operation, in the order it happened. Records are never edited or deleted."
      />

      <Panel className="overflow-hidden">
        <DataTable<AuditRecord>
          columns={COLUMNS}
          rows={result.rows}
          rowKey={(record) => record.id}
          basePath="/admin/audit"
          searchParams={params}
          page={{ page: result.page, pageSize: result.pageSize, total: result.total }}
          emptyTitle="No audit records yet"
          emptyDescription="Records appear here as soon as users sign in and operations are performed."
        />
      </Panel>
    </div>
  );
}

const COLUMNS: readonly Column<AuditRecord>[] = [
  {
    key: "occurredAt",
    header: "When",
    cell: (record) => (
      <span className="whitespace-nowrap tabular-nums">
        {formatTimestamp(record.occurredAt)}
      </span>
    ),
    width: "11rem",
  },
  {
    key: "severity",
    header: "Severity",
    cell: (record) => (
      <Badge tone={toneForSeverity(record.severity)}>{record.severity}</Badge>
    ),
  },
  {
    key: "action",
    header: "Action",
    cell: (record) => <code className="font-mono text-xs">{record.action}</code>,
  },
  {
    key: "summary",
    header: "Summary",
    cell: (record) => record.summary,
  },
  {
    key: "entity",
    header: "Entity",
    hideOnMobile: true,
    cell: (record) => (
      <span className="text-foreground-muted">
        {record.entityType}
        {record.entityId !== null && (
          <span className="text-foreground-subtle"> #{record.entityId.slice(0, 8)}</span>
        )}
      </span>
    ),
  },
  {
    key: "actor",
    header: "Actor",
    hideOnMobile: true,
    cell: (record) => (
      <span className="text-foreground-muted font-mono text-xs">
        {record.actorLabel.slice(0, 8)}
      </span>
    ),
  },
];

function toneForSeverity(severity: string): BadgeTone {
  switch (severity) {
    case "CRITICAL":
      return "danger";
    case "WARNING":
      return "warning";
    case "NOTICE":
      return "info";
    default:
      return "neutral";
  }
}

function formatTimestamp(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(value);
}
