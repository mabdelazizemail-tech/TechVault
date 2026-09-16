import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { diffForAudit, recordAudit } from "@/platform/audit/audit";
import {
  createAccount,
  deleteAccount,
  isAccountAdminConfigured,
  sendPasswordReset,
  setAccountBanned,
  updateAccountEmail,
} from "@/platform/auth/identity-admin";
import { type Actor, can, canAll, requirePermission } from "@/platform/authz/authz";
import type { ScopeTarget } from "@/platform/authz/types";
import { publish } from "@/platform/events/publish";
import { getPermissionSet } from "@/platform/iam/permission-loader";
import {
  IAM_PERMISSIONS,
  PLATFORM_PERMISSIONS,
  SYSTEM_ROLES,
} from "@/platform/iam/permissions";
import {
  assertAdministrationRemains,
  lockAdministration,
} from "@/platform/iam/services/admin-guard";
import { logger } from "@/platform/observability/logger";

/**
 * Full user administration (CLAUDE.md §11, §19.2; ADR-019).
 *
 * Same shape as every IAM operation: permission first, then validation, then one
 * transaction holding the change, its audit record and its outbox event. Sign-in
 * accounts live in Supabase Auth, outside that transaction, so each operation
 * orders the two sides to fail safe and compensates when the second side fails.
 *
 * Permissions: read → view; create → add; update → profile, unit and status;
 * administer → roles, email address and password reset; delete → delete.
 * Granting or removing a role additionally requires holding every permission the
 * role confers, so nobody can hand out more authority than they have.
 */

const uuid = z.string().uuid();
const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .email("Enter a valid email address.");
const nameField = z.string().trim().min(1, "Enter the person's full name.").max(200);

function parse<TSchema extends z.ZodType>(
  schema: TSchema,
  input: unknown,
): z.output<TSchema> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const fields: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.map(String).join(".") || "_";
      (fields[key] ??= []).push(issue.message);
    }
    throw new ValidationError("Please correct the highlighted fields.", fields);
  }
  return parsed.data;
}

function auditContext(actor: Actor) {
  return {
    actorId: actor.id,
    ipAddress: actor.ipAddress ?? null,
    userAgent: actor.userAgent ?? null,
    correlationId: actor.correlationId ?? null,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const targetUserSelect = {
  id: true,
  email: true,
  fullName: true,
  locale: true,
  isActive: true,
  orgUnitId: true,
  orgUnit: { select: { name: true, path: true } },
} satisfies Prisma.UserSelect;

type TargetUser = Prisma.UserGetPayload<{ select: typeof targetUserSelect }>;

function targetOf(user: {
  id: string;
  orgUnitId: string | null;
  orgUnit: { path: string } | null;
}): ScopeTarget {
  return {
    orgUnitId: user.orgUnitId,
    orgUnitPath: user.orgUnit?.path ?? null,
    ownerId: user.id,
  };
}

async function findLiveUser(userId: string): Promise<TargetUser> {
  if (!uuid.safeParse(userId).success) throw new NotFoundError("user");
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: targetUserSelect,
  });
  if (user === null) throw new NotFoundError("user");
  return user;
}

/**
 * Record-level authorisation. A user outside the administrator's scope is
 * reported as not found, so the response does not confirm they exist (§11.6).
 */
async function authorizeOn(actor: Actor, permission: string, user: TargetUser) {
  if (!(await can(actor, IAM_PERMISSIONS.USER_READ, targetOf(user)))) {
    throw new NotFoundError("user");
  }
  await requirePermission(actor, permission, targetOf(user));
}

async function findUnit(orgUnitId: string | null) {
  if (orgUnitId === null) return null;
  const unit = await prisma.organizationalUnit.findFirst({
    where: { id: orgUnitId, deletedAt: null, isActive: true },
    select: { id: true, name: true, path: true },
  });
  if (unit === null) {
    throw new ValidationError("Choose an organisation unit that exists.", {
      orgUnitId: ["This organisation unit does not exist or is inactive."],
    });
  }
  return unit;
}

const roleSelect = {
  id: true,
  key: true,
  name: true,
  permissions: { select: { permission: { select: { key: true } } } },
} satisfies Prisma.RoleSelect;

type RoleWithPermissions = Prisma.RoleGetPayload<{ select: typeof roleSelect }>;

