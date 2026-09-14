import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { PERMISSION_CATALOGUE } from "@/modules/catalogue";
import { can } from "@/platform/authz/authz";
import { IAM_PERMISSIONS, SYSTEM_ROLES } from "@/platform/iam/permissions";
import {
  createUser,
  deleteUser,
  getUserDetail,
  listUserAdminOptions,
  requestPasswordReset,
  setUserRoles,
  updateUser,
} from "@/platform/iam/services/user-admin-service";
import { listUsers, setUserActive } from "@/platform/iam/services/user-service";
import {
  createOrgUnit,
  createRole,
  createUser as createUserFixture,
  grantRole,
  hasTestDatabase,
  resetDatabase,
  seedPermissions,
  teardownDatabase,
  testPrisma,
  type OrgUnitFixture,
  type UserFixture,
} from "./helpers/db";

/**
 * User administration against a real database (ADR-019).
 *
 * Supabase Auth cannot be called from a test, so the one module that talks to it
 * is replaced with recording fakes. Everything else is real: permissions resolved
 * from stored grants, the services, transactions, the audit trail and the
 * last-administrator guard. Each behaviour is asserted in both directions.
 */

const identity = vi.hoisted(() => ({
  isAccountAdminConfigured: vi.fn(() => true),
  createAccount: vi.fn(),
  updateAccountEmail: vi.fn(),
  setAccountBanned: vi.fn(),
  deleteAccount: vi.fn(),
  sendPasswordReset: vi.fn(),
}));

vi.mock("@/platform/auth/identity-admin", () => identity);

