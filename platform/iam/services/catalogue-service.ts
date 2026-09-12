import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { type Actor, requirePermission } from "@/platform/authz/authz";
import { IAM_PERMISSIONS, PLATFORM_PERMISSIONS } from "@/platform/iam/permissions";

/**
 * Read services for roles, the permission catalogue and the audit trail.
 *
 * Read operations are permission-checked exactly like writes. "It's only a read"
 * is how sensitive data leaks (CLAUDE.md §9, §11.4).
 */

export type RoleSummary = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
  permissionCount: number;
  userCount: number;
};

export async function listRoles(actor: Actor): Promise<RoleSummary[]> {
  await requirePermission(actor, IAM_PERMISSIONS.ROLE_READ);

  const roles = await prisma.role.findMany({
    where: { deletedAt: null },
    orderBy: [{ isSystem: "desc" }, { key: "asc" }],
    // Bounded even though the row count is small: an unbounded query is a habit
    // that eventually meets a large table.
    take: 200,
    select: {
      id: true,
      key: true,
      name: true,
      description: true,
      isSystem: true,
      isActive: true,
      _count: { select: { permissions: true, users: true } },
    },
  });

  return roles.map((role) => ({
    id: role.id,
    key: role.key,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    isActive: role.isActive,
    permissionCount: role._count.permissions,
    userCount: role._count.users,
  }));
}

export type PermissionSummary = {
  id: string;
  key: string;
  module: string;
  resource: string;
  action: string;
  description: string;
  isSensitive: boolean;
  roleCount: number;
};

export async function listPermissions(actor: Actor): Promise<PermissionSummary[]> {
  await requirePermission(actor, IAM_PERMISSIONS.PERMISSION_READ);

  const permissions = await prisma.permission.findMany({
    orderBy: [{ module: "asc" }, { resource: "asc" }, { action: "asc" }],
    take: 1000,
    select: {
      id: true,
      key: true,
      module: true,
      resource: true,
      action: true,
      description: true,
      isSensitive: true,
      _count: { select: { roles: true } },
    },
  });

  return permissions.map((permission) => ({
    id: permission.id,
    key: permission.key,
    module: permission.module,
    resource: permission.resource,
    action: permission.action,
    description: permission.description,
    isSensitive: permission.isSensitive,
    roleCount: permission._count.roles,
  }));
}

export const listAuditInput = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(50),
  module: z.string().trim().max(50).optional(),
  action: z.string().trim().max(100).optional(),
  actorId: z.string().uuid().optional(),
  entityId: z.string().trim().max(100).optional(),
});

export type ListAuditInput = z.input<typeof listAuditInput>;

export type AuditRecord = {
  id: string;
  occurredAt: Date;
  severity: string;
  actorLabel: string;
  action: string;
  module: string;
  entityType: string;
  entityId: string | null;
  summary: string;
};

export async function listAuditRecords(
  actor: Actor,
  rawInput: ListAuditInput = {},
): Promise<{ rows: AuditRecord[]; total: number; page: number; pageSize: number }> {
  // Reading the audit trail is itself sensitive: it reveals who did what, when.
  await requirePermission(actor, PLATFORM_PERMISSIONS.AUDIT_READ);

  const parsed = listAuditInput.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError("Invalid filter.", {});
  }
  const input = parsed.data;

  const where = {
    ...(input.module !== undefined && input.module !== ""
      ? { module: input.module }
      : {}),
    ...(input.action !== undefined && input.action !== ""
      ? { action: { contains: input.action } }
      : {}),
    ...(input.actorId !== undefined ? { actorId: input.actorId } : {}),
    ...(input.entityId !== undefined && input.entityId !== ""
      ? { entityId: input.entityId }
      : {}),
  };

  const [total, records] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { occurredAt: "desc" },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      select: {
        id: true,
        occurredAt: true,
        severity: true,
        actorId: true,
        actorLabel: true,
        action: true,
        module: true,
        entityType: true,
        entityId: true,
        summary: true,
      },
    }),
  ]);

  return {
    rows: records.map((record) => ({
      id: record.id,
      occurredAt: record.occurredAt,
      severity: record.severity,
      actorLabel: record.actorLabel ?? record.actorId ?? "system",
      action: record.action,
      module: record.module,
      entityType: record.entityType,
      entityId: record.entityId,
      summary: record.summary,
    })),
    total,
    page: input.page,
    pageSize: input.pageSize,
  };
}

export type OrgUnitNode = {
  id: string;
  key: string;
  name: string;
  path: string;
  depth: number;
  isActive: boolean;
  userCount: number;
};

export async function listOrgUnits(actor: Actor): Promise<OrgUnitNode[]> {
  await requirePermission(actor, IAM_PERMISSIONS.ORG_UNIT_READ);

  const units = await prisma.organizationalUnit.findMany({
    where: { deletedAt: null },
    // Ordering by path yields a correct depth-first tree order for free.
    orderBy: { path: "asc" },
    take: 1000,
    select: {
      id: true,
      key: true,
      name: true,
      path: true,
      depth: true,
      isActive: true,
      _count: { select: { users: true } },
    },
  });

  return units.map((unit) => ({
    id: unit.id,
    key: unit.key,
    name: unit.name,
    path: unit.path,
    depth: unit.depth,
    isActive: unit.isActive,
    userCount: unit._count.users,
  }));
}
