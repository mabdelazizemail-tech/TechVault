import type {
  Decision,
  DenialReason,
  PermissionSet,
  ResolvedGrant,
  ScopeFilter,
  ScopeTarget,
} from "./types";

/**
 * The permission evaluator (CLAUDE.md §11).
 *
 * A pure function of (permission set, permission key, target) → decision. It
 * performs no I/O, which is deliberate: this is the most security-critical logic
 * in TechVault and it must be exhaustively unit-testable without a database.
 *
 * Evaluation order:
 *   1. An inactive principal is denied everything.
 *   2. Grants are narrowed to the exact permission key. There is no wildcard or
 *      implication between actions — an ADMINISTER grant does not confer READ.
 *      Admin roles are seeded with every permission they need, explicitly.
 *   3. Grants outside their validity window are discarded.
 *   4. Any applicable DENY wins over every ALLOW, from any source.
 *   5. Otherwise an ALLOW whose scope covers the target permits the action.
 */
export function evaluate(
  set: PermissionSet,
  permissionKey: string,
  target?: ScopeTarget,
  now: Date = new Date(),
): Decision {
  if (!set.principal.isActive) {
    return { allowed: false, reason: "PRINCIPAL_INACTIVE" };
  }

  const forPermission = set.grants.filter(
    (grant) => grant.permissionKey === permissionKey,
  );
  if (forPermission.length === 0) {
    return { allowed: false, reason: "NO_GRANT" };
  }

  const active = forPermission.filter((grant) => isWithinValidity(grant, now));
  if (active.length === 0) {
    // Distinguish "not yet" from "no longer" — it changes the admin's next step.
    const anyFuture = forPermission.some(
      (grant) => grant.startsAt !== null && grant.startsAt > now,
    );
    return {
      allowed: false,
      reason: anyFuture ? "GRANT_NOT_YET_VALID" : "GRANT_EXPIRED",
    };
  }

  const applicable = active.filter((grant) => scopeCovers(grant, set, target));

  const deny = applicable.find((grant) => grant.effect === "DENY");
  if (deny) {
    return { allowed: false, reason: "EXPLICIT_DENY" };
  }

  const allow = applicable.find((grant) => grant.effect === "ALLOW");
  if (allow) {
    return { allowed: true, matchedGrant: allow };
  }

  // The principal holds the permission, but not for this resource.
  return { allowed: false, reason: "OUT_OF_SCOPE" };
}

/**
 * Whether a principal holds a permission ORGANISATION-WIDE.
 *
 * For operations on records that belong to no org unit and no owner — a general
 * ledger, a chart of accounts, module settings — there is no target to pass, and
 * `evaluate()` without a target lets any scope through. A grant scoped to one unit
 * or to "own records" must not become organisation-wide access by accident, so
 * this demands an active GLOBAL ALLOW and fails closed otherwise. Any applicable
 * DENY, whatever its scope, still wins.
 */
export function evaluateGlobal(
  set: PermissionSet,
  permissionKey: string,
  now: Date = new Date(),
): Decision {
  const decision = evaluate(set, permissionKey, undefined, now);
  if (!decision.allowed) return decision;

  const globalAllow = set.grants.find(
    (grant) =>
      grant.permissionKey === permissionKey &&
      grant.effect === "ALLOW" &&
      grant.scopeType === "GLOBAL" &&
      isWithinValidity(grant, now),
  );
  return globalAllow
    ? { allowed: true, matchedGrant: globalAllow }
    : { allowed: false, reason: "OUT_OF_SCOPE" };
}

function isWithinValidity(grant: ResolvedGrant, now: Date): boolean {
  if (grant.startsAt !== null && grant.startsAt > now) return false;
  if (grant.endsAt !== null && grant.endsAt <= now) return false;
  return true;
}

/**
 * Whether a grant's scope covers the target resource.
 *
 * When no target is given the question being asked is "could this principal do
 * this to anything at all?", so any scope qualifies. Callers authorising a real
 * operation MUST pass a target — otherwise an OWN-scoped user would pass a check
 * for somebody else's record.
 */
