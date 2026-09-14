/**
 * Authorization types (CLAUDE.md §11).
 *
 * These intentionally mirror the `iam` enum values as plain string unions so the
 * evaluator stays a pure function with no database dependency — which is what
 * makes the permission model unit-testable without a Postgres instance.
 */

export type PermissionAction =
  | "ACCESS"
  | "READ"
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "APPROVE"
  | "EXPORT"
  | "DOWNLOAD"
  | "SHARE"
  | "ADMINISTER"
  | "POST"
  | "REVERSE"
  | "CLOSE"
  | "REOPEN";

export type ScopeType = "GLOBAL" | "ORG_UNIT" | "OWN_ORG_UNIT" | "OWN";

export type GrantEffect = "ALLOW" | "DENY";

export type PrincipalType = "USER" | "SERVICE_ACCOUNT";

/** A permission as declared by the module that owns it. */
export type PermissionDefinition = {
  /** "<module>.<resource>.<action>" — e.g. "crm.account.read". */
  key: string;
  module: string;
  resource: string;
  action: PermissionAction;
  description: string;
  /**
   * Sensitive permissions require their own explicit grant and every use is
   * audited (CLAUDE.md §11.7). Salary, national ID, bank details.
   */
  isSensitive?: boolean;
};

/** The identity asking to do something. */
export type Principal = {
  id: string;
  type: PrincipalType;
  isActive: boolean;
  /** The principal's own organisational unit, if any. */
  orgUnitId: string | null;
  /** Materialised path of that unit, e.g. "/root/finance/ap". */
  orgUnitPath: string | null;
};

/**
 * One resolved grant. Role grants, group grants and direct grants are all
 * flattened into this shape before evaluation, so the evaluator does not care
 * where a permission came from.
 */
export type ResolvedGrant = {
  permissionKey: string;
  effect: GrantEffect;
  scopeType: ScopeType;
  /** Set when scopeType is ORG_UNIT. */
  scopeOrgUnitId: string | null;
  /** Materialised path of that unit, used for subtree matching. */
  scopeOrgUnitPath: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  /** Where this grant came from — for the "why can this user do that?" screen. */
  source: "ROLE" | "GROUP" | "DIRECT" | "DELEGATION";
  sourceLabel: string;
};

/** Everything needed to decide any permission question for one principal. */
export type PermissionSet = {
  principal: Principal;
  grants: readonly ResolvedGrant[];
};

/**
 * The resource being acted on.
 *
 * Omit it to ask the weaker question "could this principal do this to anything
 * at all?" — which is the right question for navigation and menu gating, and the
 * wrong question for authorising an actual operation. See `evaluate()`.
 */
export type ScopeTarget = {
  /** The organisational unit the resource belongs to. */
  orgUnitId?: string | null;
  /** Materialised path of that unit. Required for ORG_UNIT subtree matching. */
  orgUnitPath?: string | null;
  /** The principal ID that owns the resource, for OWN scope. */
  ownerId?: string | null;
};

export type DenialReason =
  | "PRINCIPAL_INACTIVE"
  | "NO_GRANT"
  | "EXPLICIT_DENY"
  | "OUT_OF_SCOPE"
  | "GRANT_NOT_YET_VALID"
  | "GRANT_EXPIRED";

export type Decision =
  | { allowed: true; matchedGrant: ResolvedGrant }
  | { allowed: false; reason: DenialReason };

/**
 * A database-agnostic description of which rows a principal may see.
 * Repositories translate this into a query predicate; the evaluator stays pure.
 */
export type ScopeFilter =
  | { kind: "all" }
  | { kind: "none" }
  | {
      kind: "restricted";
      /** Rows whose org unit path starts with any of these prefixes. */
      orgUnitPathPrefixes: string[];
      /** Rows owned by this principal, when an OWN-scoped grant applies. */
      ownerId: string | null;
    };
