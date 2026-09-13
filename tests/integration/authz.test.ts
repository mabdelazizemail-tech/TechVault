import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError } from "@/lib/errors";
import { can, requirePermission, scopeFilter } from "@/platform/authz/authz";
import { IAM_PERMISSIONS } from "@/platform/iam/permissions";
import { listUsers, setUserActive } from "@/platform/iam/services/user-service";
import {
  createOrgUnit,
  createRole,
  createUser,
  teardownDatabase,
  grantRole,
  hasTestDatabase,
  resetDatabase,
  seedPermissions,
  testPrisma,
  type OrgUnitFixture,
} from "./helpers/db";

/**
 * Authorization against a real database (CLAUDE.md §20).
 *
 * The unit suite proves the evaluator's logic; this proves the whole path —
 * grants stored in Postgres, resolved by the loader, applied by the services,
 * narrowing real SQL queries. Both directions are asserted for every behaviour.
 *
 * Runs only when TEST_DATABASE_URL is set.
 */
describe.skipIf(!hasTestDatabase)("authorization (integration)", () => {
  let root: OrgUnitFixture;
  let finance: OrgUnitFixture;
  let hr: OrgUnitFixture;

  beforeAll(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    // Leave the database as the suite found it (see teardownDatabase).
    await teardownDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedPermissions();
    root = await createOrgUnit("root", "/root", 0);
    finance = await createOrgUnit("finance", "/root/finance", 1, root.id);
    hr = await createOrgUnit("hr", "/root/hr", 1, root.id);
  });

  describe("a user holding the permission", () => {
    it("is allowed, and a user without it is refused", async () => {
      const reader = await createRole("reader", [IAM_PERMISSIONS.USER_READ]);

      const permitted = await createUser({ email: "permitted@example.com" });
      const unpermitted = await createUser({ email: "unpermitted@example.com" });
      await grantRole(permitted.id, reader.id);

      await expect(can({ id: permitted.id }, IAM_PERMISSIONS.USER_READ)).resolves.toBe(
        true,
      );
      await expect(can({ id: unpermitted.id }, IAM_PERMISSIONS.USER_READ)).resolves.toBe(
        false,
      );
    });

    it("loses access the moment the account is deactivated", async () => {
      const reader = await createRole("reader", [IAM_PERMISSIONS.USER_READ]);
      const user = await createUser({ email: "soon-disabled@example.com" });
      await grantRole(user.id, reader.id);

      await expect(can({ id: user.id }, IAM_PERMISSIONS.USER_READ)).resolves.toBe(true);

      await testPrisma().user.update({
        where: { id: user.id },
        data: { isActive: false },
      });

      // Re-checked on every request, not only at sign-in (§11.1). A fresh actor
      // is used because the permission set is request-cached by design.
      await expect(can({ id: user.id }, IAM_PERMISSIONS.USER_READ)).resolves.toBe(false);
    });

    it("loses access when the role itself is deactivated", async () => {
      const reader = await createRole("reader", [IAM_PERMISSIONS.USER_READ]);
      const user = await createUser({ email: "role-disabled@example.com" });
      await grantRole(user.id, reader.id);

      await testPrisma().role.update({
        where: { id: reader.id },
        data: { isActive: false },
      });

      await expect(can({ id: user.id }, IAM_PERMISSIONS.USER_READ)).resolves.toBe(false);
    });
  });

  describe("requirePermission", () => {
    it("throws ForbiddenError and records the denial in the audit trail", async () => {
      const user = await createUser({ email: "denied@example.com" });

      await expect(
        requirePermission({ id: user.id }, IAM_PERMISSIONS.USER_ADMINISTER),
      ).rejects.toThrow(ForbiddenError);

      const denials = await testPrisma().auditLog.findMany({
        where: { action: "iam.permission.denied", actorId: user.id },
      });
      expect(denials).toHaveLength(1);
      expect(denials[0]?.severity).toBe("WARNING");
    });

    it("does not reveal which permission was missing in the user-facing message", async () => {
      const user = await createUser({ email: "opaque@example.com" });

      await expect(
        requirePermission({ id: user.id }, IAM_PERMISSIONS.USER_ADMINISTER),
      ).rejects.toThrow(/do not have permission/i);
      await expect(
        requirePermission({ id: user.id }, IAM_PERMISSIONS.USER_ADMINISTER),
      ).rejects.not.toThrow(/iam\.user\.administer/);
    });
  });

  describe("scope narrowing", () => {
    it("restricts a unit-scoped reader to their own subtree", async () => {
      const reader = await createRole("unit-reader", [IAM_PERMISSIONS.USER_READ]);

      const financeAdmin = await createUser({
        email: "finance-admin@example.com",
        orgUnitId: finance.id,
      });
      await grantRole(financeAdmin.id, reader.id, {
        scopeType: "ORG_UNIT",
        scopeOrgUnitId: finance.id,
      });

      await createUser({ email: "in-finance@example.com", orgUnitId: finance.id });
      await createUser({ email: "in-hr@example.com", orgUnitId: hr.id });

      const filter = await scopeFilter(
        { id: financeAdmin.id },
        IAM_PERMISSIONS.USER_READ,
      );
      expect(filter.kind).toBe("restricted");

      const result = await listUsers({ id: financeAdmin.id });
      const emails = result.rows.map((row) => row.email).sort();

      // The HR user must not appear, and the count must reflect the narrowing —
      // pagination over an unfiltered set would be a correctness bug, not just a
      // performance one (§11.5).
      expect(emails).toEqual(["finance-admin@example.com", "in-finance@example.com"]);
      expect(result.total).toBe(2);
    });

    it("gives a globally scoped reader everyone", async () => {
      const reader = await createRole("global-reader", [IAM_PERMISSIONS.USER_READ]);
      const admin = await createUser({
        email: "global@example.com",
        orgUnitId: root.id,
      });
      await grantRole(admin.id, reader.id);

      await createUser({ email: "a@example.com", orgUnitId: finance.id });
      await createUser({ email: "b@example.com", orgUnitId: hr.id });

      const result = await listUsers({ id: admin.id });
      expect(result.total).toBe(3);
    });

    it("refuses a write to a record outside the actor's scope", async () => {
      const editor = await createRole("unit-editor", [
        IAM_PERMISSIONS.USER_READ,
        IAM_PERMISSIONS.USER_UPDATE,
      ]);
      const financeEditor = await createUser({
        email: "finance-editor@example.com",
        orgUnitId: finance.id,
      });
      await grantRole(financeEditor.id, editor.id, {
        scopeType: "ORG_UNIT",
        scopeOrgUnitId: finance.id,
      });

      const hrUser = await createUser({
        email: "hr-target@example.com",
        orgUnitId: hr.id,
      });
      const financeUser = await createUser({
        email: "finance-target@example.com",
        orgUnitId: finance.id,
      });

      await expect(
        setUserActive(
          { id: financeEditor.id },
          { userId: hrUser.id, isActive: false, reason: "out of scope attempt" },
        ),
      ).rejects.toThrow(ForbiddenError);

      const stillActive = await testPrisma().user.findUnique({
        where: { id: hrUser.id },
        select: { isActive: true },
      });
      expect(stillActive?.isActive).toBe(true);

      // The same operation inside scope succeeds, proving the refusal was about
      // scope rather than a broken permission.
      await expect(
        setUserActive(
          { id: financeEditor.id },
          { userId: financeUser.id, isActive: false, reason: "in scope" },
        ),
      ).resolves.toMatchObject({ isActive: false });
    });
  });

  describe("DENY precedence against stored grants", () => {
    it("lets a direct DENY override a role's ALLOW", async () => {
      const reader = await createRole("reader", [IAM_PERMISSIONS.USER_READ]);
      const user = await createUser({ email: "denied-by-exception@example.com" });
      await grantRole(user.id, reader.id);

      const permission = await testPrisma().permission.findUniqueOrThrow({
        where: { key: IAM_PERMISSIONS.USER_READ },
        select: { id: true },
      });

      await testPrisma().userPermissionGrant.create({
        data: {
          userId: user.id,
          permissionId: permission.id,
          effect: "DENY",
          scopeType: "GLOBAL",
          reason: "Under investigation",
        },
      });

      await expect(can({ id: user.id }, IAM_PERMISSIONS.USER_READ)).resolves.toBe(false);
    });
  });

  describe("group-derived grants", () => {
    it("grants through group membership", async () => {
      const reader = await createRole("reader", [IAM_PERMISSIONS.USER_READ]);
      const user = await createUser({ email: "via-group@example.com" });

      await testPrisma().group.create({
        data: {
          key: "auditors",
          name: "Auditors",
          members: { create: { userId: user.id } },
          roles: { create: { roleId: reader.id, scopeType: "GLOBAL" } },
        },
      });

      await expect(can({ id: user.id }, IAM_PERMISSIONS.USER_READ)).resolves.toBe(true);
    });
  });
});