async function findRoles(roleIds: readonly string[]): Promise<RoleWithPermissions[]> {
  const unique = [...new Set(roleIds)];
  if (unique.length === 0) return [];
  const roles = await prisma.role.findMany({
    where: { id: { in: unique }, deletedAt: null, isActive: true },
    select: roleSelect,
  });
  if (roles.length !== unique.length) {
    throw new ValidationError("Choose roles that exist.", {
      roleIds: ["One or more selected roles do not exist or are inactive."],
    });
  }
  return roles;
}

/** Nobody may grant or remove a role conferring a permission they do not hold. */
async function assertMayManageRoles(
  actor: Actor,
  roles: readonly RoleWithPermissions[],
): Promise<void> {
  if (roles.length === 0) return;
  const keys = [
    ...new Set(
      roles.flatMap((role) => role.permissions.map((link) => link.permission.key)),
    ),
  ];
  const held = await canAll(actor, keys);
  const blocked = roles.find((role) =>
    role.permissions.some((link) => held[link.permission.key] !== true),
  );
  if (blocked !== undefined) {
    throw new ForbiddenError(
      `You cannot grant or remove the "${blocked.name}" role because it includes ` +
        "permissions you do not hold.",
    );
  }
}

/**
 * Blocks or restores the sign-in account. Best effort by design: IAM already
 * refuses an inactive or deleted account on every request, so a provider failure
 * is logged rather than undoing the administrator's decision.
 */
export async function syncSignInBan(
  actor: Actor,
  userId: string,
  banned: boolean,
): Promise<void> {
  if (!isAccountAdminConfigured()) return;
  try {
    await setAccountBanned(userId, banned);
  } catch (error) {
    logger.warn("Could not update the sign-in ban; IAM still enforces the status", {
      module: "iam",
      operation: "iam.user.syncSignInBan",
      actorId: actor.id,
      targetUserId: userId,
      errorMessage: messageOf(error),
    });
  }
}

/* Filter options ---------------------------------------------------------- */

export type UserAdminOptions = {
  roles: {
    id: string;
    key: string;
    name: string;
    /**
     * The `<module>.module.access` permissions this role grants. The Users screen
     * turns them into the list of sections the role reveals, so an administrator
     * can see what a checkbox does before ticking it (ADR-030). Kept as plain
     * keys because platform services may not import domain modules.
     */
    accessKeys: string[];
  }[];
  units: { id: string; name: string; depth: number }[];
};

/** Permissions shaped `<module>.module.access` gate a navigation section. */
const MODULE_ACCESS_SUFFIX = ".module.access";

/** The roles and units the list filters and forms offer. Small, bounded lists. */
export async function listUserAdminOptions(actor: Actor): Promise<UserAdminOptions> {
  await requirePermission(actor, IAM_PERMISSIONS.USER_READ);

  const [roles, units] = await Promise.all([
    prisma.role.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
      take: 200,
      select: {
        id: true,
        key: true,
        name: true,
        permissions: {
          where: { permission: { key: { endsWith: MODULE_ACCESS_SUFFIX } } },
          select: { permission: { select: { key: true } } },
        },
      },
    }),
    prisma.organizationalUnit.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: { path: "asc" },
      take: 1000,
      select: { id: true, name: true, depth: true },
    }),
  ]);

  return {
    roles: roles.map((role) => ({
      id: role.id,
      key: role.key,
      name: role.name,
      accessKeys: role.permissions.map((link) => link.permission.key),
    })),
    units,
  };
}

/* Create ------------------------------------------------------------------ */

export const createUserInput = z.object({
  email: emailField,
  fullName: nameField,
  roleIds: z.array(uuid).max(20).default([]),
  orgUnitId: uuid.nullable().default(null),
  isActive: z.boolean().default(true),
  setup: z.discriminatedUnion("method", [
    z.object({ method: z.literal("invite") }),
    z.object({
      method: z.literal("password"),
      password: z
        .string()
        .min(12, "Use at least 12 characters.")
        .max(72, "Use at most 72 characters."),
    }),
  ]),
});

export type CreatedUser = { id: string; email: string; method: "invite" | "password" };