describe.skipIf(!hasTestDatabase)("user administration (integration)", () => {
  // Created in beforeAll: the describe body is collected even when the suite is skipped.
  let prisma: ReturnType<typeof testPrisma>;

  let root: OrgUnitFixture;
  let sales: OrgUnitFixture;
  let adminRole: { id: string; key: string };
  let employeeRole: { id: string; key: string };
  let managerRole: { id: string; key: string };
  let admin: UserFixture;
  let employee: UserFixture;
  let manager: UserFixture;

  const as = (user: UserFixture) => ({ id: user.id });
  const newUser = (overrides: Record<string, unknown> = {}) => ({
    email: "New.Person@Example.com",
    fullName: "New Person",
    roleIds: [],
    orgUnitId: null,
    isActive: true,
    setup: { method: "invite" },
    ...overrides,
  });

  beforeAll(async () => {
    prisma = testPrisma();
    await resetDatabase();
  });

  afterAll(async () => {
    await teardownDatabase();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    identity.isAccountAdminConfigured.mockReturnValue(true);
    identity.createAccount.mockImplementation(async () => ({ id: crypto.randomUUID() }));
    identity.updateAccountEmail.mockResolvedValue(undefined);
    identity.setAccountBanned.mockResolvedValue(undefined);
    identity.deleteAccount.mockResolvedValue(undefined);
    identity.sendPasswordReset.mockResolvedValue(undefined);

    await resetDatabase();
    await seedPermissions();
    root = await createOrgUnit("root", "/root", 0);
    sales = await createOrgUnit("sales", "/root/sales", 1, root.id);

    adminRole = await createRole(
      SYSTEM_ROLES.PLATFORM_ADMIN,
      PERMISSION_CATALOGUE.map((permission) => permission.key),
    );
    employeeRole = await createRole(SYSTEM_ROLES.EMPLOYEE, []);
    managerRole = await createRole("user-manager", [
      IAM_PERMISSIONS.ACCESS,
      IAM_PERMISSIONS.USER_READ,
      IAM_PERMISSIONS.USER_CREATE,
      IAM_PERMISSIONS.USER_UPDATE,
      IAM_PERMISSIONS.USER_ADMINISTER,
    ]);

    admin = await createUserFixture({ email: "admin@example.com", orgUnitId: root.id });
    employee = await createUserFixture({
      email: "employee@example.com",
      orgUnitId: root.id,
    });
    manager = await createUserFixture({
      email: "manager@example.com",
      orgUnitId: root.id,
    });
    await grantRole(admin.id, adminRole.id);
    await grantRole(employee.id, employeeRole.id);
    await grantRole(manager.id, managerRole.id);
  });

  const auditActions = async (entityId: string) =>
    (
      await prisma.auditLog.findMany({
        where: { entityId },
        orderBy: { occurredAt: "asc" },
        select: { action: true },
      })
    ).map((entry) => entry.action);

  describe("a platform administrator", () => {
    it("creates a user with a role, a unit and an invitation, and audits it", async () => {
      const created = await createUser(
        as(admin),
        newUser({ roleIds: [employeeRole.id], orgUnitId: sales.id }),
      );

      expect(identity.createAccount).toHaveBeenCalledWith(
        expect.objectContaining({ email: "new.person@example.com", method: "invite" }),
      );
      const row = await prisma.user.findUniqueOrThrow({
        where: { id: created.id },
        select: {
          email: true,
          orgUnitId: true,
          isActive: true,
          createdBy: true,
          roles: { select: { role: { select: { key: true } } } },
        },
      });
      expect(row).toMatchObject({
        email: "new.person@example.com",
        orgUnitId: sales.id,
        isActive: true,
        createdBy: admin.id,
      });
      expect(row.roles.map((assignment) => assignment.role.key)).toEqual([
        SYSTEM_ROLES.EMPLOYEE,
      ]);

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: "iam.user.created", entityId: created.id },
      });
      expect(audit.actorId).toBe(admin.id);
    });

    it("sets a temporary password without ever recording it", async () => {
      const password = "correct-horse-battery-staple";
      const created = await createUser(
        as(admin),
        newUser({ setup: { method: "password", password } }),
      );

      expect(identity.createAccount).toHaveBeenCalledWith(
        expect.objectContaining({ method: "password", password }),
      );
      const records = await prisma.auditLog.findMany({ where: { entityId: created.id } });
      expect(JSON.stringify(records)).not.toContain(password);
    });

    it("refuses a duplicate email, an unknown role or an unknown unit before creating any account", async () => {
      await expect(
        createUser(as(admin), newUser({ email: "EMPLOYEE@example.com" })),
      ).rejects.toBeInstanceOf(ConflictError);
      await expect(
        createUser(as(admin), newUser({ roleIds: [crypto.randomUUID()] })),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        createUser(as(admin), newUser({ orgUnitId: crypto.randomUUID() })),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        createUser(as(admin), newUser({ email: "not-an-email" })),
      ).rejects.toBeInstanceOf(ValidationError);

      expect(identity.createAccount).not.toHaveBeenCalled();
    });

    it("writes nothing when the sign-in service refuses the account", async () => {
      identity.createAccount.mockRejectedValueOnce(
        new ConflictError("A sign-in account with this email address already exists."),
      );

      await expect(createUser(as(admin), newUser())).rejects.toBeInstanceOf(
        ConflictError,
      );
      expect(
        await prisma.user.count({ where: { email: "new.person@example.com" } }),
      ).toBe(0);
      expect(identity.deleteAccount).not.toHaveBeenCalled();
    });

    it("removes the new sign-in account again when the user record cannot be written", async () => {
      // The provider hands back an id TechVault already uses, so the insert fails.
      identity.createAccount.mockResolvedValueOnce({ id: employee.id });

      await expect(createUser(as(admin), newUser())).rejects.toBeInstanceOf(
        ConflictError,
      );
      expect(identity.deleteAccount).toHaveBeenCalledWith(employee.id);
      expect(
        await prisma.user.count({ where: { email: "new.person@example.com" } }),
      ).toBe(0);
    });

    it("edits the profile and organisation unit, auditing each change", async () => {
      await updateUser(as(admin), employee.id, {
        fullName: "Employee Renamed",
        locale: "ar",
        orgUnitId: sales.id,
      });

      await expect(
        prisma.user.findUniqueOrThrow({
          where: { id: employee.id },
          select: { fullName: true, locale: true, orgUnitId: true, updatedBy: true },
        }),
      ).resolves.toEqual({
        fullName: "Employee Renamed",
        locale: "ar",
        orgUnitId: sales.id,
        updatedBy: admin.id,
      });
      expect(await auditActions(employee.id)).toEqual([
        "iam.user.updated",
        "iam.user.org_unit_changed",
      ]);
      expect(identity.updateAccountEmail).not.toHaveBeenCalled();

      await expect(
        updateUser(as(admin), employee.id, { orgUnitId: crypto.randomUUID() }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        updateUser(as(admin), "not-a-uuid", { fullName: "Nobody" }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("changes the sign-in email through the sign-in service", async () => {
      await updateUser(as(admin), employee.id, { email: "Employee.New@Example.com" });

      expect(identity.updateAccountEmail).toHaveBeenCalledWith(
        employee.id,
        "employee.new@example.com",
      );
      await expect(
        updateUser(as(admin), employee.id, { email: "manager@example.com" }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("changes roles, and the user's effective permissions follow", async () => {
      await expect(can(as(employee), IAM_PERMISSIONS.USER_CREATE)).resolves.toBe(false);

      await expect(
        setUserRoles(as(admin), employee.id, { roleIds: [managerRole.id] }),
      ).resolves.toEqual({ added: ["user-manager"], removed: [SYSTEM_ROLES.EMPLOYEE] });
      await expect(can(as(employee), IAM_PERMISSIONS.USER_CREATE)).resolves.toBe(true);

      await setUserRoles(as(admin), employee.id, { roleIds: [] });
      await expect(can(as(employee), IAM_PERMISSIONS.USER_CREATE)).resolves.toBe(false);

      const records = await prisma.auditLog.findMany({
        where: { action: "iam.user.roles_changed", entityId: employee.id },
      });
      expect(records).toHaveLength(2);
      expect(
        records.every(
          (record) => record.actorId === admin.id && record.severity === "CRITICAL",
        ),
      ).toBe(true);
    });

    it("deactivates with immediate effect and reactivates, keeping the sign-in service in step", async () => {
      await expect(can(as(manager), IAM_PERMISSIONS.USER_READ)).resolves.toBe(true);

      await setUserActive(as(admin), {
        userId: manager.id,
        isActive: false,
        reason: "Left the company",
      });
      await expect(can(as(manager), IAM_PERMISSIONS.USER_READ)).resolves.toBe(false);
      await expect(listUsers(as(manager))).rejects.toThrow();
      expect(identity.setAccountBanned).toHaveBeenLastCalledWith(manager.id, true);

      await setUserActive(as(admin), {
        userId: manager.id,
        isActive: true,
        reason: "Returned",
      });
      await expect(can(as(manager), IAM_PERMISSIONS.USER_READ)).resolves.toBe(true);
      expect(identity.setAccountBanned).toHaveBeenLastCalledWith(manager.id, false);

      expect(await auditActions(manager.id)).toEqual([
        "iam.user.deactivated",
        "iam.user.activated",
      ]);
    });

    it("sends a password reset email and audits it, but not for an inactive account", async () => {
      await expect(requestPasswordReset(as(admin), employee.id)).resolves.toEqual({
        email: "employee@example.com",
      });
      expect(identity.sendPasswordReset).toHaveBeenCalledWith("employee@example.com");
      expect(await auditActions(employee.id)).toContain(
        "iam.user.password_reset_requested",
      );

      await setUserActive(as(admin), {
        userId: employee.id,
        isActive: false,
        reason: "Paused",
      });
      await expect(requestPasswordReset(as(admin), employee.id)).rejects.toBeInstanceOf(
        BusinessRuleError,
      );
    });

    it("deletes softly: access, roles and the sign-in account go; history stays", async () => {
      await updateUser(as(admin), employee.id, { fullName: "Before Deletion" });

      await expect(
        deleteUser(as(admin), employee.id, { confirmEmail: "someone-else@example.com" }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        deleteUser(as(admin), employee.id, { confirmEmail: "EMPLOYEE@example.com" }),
      ).resolves.toEqual({ email: "employee@example.com", signInRemoved: true });

      const row = await prisma.user.findUniqueOrThrow({
        where: { id: employee.id },
        select: { isActive: true, deletedAt: true, _count: { select: { roles: true } } },
      });
      expect(row.isActive).toBe(false);
      expect(row.deletedAt).not.toBeNull();
      expect(row._count.roles).toBe(0);
      expect(identity.deleteAccount).toHaveBeenCalledWith(employee.id);
      expect(await auditActions(employee.id)).toEqual([
        "iam.user.updated",
        "iam.user.deleted",
      ]);

      const listed = await listUsers(as(admin), { status: "all" });
      expect(listed.rows.map((user) => user.email)).not.toContain("employee@example.com");
      await expect(getUserDetail(as(admin), employee.id)).rejects.toBeInstanceOf(
        NotFoundError,
      );
      await expect(
        createUser(as(admin), newUser({ email: "employee@example.com" })),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("shows details with roles, effective permissions and activity, and no credentials", async () => {
      await updateUser(as(admin), manager.id, { fullName: "Manager Person" });

      const detail = await getUserDetail(as(admin), manager.id);
      expect(detail.roles.map((role) => role.key)).toEqual(["user-manager"]);
      expect(detail.permissions.map((permission) => permission.key)).toContain(
        IAM_PERMISSIONS.USER_CREATE,
      );
      expect(detail.recentActivity?.[0]).toMatchObject({
        action: "iam.user.updated",
        actor: "admin",
      });
      expect(
        Object.keys(detail).filter((key) => /password|hash|token|secret/i.test(key)),
      ).toEqual([]);
    });

    it("filters, searches and paginates in the database", async () => {
      await setUserActive(as(admin), {
        userId: employee.id,
        isActive: false,
        reason: "Leave",
      });
      await updateUser(as(admin), manager.id, { orgUnitId: sales.id });

      const emails = async (input: Parameters<typeof listUsers>[1]) =>
        (await listUsers(as(admin), input)).rows.map((user) => user.email);

      await expect(emails({ status: "inactive" })).resolves.toEqual([
        "employee@example.com",
      ]);
      await expect(emails({ status: "all", orgUnitId: sales.id })).resolves.toEqual([
        "manager@example.com",
      ]);
      await expect(emails({ status: "all", roleId: adminRole.id })).resolves.toEqual([
        "admin@example.com",
      ]);
      await expect(emails({ status: "all", search: "MANAG" })).resolves.toEqual([
        "manager@example.com",
      ]);

      const secondPage = await listUsers(as(admin), {
        status: "all",
        sort: "email",
        page: 2,
        pageSize: 2,
      });
      expect(secondPage.total).toBe(3);
      expect(secondPage.rows.map((user) => user.email)).toEqual(["manager@example.com"]);
    });
  });

  describe("a user without administrative permissions", () => {
    it("is refused every operation, directly at the service, and nothing changes", async () => {
      const actor = as(employee);

      await expect(listUsers(actor)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(listUserAdminOptions(actor)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(getUserDetail(actor, admin.id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(createUser(actor, newUser())).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        updateUser(actor, admin.id, { fullName: "Hijacked" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        setUserRoles(actor, employee.id, { roleIds: [adminRole.id] }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        setUserActive(actor, { userId: admin.id, isActive: false, reason: "Takeover" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(requestPasswordReset(actor, admin.id)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(
        deleteUser(actor, admin.id, { confirmEmail: "admin@example.com" }),
      ).rejects.toBeInstanceOf(ForbiddenError);

      expect(identity.createAccount).not.toHaveBeenCalled();
      expect(identity.updateAccountEmail).not.toHaveBeenCalled();
      expect(identity.setAccountBanned).not.toHaveBeenCalled();
      expect(identity.deleteAccount).not.toHaveBeenCalled();
      expect(identity.sendPasswordReset).not.toHaveBeenCalled();

      await expect(
        prisma.user.findUniqueOrThrow({
          where: { id: admin.id },
          select: { fullName: true, isActive: true, deletedAt: true },
        }),
      ).resolves.toEqual({ fullName: "admin", isActive: true, deletedAt: null });
      expect(await prisma.userRole.count({ where: { userId: employee.id } })).toBe(1);
      expect(await prisma.user.count()).toBe(3);
    });

    it("cannot delete without the delete permission, even with every other user permission", async () => {
      await expect(
        deleteUser(as(manager), employee.id, { confirmEmail: "employee@example.com" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("cannot change a sign-in email with only the update permission", async () => {
      const updaterRole = await createRole("updater", [
        IAM_PERMISSIONS.ACCESS,
        IAM_PERMISSIONS.USER_READ,
        IAM_PERMISSIONS.USER_UPDATE,
      ]);
      const updater = await createUserFixture({ email: "updater@example.com" });
      await grantRole(updater.id, updaterRole.id);

      await expect(
        updateUser(as(updater), employee.id, { email: "sneaky@example.com" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(identity.updateAccountEmail).not.toHaveBeenCalled();
      await expect(
        updateUser(as(updater), employee.id, { fullName: "Allowed Rename" }),
      ).resolves.toBeUndefined();
    });
  });

  describe("privilege escalation", () => {
    it("does not let anyone grant a role conferring permissions they do not hold", async () => {
      await expect(
        setUserRoles(as(manager), employee.id, { roleIds: [adminRole.id] }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        setUserRoles(as(manager), manager.id, {
          roleIds: [managerRole.id, adminRole.id],
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        createUser(as(manager), newUser({ roleIds: [adminRole.id] })),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(identity.createAccount).not.toHaveBeenCalled();

      // A role within their own authority is fine.
      await expect(
        setUserRoles(as(manager), employee.id, { roleIds: [managerRole.id] }),
      ).resolves.toEqual({ added: ["user-manager"], removed: [SYSTEM_ROLES.EMPLOYEE] });
    });
  });

  describe("the last platform administrator", () => {
    it("cannot be deactivated, deleted or stripped of the role while nobody else holds it", async () => {
      await expect(
        setUserActive(as(admin), { userId: admin.id, isActive: false, reason: "Oops" }),
      ).rejects.toBeInstanceOf(BusinessRuleError);
      await expect(
        deleteUser(as(admin), admin.id, { confirmEmail: "admin@example.com" }),
      ).rejects.toBeInstanceOf(BusinessRuleError);
      await expect(
        setUserRoles(as(admin), admin.id, { roleIds: [] }),
      ).rejects.toBeInstanceOf(BusinessRuleError);

      await expect(
        prisma.user.findUniqueOrThrow({
          where: { id: admin.id },
          select: {
            isActive: true,
            deletedAt: true,
            _count: { select: { roles: true } },
          },
        }),
      ).resolves.toEqual({ isActive: true, deletedAt: null, _count: { roles: 1 } });
    });

    it("can step down once another active platform administrator exists", async () => {
      await grantRole(manager.id, adminRole.id);

      await expect(setUserRoles(as(admin), admin.id, { roleIds: [] })).resolves.toEqual({
        added: [],
        removed: [SYSTEM_ROLES.PLATFORM_ADMIN],
      });
    });

    it("a deactivated administrator can no longer administer", async () => {
      await grantRole(manager.id, adminRole.id);
      await setUserActive(as(manager), {
        userId: admin.id,
        isActive: false,
        reason: "Rotating access",
      });

      await expect(createUser(as(admin), newUser())).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(
        setUserRoles(as(admin), manager.id, { roleIds: [] }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(identity.createAccount).not.toHaveBeenCalled();
    });
  });
});
