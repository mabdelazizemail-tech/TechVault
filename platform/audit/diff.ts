/**
 * Audit change-set construction.
 *
 * Kept separate from `audit.ts` deliberately: this is a pure function, and it must
 * be importable (and testable) without pulling in the database client. A helper
 * that boots a connection pool just to be imported is a helper in the wrong file.
 */

/**
 * Builds the `changes` payload for an update.
 *
 * Only changed keys are included. Keys named in `sensitiveKeys` record THAT they
 * changed without recording the values — the audit trail must prove a salary was
 * altered without becoming a second copy of the salary (CLAUDE.md §18.5).
 */
export function diffForAudit(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  sensitiveKeys: readonly string[] = [],
): Record<string, { from: unknown; to: unknown }> {
  const sensitive = new Set(sensitiveKeys);
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const from = before[key];
    const to = after[key];
    if (Object.is(from, to)) continue;
    if (from instanceof Date && to instanceof Date && from.getTime() === to.getTime()) {
      continue;
    }

    changes[key] = sensitive.has(key)
      ? { from: "[changed]", to: "[changed]" }
      : { from, to };
  }

  return changes;
}