export async function createUser(actor: Actor, rawInput: unknown): Promise<CreatedUser> {
  await requirePermission(actor, IAM_PERMISSIONS.USER_CREATE);
  const input = parse(createUserInput, rawInput);
  if (input.roleIds.length > 0) {
    await requirePermission(actor, IAM_PERMISSIONS.USER_ADMINISTER);
  }

  const [unit, roles, existing] = await Promise.all([
    findUnit(input.orgUnitId),
    findRoles(input.roleIds),
    prisma.user.findUnique({
      where: { email: input.email },
      select: { deletedAt: true },
    }),
  ]);

  if (unit !== null) {
    await requirePermission(actor, IAM_PERMISSIONS.USER_CREATE, {
      orgUnitId: unit.id,
      orgUnitPath: unit.path,
    });
  }
  if (existing !== null) {
    throw new ConflictError(
      existing.deletedAt === null
        ? "A user with this email address already exists."
        : "A deleted user had this email address. Deleted accounts keep their history, " +
            "so the address cannot be reused.",
    );
  }
  await assertMayManageRoles(actor, roles);

  // The sign-in account first: its id becomes the IAM user id (iam.users.id =
  // auth.users.id). If recording the user then fails, the account is removed
  // again, so no identity exists that TechVault does not know about.
  const account = await createAccount({
    email: input.email,
    fullName: input.fullName,
    method: input.setup.method,
    password: input.setup.method === "password" ? input.setup.password : undefined,
  });

  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.create({
        data: {
          id: account.id,
          email: input.email,
          fullName: input.fullName,
          orgUnitId: unit?.id ?? null,
          isActive: input.isActive,
          createdBy: actor.id,
          updatedBy: actor.id,
        },
      });

      if (roles.length > 0) {
        await tx.userRole.createMany({
          data: roles.map((role) => ({
            userId: account.id,
            roleId: role.id,
            scopeType: "GLOBAL" as const,
            grantedBy: actor.id,
          })),
        });
      }

      await recordAudit(
        {
          ...auditContext(actor),
          action: "iam.user.created",
          module: "iam",
          entityType: "User",
          entityId: account.id,
          summary:
            `Created ${input.email}` +
            (roles.length > 0 ? ` with ${roles.map((role) => role.key).join(", ")}` : ""),
          // Never the password: only how the account was set up.
          changes: {
            email: input.email,
            fullName: input.fullName,
            orgUnit: unit?.name ?? null,
            isActive: input.isActive,
            roles: roles.map((role) => role.key),
            setupMethod: input.setup.method,
          },
          severity: roles.length > 0 ? "CRITICAL" : "NOTICE",
        },
        tx,
      );

      await publish(tx, {
        name: "iam.UserCreated",
        actorId: actor.id,
        correlationId: actor.correlationId ?? null,
        payload: { userId: account.id },
      });
      for (const role of roles) {
        await publish(tx, {
          name: "iam.RoleAssigned",
          actorId: actor.id,
          correlationId: actor.correlationId ?? null,
          payload: { userId: account.id, roleId: role.id, roleKey: role.key },
        });
      }
    });
  } catch (error) {
    await deleteAccount(account.id).catch((cleanupError: unknown) => {
      logger.error("Could not remove a sign-in account after its user record failed", {
        module: "iam",
        operation: "iam.user.create.compensate",
        actorId: actor.id,
        errorMessage: messageOf(cleanupError),
      });
    });
    if (isUniqueViolation(error)) {
      throw new ConflictError("A user with this email address already exists.");
    }
    throw error;
  }

  if (!input.isActive) await syncSignInBan(actor, account.id, true);
  return { id: account.id, email: input.email, method: input.setup.method };
}

/* Update ------------------------------------------------------------------ */

export const updateUserInput = z.object({
  fullName: nameField.optional(),
  email: emailField.optional(),
  locale: z.enum(["en", "ar"]).optional(),
  orgUnitId: uuid.nullable().optional(),
});