function scopeCovers(
  grant: ResolvedGrant,
  set: PermissionSet,
  target: ScopeTarget | undefined,
): boolean {
  if (grant.scopeType === "GLOBAL") return true;
  if (target === undefined) return true;

  switch (grant.scopeType) {
    case "ORG_UNIT": {
      if (grant.scopeOrgUnitPath === null) return false;
      return isWithinSubtree(target.orgUnitPath, grant.scopeOrgUnitPath);
    }
    case "OWN_ORG_UNIT": {
      const principalPath = set.principal.orgUnitPath;
      if (principalPath === null) return false;
      return isWithinSubtree(target.orgUnitPath, principalPath);
    }
    case "OWN": {
      return (
        target.ownerId !== undefined &&
        target.ownerId !== null &&
        target.ownerId === set.principal.id
      );
    }
    default:
      return false;
  }
}

/**
 * Subtree containment by materialised path.
 *
 * Paths are compared with a trailing separator so that "/root/fin" does not
 * match "/root/finance" — a bug that would silently widen access.
 */
export function isWithinSubtree(
  targetPath: string | null | undefined,
  ancestorPath: string,
): boolean {
  if (!targetPath) return false;
  if (targetPath === ancestorPath) return true;
  const prefix = ancestorPath.endsWith("/") ? ancestorPath : `${ancestorPath}/`;
  return targetPath.startsWith(prefix);
}

/**
 * Derives the row-level filter for a list query (CLAUDE.md §11.5).
 *
 * Filtering a list is a permission operation: narrow the query, never fetch
 * everything and filter in application code.
 */
export function scopeFilterFor(
  set: PermissionSet,
  permissionKey: string,
  now: Date = new Date(),
): ScopeFilter {
  if (!set.principal.isActive) return { kind: "none" };

  const active = set.grants.filter(
    (grant) => grant.permissionKey === permissionKey && isWithinValidity(grant, now),
  );

  // A DENY that is not scope-limited removes the permission entirely. Scoped
  // denials cannot be expressed as a positive filter, so they are applied at the
  // point of use by `evaluate()` — list queries must therefore re-check any row
  // they then act on.
  if (active.some((grant) => grant.effect === "DENY" && grant.scopeType === "GLOBAL")) {
    return { kind: "none" };
  }

  const allows = active.filter((grant) => grant.effect === "ALLOW");
  if (allows.length === 0) return { kind: "none" };
  if (allows.some((grant) => grant.scopeType === "GLOBAL")) return { kind: "all" };

  const prefixes = new Set<string>();
  let ownerId: string | null = null;

  for (const grant of allows) {
    switch (grant.scopeType) {
      case "ORG_UNIT":
        if (grant.scopeOrgUnitPath !== null) prefixes.add(grant.scopeOrgUnitPath);
        break;
      case "OWN_ORG_UNIT":
        if (set.principal.orgUnitPath !== null) prefixes.add(set.principal.orgUnitPath);
        break;
      case "OWN":
        ownerId = set.principal.id;
        break;
      default:
        break;
    }
  }

  if (prefixes.size === 0 && ownerId === null) return { kind: "none" };

  return {
    kind: "restricted",
    orgUnitPathPrefixes: [...prefixes],
    ownerId,
  };
}

/** A message safe to show a user, and a reason safe to log. */
export function describeDenial(reason: DenialReason): string {
  switch (reason) {
    case "PRINCIPAL_INACTIVE":
      return "This account is not active.";
    case "GRANT_NOT_YET_VALID":
      return "Your access to this does not start yet.";
    case "GRANT_EXPIRED":
      return "Your access to this has expired.";
    case "EXPLICIT_DENY":
    case "OUT_OF_SCOPE":
    case "NO_GRANT":
    default:
      // Deliberately uniform: do not reveal which permission or scope is missing
      // on a resource the user may not know exists (CLAUDE.md §11.6).
      return "You do not have permission to perform this action.";
  }
}
