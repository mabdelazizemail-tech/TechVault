import type { ScopeFilter } from "./types";

/**
 * Translates a `ScopeFilter` into a Prisma `where` fragment (CLAUDE.md §11.5).
 *
 * The evaluator stays database-agnostic; this is the single place that knows how a
 * scope becomes SQL. Narrowing happens in the QUERY — never fetch everything and
 * filter in application code, which breaks both performance and pagination.
 */

export type ScopeFieldMapping = {
  /**
   * Path to the materialised org-unit path, as a Prisma nested selector.
   * Example: `["orgUnit", "path"]` for `where: { orgUnit: { path: ... } }`.
   */
  orgUnitPath?: readonly string[];
  /** Field holding the owning principal's ID, e.g. `["createdBy"]`. */
  owner?: readonly string[];
};

/** A Prisma `where` fragment. Deliberately loose: shapes vary per model. */
export type WhereFragment = Record<string, unknown>;

/**
 * Returns a fragment to merge into a query's `where`.
 *
 * `{ kind: "none" }` yields a predicate that matches nothing, rather than
 * returning an empty object — an empty `where` would silently return everything,
 * which is the most dangerous possible failure mode here.
 */
export function scopeWhere(
  filter: ScopeFilter,
  mapping: ScopeFieldMapping,
): WhereFragment {
  if (filter.kind === "all") return {};
  if (filter.kind === "none") return MATCH_NOTHING;

  const alternatives: WhereFragment[] = [];

  if (mapping.orgUnitPath !== undefined) {
    for (const prefix of filter.orgUnitPathPrefixes) {
      alternatives.push(nest(mapping.orgUnitPath, { startsWith: prefix }));
    }
  }

  if (filter.ownerId !== null && mapping.owner !== undefined) {
    alternatives.push(nest(mapping.owner, filter.ownerId));
  }

  // A restricted filter the model cannot express must fail closed.
  if (alternatives.length === 0) return MATCH_NOTHING;
  if (alternatives.length === 1) return alternatives[0] as WhereFragment;
  return { OR: alternatives };
}

/**
 * An impossible predicate. `AND: [{ id: ... }]`-style tricks are avoidable: every
 * model in TechVault has a uuid `id`, and no row has the nil UUID.
 */
const MATCH_NOTHING: WhereFragment = {
  id: "00000000-0000-0000-0000-000000000000",
};

/** Builds `{ a: { b: value } }` from `["a", "b"]`. */
function nest(path: readonly string[], value: unknown): WhereFragment {
  return path.reduceRight<unknown>(
    (accumulator, key) => ({ [key]: accumulator }),
    value,
  ) as WhereFragment;
}
