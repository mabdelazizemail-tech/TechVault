import { cache } from "react";
import { prisma } from "@/lib/prisma";
import type {
  PermissionSet,
  Principal,
  ResolvedGrant,
  ScopeType,
} from "@/platform/authz/types";

/**
 * Resolves everything needed to answer permission questions for one principal
 * (CLAUDE.md §11).
 *
 * Role grants, group grants, direct grants and active delegations are flattened
 * into a single list of `ResolvedGrant`, so the evaluator does not care where a
 * permission came from.
 *
 * Wrapped in React's `cache()`, which memoises per request and nothing longer —
 * a permission decision must never be cached across requests (§11.9).
 */
export const getPermissionSet = cache(
  async (principalId: string): Promise<PermissionSet | null> => {
    const user = await prisma.user.findUnique({
      where: { id: principalId },
      select: {
        id: true,
        isActive: true,
        deletedAt: true,
        orgUnitId: true,
        orgUnit: { select: { path: true } },

        roles: {
          select: {
            scopeType: true,
            scopeOrgUnitId: true,
            startsAt: true,
            endsAt: true,
            scopeOrgUnit: { select: { path: true } },
            role: {
              select: {
                key: true,
                isActive: true,
                deletedAt: true,
                permissions: { select: { permission: { select: { key: true } } } },
              },
            },
          },
        },

        grants: {
          select: {
            effect: true,
            scopeType: true,
            scopeOrgUnitId: true,
            startsAt: true,
            endsAt: true,
            reason: true,
            scopeOrgUnit: { select: { path: true } },
            permission: { select: { key: true } },
          },
        },

        groupMemberships: {
          select: {
            group: {
              select: {
                key: true,
                isActive: true,
                deletedAt: true,
                roles: {
                  select: {
                    scopeType: true,
                    scopeOrgUnitId: true,
                    scopeOrgUnit: { select: { path: true } },
                    role: {
                      select: {
                        key: true,
                        isActive: true,
                        deletedAt: true,
                        permissions: {
                          select: { permission: { select: { key: true } } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },

        delegationsGot: {
          where: { revokedAt: null },
          select: {
            startsAt: true,
            endsAt: true,
            fromUserId: true,
            role: {
              select: {
                key: true,
                isActive: true,
                deletedAt: true,
                permissions: { select: { permission: { select: { key: true } } } },
              },
            },
          },
        },
      },
    });

    if (user === null) return null;

    const principal: Principal = {
      id: user.id,
      type: "USER",
      // A soft-deleted or deactivated account is treated as having no access at
      // all, re-checked on every request rather than only at sign-in (§11.1).
      isActive: user.isActive && user.deletedAt === null,
      orgUnitId: user.orgUnitId,
      orgUnitPath: user.orgUnit?.path ?? null,
    };

    const grants: ResolvedGrant[] = [];

    for (const assignment of user.roles) {
      if (!isUsableRole(assignment.role)) continue;
      for (const { permission } of assignment.role.permissions) {
        grants.push({
          permissionKey: permission.key,
          effect: "ALLOW",
          scopeType: assignment.scopeType as ScopeType,
          scopeOrgUnitId: assignment.scopeOrgUnitId,
          scopeOrgUnitPath: assignment.scopeOrgUnit?.path ?? null,
          startsAt: assignment.startsAt,
          endsAt: assignment.endsAt,
          source: "ROLE",
          sourceLabel: assignment.role.key,
        });
      }
    }

    for (const membership of user.groupMemberships) {
      const group = membership.group;
      if (!group.isActive || group.deletedAt !== null) continue;

      for (const assignment of group.roles) {
        if (!isUsableRole(assignment.role)) continue;
        for (const { permission } of assignment.role.permissions) {
          grants.push({
            permissionKey: permission.key,
            effect: "ALLOW",
            scopeType: assignment.scopeType as ScopeType,
            scopeOrgUnitId: assignment.scopeOrgUnitId,
            scopeOrgUnitPath: assignment.scopeOrgUnit?.path ?? null,
            startsAt: null,
            endsAt: null,
            source: "GROUP",
            sourceLabel: `${group.key}:${assignment.role.key}`,
          });
        }
      }
    }

    for (const grant of user.grants) {
      grants.push({
        permissionKey: grant.permission.key,
        effect: grant.effect,
        scopeType: grant.scopeType as ScopeType,
        scopeOrgUnitId: grant.scopeOrgUnitId,
        scopeOrgUnitPath: grant.scopeOrgUnit?.path ?? null,
        startsAt: grant.startsAt,
        endsAt: grant.endsAt,
        source: "DIRECT",
        sourceLabel: grant.reason,
      });
    }

    for (const delegation of user.delegationsGot) {
      const role = delegation.role;
      if (role === null || !isUsableRole(role)) continue;
      for (const { permission } of role.permissions) {
        grants.push({
          permissionKey: permission.key,
          effect: "ALLOW",
          // A delegation carries the delegated role's permissions for the
          // delegation window only. It is always time-boxed by design.
          scopeType: "GLOBAL",
          scopeOrgUnitId: null,
          scopeOrgUnitPath: null,
          startsAt: delegation.startsAt,
          endsAt: delegation.endsAt,
          source: "DELEGATION",
          sourceLabel: `from:${delegation.fromUserId}:${role.key}`,
        });
      }
    }

    return { principal, grants };
  },
);

function isUsableRole(role: { isActive: boolean; deletedAt: Date | null }): boolean {
  return role.isActive && role.deletedAt === null;
}