/** Changes only the fields provided. Status and roles have their own operations. */
export async function updateUser(
  actor: Actor,
  userId: string,
  rawInput: unknown,
): Promise<void> {
  await requirePermission(actor, IAM_PERMISSIONS.USER_UPDATE);
  const input = parse(updateUserInput, rawInput);
  const user = await findLiveUser(userId);
  await authorizeOn(actor, IAM_PERMISSIONS.USER_UPDATE, user);

  const newEmail = input.email;
  const emailChanged = newEmail !== undefined && newEmail !== user.email;
  const newUnitId = input.orgUnitId;
  const unitChanged = newUnitId !== undefined && newUnitId !== user.orgUnitId;
  const profile = {
    fullName: input.fullName ?? user.fullName,
    locale: input.locale ?? user.locale,
  };
  const profileChanged =
    profile.fullName !== user.fullName || profile.locale !== user.locale;

  if (!emailChanged && !unitChanged && !profileChanged) return;

  const newUnit = unitChanged ? await findUnit(newUnitId) : null;
  if (newUnit !== null) {
    await requirePermission(actor, IAM_PERMISSIONS.USER_UPDATE, {
      orgUnitId: newUnit.id,
      orgUnitPath: newUnit.path,
    });
  }

  if (emailChanged) {
    // The sign-in address decides who controls the account, so changing it is
    // an administer-level act, like a password reset.
    await requirePermission(actor, IAM_PERMISSIONS.USER_ADMINISTER, targetOf(user));
    const taken = await prisma.user.findUnique({
      where: { email: newEmail },
      select: { id: true },
    });
    if (taken !== null)
      throw new ConflictError("Another user already has this email address.");
    await updateAccountEmail(user.id, newEmail);
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          ...(profileChanged ? profile : {}),
          ...(emailChanged ? { email: newEmail } : {}),
          ...(unitChanged ? { orgUnitId: newUnit?.id ?? null } : {}),
          updatedBy: actor.id,
        },
      });

      if (profileChanged || emailChanged) {
        await recordAudit(
          {
            ...auditContext(actor),
            action: "iam.user.updated",
            module: "iam",
            entityType: "User",
            entityId: user.id,
            summary: `Updated ${emailChanged ? newEmail : user.email}`,
            changes: diffForAudit(
              { fullName: user.fullName, locale: user.locale, email: user.email },
              {
                fullName: profile.fullName,
                locale: profile.locale,
                email: emailChanged ? newEmail : user.email,
              },
            ),
            severity: emailChanged ? "CRITICAL" : "INFO",
          },
          tx,
        );
        await publish(tx, {
          name: "iam.UserUpdated",
          actorId: actor.id,
          correlationId: actor.correlationId ?? null,
          payload: { userId: user.id },
        });
      }

      if (unitChanged) {
        await recordAudit(
          {
            ...auditContext(actor),
            action: "iam.user.org_unit_changed",
            module: "iam",
            entityType: "User",
            entityId: user.id,
            summary:
              `Moved ${user.email} from ${user.orgUnit?.name ?? "no unit"} ` +
              `to ${newUnit?.name ?? "no unit"}`,
            changes: {
              orgUnit: {
                before: user.orgUnit?.name ?? null,
                after: newUnit?.name ?? null,
              },
              orgUnitId: { before: user.orgUnitId, after: newUnit?.id ?? null },
            },
            severity: "NOTICE",
          },
          tx,
        );
        await publish(tx, {
          name: "iam.UserTransferred",
          actorId: actor.id,
          correlationId: actor.correlationId ?? null,
          payload: { userId: user.id, orgUnitId: newUnit?.id ?? null },
        });
      }
    });
  } catch (error) {
    if (emailChanged) {
      await updateAccountEmail(user.id, user.email).catch((revertError: unknown) => {
        logger.error("Could not restore a sign-in email after the user update failed", {
          module: "iam",
          operation: "iam.user.update.compensate",
          actorId: actor.id,
          targetUserId: user.id,
          errorMessage: messageOf(revertError),
        });
      });
    }
    if (isUniqueViolation(error)) {
      throw new ConflictError("Another user already has this email address.");
    }
    throw error;
  }
}

/* Roles ------------------------------------------------------------------- */

export const setUserRolesInput = z.object({ roleIds: z.array(uuid).max(20) });

export type RoleChange = { added: string[]; removed: string[] };

/**
 * Makes the user's unscoped role assignments exactly `roleIds`. Scoped
 * assignments (a role limited to an organisation unit) are left untouched.
 * Permissions follow on the user's next request: the permission set is loaded
 * per request and never cached longer (§11.9).
 */
