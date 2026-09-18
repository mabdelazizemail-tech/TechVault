/**
 * What a verified session may do, from its IAM user row (CLAUDE.md §11.1).
 *
 * Pure, so the rule every request depends on is unit-tested on its own:
 * - `disabled` — no row, deactivated or deleted: treated as unauthenticated;
 * - `password-change` — an administrator set a temporary password (ADR-034): the
 *   only thing the session may do is choose a new one;
 * - `full` — normal use, subject to the permission checks in every service.
 */
export type SessionAccess = "disabled" | "password-change" | "full";

export function sessionAccess(
  user: { isActive: boolean; deletedAt: Date | null; mustChangePassword: boolean } | null,
): SessionAccess {
  if (user === null || !user.isActive || user.deletedAt !== null) return "disabled";
  return user.mustChangePassword ? "password-change" : "full";
}
