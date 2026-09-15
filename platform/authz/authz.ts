import { ForbiddenError, UnauthenticatedError } from "@/lib/errors";
import { recordAuditSafely } from "@/platform/audit/audit";
import { getPermissionSet } from "@/platform/iam/permission-loader";
import { logger } from "@/platform/observability/logger";
import { describeDenial, evaluate, evaluateGlobal, scopeFilterFor } from "./evaluate";
import type { Decision, PermissionSet, ScopeFilter, ScopeTarget } from "./types";

/**
 * The authorization API every module uses (CLAUDE.md §11.3).
 *
 * Nothing else in TechVault decides whether an action is allowed. There is no
 * `isAdmin` shortcut, and no module inspects roles directly — a role is an
 * implementation detail of how permissions are granted.
 *
 * Call these at the TOP of a service operation, before any work. The service is
 * the security boundary because it is the one layer every entry point passes
 * through; a UI check is usability, never a control (§11.4).
 */

export type Actor = {
  id: string;
  /** Present for requests, used to enrich denial audit records. */
  ipAddress?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
};

async function permissionSetFor(actor: Actor): Promise<PermissionSet> {
  const set = await getPermissionSet(actor.id);
  if (set === null) {
    // A verified session whose IAM user row is missing is not an authenticated
    // user, regardless of what the auth provider says.
    throw new UnauthenticatedError();
  }
  return set;
}

/** Answers a permission question without throwing. Use for UI gating and branching. */
export async function can(
  actor: Actor,
  permission: string,
  target?: ScopeTarget,
): Promise<boolean> {
  const set = await permissionSetFor(actor);
  return evaluate(set, permission, target).allowed;
}

/**
 * Asserts a permission, throwing `ForbiddenError` when it is not held.
 *
 * Every denial is logged and audited: repeated denials are either a bug or an
 * attack, and both need to be visible (§11.6).
 */
export async function requirePermission(
  actor: Actor,
  permission: string,
  target?: ScopeTarget,
): Promise<void> {
  const set = await permissionSetFor(actor);
  const decision = evaluate(set, permission, target);

  if (decision.allowed) return;

  await reportDenial(actor, permission, target, decision);
  throw new ForbiddenError(describeDenial(decision.reason), {
    permission,
    reason: decision.reason,
  });
}

/**
 * Asserts a permission held ORGANISATION-WIDE, throwing `ForbiddenError` otherwise.
 *
 * Use it for operations on records with no org unit or owner to scope by (ERP's
 * ledger, for example): a unit- or own-scoped grant authorises nothing here. Denials
 * are logged and audited exactly like `requirePermission`.
 */
export async function requireGlobalPermission(
  actor: Actor,
  permission: string,
): Promise<void> {
  const set = await permissionSetFor(actor);
  const decision = evaluateGlobal(set, permission);

  if (decision.allowed) return;

  await reportDenial(actor, permission, undefined, decision);
  throw new ForbiddenError(describeDenial(decision.reason), {
    permission,
    reason: decision.reason,
  });
}

/** `can()` for organisation-wide operations: true only for a GLOBAL grant. */
export async function canGlobally(actor: Actor, permission: string): Promise<boolean> {
  const set = await permissionSetFor(actor);
  return evaluateGlobal(set, permission).allowed;
}

/** `canAll()` for organisation-wide operations: true only for GLOBAL grants. */
export async function canAllGlobally(
  actor: Actor,
  permissions: readonly string[],
): Promise<Record<string, boolean>> {
  const set = await permissionSetFor(actor);
  const result: Record<string, boolean> = {};
  for (const permission of permissions) {
    result[permission] = evaluateGlobal(set, permission).allowed;
  }
  return result;
}

/**
 * The row-level filter for a list query (§11.5).
 *
 * Narrow the query with this. Never fetch everything and filter afterwards — that
 * is both a performance bug and, once paginated, a correctness bug.
 */
export async function scopeFilter(
  actor: Actor,
  permission: string,
): Promise<ScopeFilter> {
  const set = await permissionSetFor(actor);
  return scopeFilterFor(set, permission);
}

/**
 * Evaluates many permissions at once against the same (request-cached) permission
 * set. Used by the navigation and page shells, which need a dozen answers to
 * decide what to render.
 */
export async function canAll(
  actor: Actor,
  permissions: readonly string[],
): Promise<Record<string, boolean>> {
  const set = await permissionSetFor(actor);
  const result: Record<string, boolean> = {};
  for (const permission of permissions) {
    result[permission] = evaluate(set, permission).allowed;
  }
  return result;
}

/**
 * Explains how a principal obtained a permission — the "why can this user do
 * that?" answer an administrator needs when reviewing access.
 */
export async function explain(
  actor: Actor,
  permission: string,
  target?: ScopeTarget,
): Promise<Decision> {
  const set = await permissionSetFor(actor);
  return evaluate(set, permission, target);
}

async function reportDenial(
  actor: Actor,
  permission: string,
  target: ScopeTarget | undefined,
  decision: Extract<Decision, { allowed: false }>,
): Promise<void> {
  logger.warn("Permission denied", {
    actorId: actor.id,
    module: "iam",
    operation: "authz.denied",
    permission,
    reason: decision.reason,
    targetOrgUnitId: target?.orgUnitId ?? null,
    correlationId: actor.correlationId ?? undefined,
  });

  // Best-effort: a failure to audit a denial must not convert a clean 403 into a
  // 500. The denial itself is already logged above.
  await recordAuditSafely({
    actorId: actor.id,
    action: "iam.permission.denied",
    module: "iam",
    entityType: "Permission",
    entityId: null,
    summary: `Denied "${permission}" (${decision.reason})`,
    changes: { permission, reason: decision.reason },
    severity: "WARNING",
    ipAddress: actor.ipAddress ?? null,
    userAgent: actor.userAgent ?? null,
    correlationId: actor.correlationId ?? null,
  });
}
