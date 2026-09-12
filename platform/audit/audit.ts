import type { AuditSeverity } from "@prisma/client";
import { prisma, type PrismaTransaction } from "@/lib/prisma";
import { logger } from "@/platform/observability/logger";

/**
 * Append-only audit logging (CLAUDE.md §18.6).
 *
 * There is deliberately no update or delete function in this module, and the
 * database role the application uses must not hold UPDATE or DELETE on
 * `platform.audit_log`. An audit trail that can be edited is not an audit trail.
 *
 * Call this INSIDE the business transaction (pass `tx`) so a change and its audit
 * record commit or roll back together — an audited change that did not happen is
 * as wrong as an unaudited change that did.
 */

export type AuditEntry = {
  /** The acting user, or null for system activity (then set `actorLabel`). */
  actorId?: string | null;
  /** Describes a non-user actor: "scheduler", "integration:bank-feed". */
  actorLabel?: string | null;
  /** Dotted action name, e.g. "iam.role.assigned". */
  action: string;
  module: string;
  entityType: string;
  entityId?: string | null;
  /** One-line, human-readable, safe to display. Never put sensitive values here. */
  summary: string;
  /** Changed fields only. See `diffForAudit` — never copy sensitive values. */
  changes?: Record<string, unknown> | null;
  severity?: AuditSeverity;
  ipAddress?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
};

/**
 * Writes one audit record.
 *
 * Pass `tx` whenever there is a surrounding transaction. Without it the write is
 * standalone, which is correct only for events that are not part of a business
 * change — a login, or a permission denial.
 */
export async function recordAudit(
  entry: AuditEntry,
  tx?: PrismaTransaction,
): Promise<void> {
  const client = tx ?? prisma;

  await client.auditLog.create({
    data: {
      actorId: entry.actorId ?? null,
      actorLabel: entry.actorLabel ?? null,
      action: entry.action,
      module: entry.module,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      summary: entry.summary,
      changes: (entry.changes ?? undefined) as never,
      severity: entry.severity ?? "INFO",
      ipAddress: entry.ipAddress ?? null,
      userAgent: entry.userAgent ?? null,
      correlationId: entry.correlationId ?? null,
    },
  });
}

/**
 * Best-effort audit write for paths that must not fail because auditing failed.
 *
 * Use this ONLY for observational records outside a business transaction, such as
 * a permission denial. Never use it for a business change: there, a failed audit
 * write must roll the change back.
 */
export async function recordAuditSafely(entry: AuditEntry): Promise<void> {
  try {
    await recordAudit(entry);
  } catch (error) {
    logger.error("Failed to write audit record", {
      action: entry.action,
      module: entry.module,
      entityType: entry.entityType,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
}

// Re-exported so callers have one import for audit concerns, while the pure
// helper itself stays free of the database client. See ./diff.ts.
export { diffForAudit } from "./diff";