export async function setUserRoles(
  actor: Actor,
  userId: string,
  rawInput: unknown,
): Promise<RoleChange> {
  await requirePermission(actor, IAM_PERMISSIONS.USER_ADMINISTER);
  const input = parse(setUserRolesInput, rawInput);
  const user = await findLiveUser(userId);
  await authorizeOn(actor, IAM_PERMISSIONS.USER_ADMINISTER, user);

  const [desired, current] = await Promise.all([
    findRoles(input.roleIds),
    prisma.userRole.findMany({
      where: { userId: user.id, scopeType: "GLOBAL" },
      select: { id: true, roleId: true, role: { select: roleSelect } },
    }),
  ]);

  const desiredIds = new Set(desired.map((role) => role.id));
  const currentIds = new Set(current.map((assignment) => assignment.roleId));
  const toAdd = desired.filter((role) => !currentIds.has(role.id));
  const toRemove = current.filter((assignment) => !desiredIds.has(assignment.roleId));
  if (toAdd.length === 0 && toRemove.length === 0) return { added: [], removed: [] };

  await assertMayManageRoles(actor, [
    ...toAdd,
    ...toRemove.map((assignment) => assignment.role),
  ]);
  const removesAdministration = toRemove.some(
    (assignment) => assignment.role.key === SYSTEM_ROLES.PLATFORM_ADMIN,
  );

  const before = current.map((assignment) => assignment.role.key).sort();
  const after = desired.map((role) => role.key).sort();

  await prisma.$transaction(async (tx) => {
    if (removesAdministration) {
      await lockAdministration(tx);
      await assertAdministrationRemains(tx, user.id);
    }

    if (toRemove.length > 0) {
      await tx.userRole.deleteMany({
        where: { id: { in: toRemove.map((assignment) => assignment.id) } },
      });
    }
    if (toAdd.length > 0) {
      await tx.userRole.createMany({
        data: toAdd.map((role) => ({
          userId: user.id,
          roleId: role.id,
          scopeType: "GLOBAL" as const,
          grantedBy: actor.id,
        })),
      });
    }

    await recordAudit(
      {
        ...auditContext(actor),
        action: "iam.user.roles_changed",
        module: "iam",
        entityType: "User",
        entityId: user.id,
        summary: `Changed roles of ${user.email}: ${before.join(", ") || "none"} → ${after.join(", ") || "none"}`,
        changes: {
          roles: { before, after },
          added: toAdd.map((role) => role.key),
          removed: toRemove.map((assignment) => assignment.role.key),
        },
        severity: "CRITICAL",
      },
      tx,
    );

    for (const role of toAdd) {
      await publish(tx, {
        name: "iam.RoleAssigned",
        actorId: actor.id,
        correlationId: actor.correlationId ?? null,
        payload: { userId: user.id, roleId: role.id, roleKey: role.key },
      });
    }
    for (const assignment of toRemove) {
      await publish(tx, {
        name: "iam.RoleRevoked",
        actorId: actor.id,
        correlationId: actor.correlationId ?? null,
        payload: {
          userId: user.id,
          roleId: assignment.roleId,
          roleKey: assignment.role.key,
        },
      });
    }
  });

  return {
    added: toAdd.map((role) => role.key),
    removed: toRemove.map((assignment) => assignment.role.key),
  };
}

/* Password reset ---------------------------------------------------------- */

/** Emails the account holder a link to choose a new password. No password is set or seen. */
export async function requestPasswordReset(
  actor: Actor,
  userId: string,
): Promise<{ email: string }> {
  await requirePermission(actor, IAM_PERMISSIONS.USER_ADMINISTER);
  const user = await findLiveUser(userId);
  await authorizeOn(actor, IAM_PERMISSIONS.USER_ADMINISTER, user);

  if (!user.isActive) {
    throw new BusinessRuleError(
      "This account is inactive. Activate it before sending a password reset.",
    );
  }

  await sendPasswordReset(user.email);

  await recordAudit({
    ...auditContext(actor),
    action: "iam.user.password_reset_requested",
    module: "iam",
    entityType: "User",
    entityId: user.id,
    summary: `Sent a password reset email to ${user.email}`,
    severity: "NOTICE",
  });

  return { email: user.email };
}

/* Delete ------------------------------------------------------------------ */

export const deleteUserInput = z.object({
  confirmEmail: z.string().trim().toLowerCase().max(254),
});

export type DeletedUser = { email: string; signInRemoved: boolean };

/**
 * Deletes a user safely: a soft delete (ADR-019).
 *
 * The IAM row is kept, marked deleted and inactive, so audit records, sign-in
 * history and the CRM records the person owned keep their attribution. Their
 * role assignments, direct grants and group memberships are removed, their API
 * tokens and delegations revoked, and their Supabase sign-in account deleted.
 */
