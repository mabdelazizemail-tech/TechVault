import { z } from "zod";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { diffForAudit, recordAudit } from "@/platform/audit/audit";
import { type Actor, requirePermission, scopeFilter } from "@/platform/authz/authz";
import { scopeWhere } from "@/platform/authz/prisma-filter";
import { publish } from "@/platform/events/publish";
import { IAM_PERMISSIONS } from "@/platform/iam/permissions";
import {
  assertAdministrationRemains,
  lockAdministration,
} from "@/platform/iam/services/admin-guard";
import { syncSignInBan } from "@/platform/iam/services/user-admin-service";

/**
 * User administration (CLAUDE.md §11, §19.2).
 *
 * Every operation follows the same shape, and new operations must too:
 *
 *   1. require the permission (with a scope target for record-level operations)
 *   2. validate the input with Zod
 *   3. do the work in a transaction, writing the audit entry and the outbox event
 *      INSIDE that transaction
 *   4. return a DTO, never a raw Prisma entity
 */

const MAX_PAGE_SIZE = 100;

export const listUsersInput = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).default(25),
  search: z.string().trim().max(200).optional(),
  sort: z.enum(["email", "fullName", "createdAt", "lastLoginAt"]).default("email"),
  direction: z.enum(["asc", "desc"]).default("asc"),
  includeInactive: z.boolean().default(false),
  /** Takes precedence over includeInactive when set. */
  status: z.enum(["all", "active", "inactive"]).optional(),
  roleId: z.string().uuid().optional(),
  orgUnitId: z.string().uuid().optional(),
});

export type ListUsersInput = z.input<typeof listUsersInput>;

/** The user DTO. Deliberately narrow — a DTO is a contract, not a table dump. */
export type UserSummary = {
  id: string;
  email: string;
  fullName: string | null;
  isActive: boolean;
  orgUnitName: string | null;
  roleKeys: string[];
  lastLoginAt: Date | null;
  createdAt: Date;
};

/** A row of the administration list: the summary plus what the row's actions need. */
export type UserListItem = UserSummary & {
  locale: string;
  orgUnitId: string | null;
  /** Unscoped role assignments — the ones the "Change role" dialog manages. */
  globalRoleIds: string[];
};

export type Paginated<T> = {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
};

export async function listUsers(
  actor: Actor,
  rawInput: ListUsersInput = {},
): Promise<Paginated<UserListItem>> {
  await requirePermission(actor, IAM_PERMISSIONS.USER_READ);

  const parsed = listUsersInput.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError("Invalid list parameters.", fieldErrorsOf(parsed.error));
  }
  const input = parsed.data;

  // Row-level narrowing: a unit-scoped administrator sees their subtree only.
  const filter = await scopeFilter(actor, IAM_PERMISSIONS.USER_READ);
  const scoped = scopeWhere(filter, { orgUnitPath: ["orgUnit", "path"], owner: ["id"] });

  const where = {
    deletedAt: null,
    ...statusFilter(input.status ?? (input.includeInactive ? "all" : "active")),
    ...(input.roleId !== undefined ? { roles: { some: { roleId: input.roleId } } } : {}),
    ...(input.orgUnitId !== undefined ? { orgUnitId: input.orgUnitId } : {}),
    ...scoped,
    ...(input.search !== undefined && input.search !== ""
      ? {
          OR: [
            { email: { contains: input.search, mode: "insensitive" as const } },
            { fullName: { contains: input.search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  // Always paginated, always counted in the database (CLAUDE.md §21).
  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { [input.sort]: input.direction },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      select: {
        id: true,
        email: true,
        fullName: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        locale: true,
        orgUnitId: true,
        orgUnit: { select: { name: true } },
        roles: {
          select: { roleId: true, scopeType: true, role: { select: { key: true } } },
        },
      },
    }),
  ]);

  return {
    rows: users.map((user) => ({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      isActive: user.isActive,
      orgUnitName: user.orgUnit?.name ?? null,
      roleKeys: user.roles.map((assignment) => assignment.role.key),
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      locale: user.locale,
      orgUnitId: user.orgUnitId,
      globalRoleIds: user.roles
        .filter((assignment) => assignment.scopeType === "GLOBAL")
        .map((assignment) => assignment.roleId),
    })),
    total,
    page: input.page,
    pageSize: input.pageSize,
  };
}

export const setUserActiveInput = z.object({
  userId: z.string().uuid(),
  isActive: z.boolean(),
  reason: z.string().trim().min(3).max(500),
});

export type SetUserActiveInput = z.input<typeof setUserActiveInput>;

/**
 * Activates or deactivates an account.
 *
 * Deactivation takes effect immediately: `getCurrentUser` re-checks `isActive` on
 * every request, so there is no window in which a disabled account still works
 * (CLAUDE.md §11.1).
 */
export async function setUserActive(
  actor: Actor,
  rawInput: SetUserActiveInput,
): Promise<UserSummary> {
  const parsed = setUserActiveInput.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError("Invalid request.", fieldErrorsOf(parsed.error));
  }
  const input = parsed.data;

  const existing = await prisma.user.findFirst({
    where: { id: input.userId, deletedAt: null },
    select: {
      id: true,
      email: true,
      fullName: true,
      isActive: true,
      orgUnitId: true,
      createdAt: true,
      lastLoginAt: true,
      orgUnit: { select: { name: true, path: true } },
    },
  });
  if (existing === null) throw new NotFoundError("user");

  // Scope target: a unit-scoped administrator may only act within their subtree.
  await requirePermission(actor, IAM_PERMISSIONS.USER_UPDATE, {
    orgUnitId: existing.orgUnitId,
    orgUnitPath: existing.orgUnit?.path ?? null,
    ownerId: existing.id,
  });

  const summary = await prisma.$transaction(async (tx) => {
    if (!input.isActive) {
      // Serialised with every change that could remove administration, so the last
      // active platform administrator cannot be deactivated (ADR-019).
      await lockAdministration(tx);
      await assertAdministrationRemains(tx, input.userId);
    }

    const updated = await tx.user.update({
      where: { id: input.userId },
      data: { isActive: input.isActive, updatedBy: actor.id },
      select: {
        id: true,
        email: true,
        fullName: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        orgUnit: { select: { name: true } },
        roles: { select: { role: { select: { key: true } } } },
      },
    });

    await recordAudit(
      {
        actorId: actor.id,
        action: input.isActive ? "iam.user.activated" : "iam.user.deactivated",
        module: "iam",
        entityType: "User",
        entityId: updated.id,
        summary: `${input.isActive ? "Activated" : "Deactivated"} ${updated.email}: ${input.reason}`,
        changes: diffForAudit(
          { isActive: existing.isActive },
          { isActive: updated.isActive },
        ),
        severity: "NOTICE",
        ipAddress: actor.ipAddress ?? null,
        userAgent: actor.userAgent ?? null,
        correlationId: actor.correlationId ?? null,
      },
      tx,
    );

    await publish(tx, {
      name: input.isActive ? "iam.UserActivated" : "iam.UserDeactivated",
      actorId: actor.id,
      correlationId: actor.correlationId ?? null,
      // Entity ID and the minimum a subscriber needs — never sensitive data.
      payload: { userId: updated.id },
    });

    return {
      id: updated.id,
      email: updated.email,
      fullName: updated.fullName,
      isActive: updated.isActive,
      orgUnitName: updated.orgUnit?.name ?? null,
      roleKeys: updated.roles.map((assignment) => assignment.role.key),
      lastLoginAt: updated.lastLoginAt,
      createdAt: updated.createdAt,
    };
  });

  // IAM refuses an inactive account on its next request; the ban also stops the
  // sign-in service from issuing or refreshing its sessions.
  if (existing.isActive !== input.isActive) {
    await syncSignInBan(actor, summary.id, !input.isActive);
  }
  return summary;
}