export async function deleteUser(
  actor: Actor,
  userId: string,
  rawInput: unknown,
): Promise<DeletedUser> {
  await requirePermission(actor, IAM_PERMISSIONS.USER_DELETE);
  const input = parse(deleteUserInput, rawInput);
  const user = await findLiveUser(userId);
  await authorizeOn(actor, IAM_PERMISSIONS.USER_DELETE, user);

  if (input.confirmEmail !== user.email.toLowerCase()) {
    throw new ValidationError("Type the user's email address to confirm.", {
      confirmEmail: ["This does not match the user's email address."],
    });
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await lockAdministration(tx);
    await assertAdministrationRemains(tx, user.id);

    const assignments = await tx.userRole.findMany({
      where: { userId: user.id },
      select: { role: { select: { key: true } } },
    });

    await tx.userRole.deleteMany({ where: { userId: user.id } });
    await tx.userPermissionGrant.deleteMany({ where: { userId: user.id } });
    await tx.groupMember.deleteMany({ where: { userId: user.id } });
    await tx.delegationGrant.updateMany({
      where: { revokedAt: null, OR: [{ fromUserId: user.id }, { toUserId: user.id }] },
      data: { revokedAt: now },
    });
    await tx.apiToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: now, revokedBy: actor.id },
    });
    await tx.user.update({
      where: { id: user.id },
      data: { isActive: false, deletedAt: now, updatedBy: actor.id },
    });

    await recordAudit(
      {
        ...auditContext(actor),
        action: "iam.user.deleted",
        module: "iam",
        entityType: "User",
        entityId: user.id,
        summary: `Deleted ${user.email}`,
        changes: {
          email: user.email,
          fullName: user.fullName,
          orgUnit: user.orgUnit?.name ?? null,
          wasActive: user.isActive,
          rolesRemoved: assignments.map((assignment) => assignment.role.key),
          softDeleted: true,
        },
        severity: "CRITICAL",
      },
      tx,
    );

    await publish(tx, {
      name: "iam.UserDeleted",
      actorId: actor.id,
      correlationId: actor.correlationId ?? null,
      payload: { userId: user.id },
    });
  });

  let signInRemoved = false;
  if (isAccountAdminConfigured()) {
    try {
      await deleteAccount(user.id);
      signInRemoved = true;
    } catch (error) {
      // The IAM row is already deleted, which refuses access on every request;
      // the leftover sign-in account can be removed in the Supabase dashboard.
      logger.error("User deleted in IAM but the sign-in account could not be removed", {
        module: "iam",
        operation: "iam.user.delete.signIn",
        actorId: actor.id,
        targetUserId: user.id,
        errorMessage: messageOf(error),
      });
    }
  }

  return { email: user.email, signInRemoved };
}

/* Details ----------------------------------------------------------------- */

export type UserDetail = {
  id: string;
  email: string;
  fullName: string | null;
  locale: string;
  isActive: boolean;
  orgUnit: { id: string; name: string; path: string } | null;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
  createdBy: string | null;
  updatedBy: string | null;
  roles: {
    assignmentId: string;
    roleId: string;
    key: string;
    name: string;
    scopeType: "GLOBAL" | "ORG_UNIT" | "OWN_ORG_UNIT" | "OWN";
    scopeLabel: string;
    startsAt: Date | null;
    endsAt: Date | null;
  }[];
  permissions: { key: string; sources: string[] }[];
  deniedPermissions: string[];
  /** Null when the viewer may not read the audit trail. */
  recentActivity:
    | { id: string; occurredAt: Date; action: string; summary: string; actor: string }[]
    | null;
  /** Null when the viewer may not read sign-in history. */
  recentSignIns:
    { occurredAt: Date; success: boolean; ipAddress: string | null }[] | null;
};

const SCOPE_LABELS = {
  GLOBAL: "Everywhere",
  OWN_ORG_UNIT: "Own unit",
  OWN: "Own records",
} as const;