export const assignRoleInput = z.object({
  userId: z.string().uuid(),
  roleId: z.string().uuid(),
  scopeType: z.enum(["GLOBAL", "ORG_UNIT", "OWN_ORG_UNIT", "OWN"]).default("GLOBAL"),
  scopeOrgUnitId: z.string().uuid().nullable().default(null),
});

export type AssignRoleInput = z.input<typeof assignRoleInput>;

/**
 * Grants a role to a user.
 *
 * Requires `iam.user.administer`, the most powerful permission in the platform:
 * it confers control over what everyone else can do. Audited at CRITICAL.
 */
export async function assignRole(actor: Actor, rawInput: AssignRoleInput): Promise<void> {
  await requirePermission(actor, IAM_PERMISSIONS.USER_ADMINISTER);

  const parsed = assignRoleInput.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError("Invalid request.", fieldErrorsOf(parsed.error));
  }
  const input = parsed.data;

  if (input.scopeType === "ORG_UNIT" && input.scopeOrgUnitId === null) {
    throw new ValidationError("A unit-scoped role must name the organisational unit.", {
      scopeOrgUnitId: ["Select an organisational unit."],
    });
  }

  const [user, role] = await Promise.all([
    prisma.user.findFirst({
      where: { id: input.userId, deletedAt: null },
      select: { id: true, email: true },
    }),
    prisma.role.findFirst({
      where: { id: input.roleId, deletedAt: null, isActive: true },
      select: { id: true, key: true },
    }),
  ]);
  if (user === null) throw new NotFoundError("user");
  if (role === null) throw new NotFoundError("role");

  await prisma.$transaction(async (tx) => {
    await tx.userRole.create({
      data: {
        userId: input.userId,
        roleId: input.roleId,
        scopeType: input.scopeType,
        scopeOrgUnitId: input.scopeOrgUnitId,
        grantedBy: actor.id,
      },
    });

    await recordAudit(
      {
        actorId: actor.id,
        action: "iam.role.assigned",
        module: "iam",
        entityType: "User",
        entityId: user.id,
        summary: `Granted role "${role.key}" to ${user.email} (${input.scopeType})`,
        changes: {
          roleKey: role.key,
          scopeType: input.scopeType,
          scopeOrgUnitId: input.scopeOrgUnitId,
        },
        // An access change is always at least NOTICE; granting roles is CRITICAL
        // because it changes the security posture of the platform.
        severity: "CRITICAL",
        ipAddress: actor.ipAddress ?? null,
        userAgent: actor.userAgent ?? null,
        correlationId: actor.correlationId ?? null,
      },
      tx,
    );

    await publish(tx, {
      name: "iam.RoleAssigned",
      actorId: actor.id,
      correlationId: actor.correlationId ?? null,
      payload: { userId: user.id, roleId: role.id, roleKey: role.key },
    });
  });
}

function statusFilter(status: "all" | "active" | "inactive") {
  return status === "all" ? {} : { isActive: status === "active" };
}

/** Flattens Zod issues into the field-level shape forms render. */
function fieldErrorsOf(error: z.ZodError): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    (fields[key] ??= []).push(issue.message);
  }
  return fields;
}