export async function getUserDetail(actor: Actor, userId: string): Promise<UserDetail> {
  await requirePermission(actor, IAM_PERMISSIONS.USER_READ);
  if (!uuid.safeParse(userId).success) throw new NotFoundError("user");

  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: {
      id: true,
      email: true,
      fullName: true,
      locale: true,
      isActive: true,
      orgUnitId: true,
      createdAt: true,
      updatedAt: true,
      lastLoginAt: true,
      createdBy: true,
      updatedBy: true,
      orgUnit: { select: { id: true, name: true, path: true } },
      roles: {
        orderBy: { grantedAt: "asc" },
        select: {
          id: true,
          scopeType: true,
          startsAt: true,
          endsAt: true,
          scopeOrgUnit: { select: { name: true } },
          role: { select: { id: true, key: true, name: true } },
        },
      },
    },
  });
  if (user === null) throw new NotFoundError("user");
  if (!(await can(actor, IAM_PERMISSIONS.USER_READ, targetOf(user)))) {
    throw new NotFoundError("user");
  }

  const rights = await canAll(actor, [
    PLATFORM_PERMISSIONS.AUDIT_READ,
    IAM_PERMISSIONS.LOGIN_HISTORY_READ,
  ]);

  const [permissionSet, activity, signIns] = await Promise.all([
    getPermissionSet(user.id),
    rights[PLATFORM_PERMISSIONS.AUDIT_READ] === true
      ? prisma.auditLog.findMany({
          where: { entityType: "User", entityId: user.id },
          orderBy: { occurredAt: "desc" },
          take: 10,
          select: {
            id: true,
            occurredAt: true,
            action: true,
            summary: true,
            actorId: true,
            actorLabel: true,
          },
        })
      : Promise.resolve(null),
    rights[IAM_PERMISSIONS.LOGIN_HISTORY_READ] === true
      ? prisma.loginHistory.findMany({
          where: { userId: user.id },
          orderBy: { occurredAt: "desc" },
          take: 5,
          select: { occurredAt: true, success: true, ipAddress: true },
        })
      : Promise.resolve(null),
  ]);

  // One query for every name the page shows, not one per row.
  const personIds = [
    ...new Set(
      [
        user.createdBy,
        user.updatedBy,
        ...(activity ?? []).map((entry) => entry.actorId),
      ].filter((id): id is string => id !== null),
    ),
  ];
  const people =
    personIds.length === 0
      ? []
      : await prisma.user.findMany({
          where: { id: { in: personIds } },
          select: { id: true, fullName: true, email: true },
        });
  const names = new Map(
    people.map((person) => [person.id, person.fullName ?? person.email]),
  );
  const nameOf = (id: string | null) =>
    id === null ? null : (names.get(id) ?? "Unknown user");

  const now = new Date();
  const allowed = new Map<string, Set<string>>();
  const denied = new Set<string>();
  for (const grant of permissionSet?.grants ?? []) {
    const current =
      (grant.startsAt === null || grant.startsAt <= now) &&
      (grant.endsAt === null || grant.endsAt > now);
    if (!current) continue;
    if (grant.effect === "DENY") {
      denied.add(grant.permissionKey);
      continue;
    }
    const sources = allowed.get(grant.permissionKey) ?? new Set<string>();
    sources.add(grant.sourceLabel);
    allowed.set(grant.permissionKey, sources);
  }

  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    locale: user.locale,
    isActive: user.isActive,
    orgUnit: user.orgUnit,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt,
    createdBy: nameOf(user.createdBy),
    updatedBy: nameOf(user.updatedBy),
    roles: user.roles.map((assignment) => ({
      assignmentId: assignment.id,
      roleId: assignment.role.id,
      key: assignment.role.key,
      name: assignment.role.name,
      scopeType: assignment.scopeType,
      scopeLabel:
        assignment.scopeType === "ORG_UNIT"
          ? `Unit: ${assignment.scopeOrgUnit?.name ?? "unknown"}`
          : SCOPE_LABELS[assignment.scopeType],
      startsAt: assignment.startsAt,
      endsAt: assignment.endsAt,
    })),
    permissions: [...allowed.entries()]
      .map(([key, sources]) => ({ key, sources: [...sources].sort() }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    deniedPermissions: [...denied].sort(),
    recentActivity:
      activity?.map((entry) => ({
        id: entry.id,
        occurredAt: entry.occurredAt,
        action: entry.action,
        summary: entry.summary,
        actor: nameOf(entry.actorId) ?? entry.actorLabel ?? "System",
      })) ?? null,
    recentSignIns: signIns,
  };
}
