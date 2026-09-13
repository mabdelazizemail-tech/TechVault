import { afterAll, beforeEach, describe, expect, it } from "vitest";
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
} from "./helpers/db";
import { IAM_PERMISSIONS } from "@/platform/iam/permissions";

/**
 * Database constraints (CLAUDE.md §8.4).
 *
 * "The app is not the last line of defence" is only true if the constraints
 * actually exist in the deployed schema. These tests assert the database refuses
 * bad data even when application code asks it to — the failure mode that matters
 * when a future bug, a migration, or a direct SQL fix bypasses the service layer.
 */
describe.skipIf(!hasTestDatabase)("database constraints (integration)", () => {
  afterAll(async () => {
    // Leave the database as the suite found it (see teardownDatabase).
    await teardownDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedPermissions();
  });

  it("enforces a unique permission key", async () => {
    const prisma = testPrisma();
    await expect(
      prisma.permission.create({
        data: {
          key: IAM_PERMISSIONS.USER_READ,
          module: "iam",
          resource: "user",
          action: "READ",
          description: "duplicate",
        },
      }),
    ).rejects.toThrow();
  });

  it("enforces a unique role key", async () => {
    const prisma = testPrisma();
    await createRole("finance-approver", [IAM_PERMISSIONS.USER_READ]);
    await expect(
      prisma.role.create({ data: { key: "finance-approver", name: "Duplicate" } }),
    ).rejects.toThrow();
  });

  it("enforces a unique email per user", async () => {
    await createUser({ email: "only-once@example.com" });
    await expect(createUser({ email: "only-once@example.com" })).rejects.toThrow();
  });

  it("prevents the same role being granted twice at the same scope", async () => {
    const role = await createRole("reader", [IAM_PERMISSIONS.USER_READ]);
    const user = await createUser({ email: "dupe-grant@example.com" });

    await grantRole(user.id, role.id);
    // Without this constraint, a double-click on "assign role" would silently
    // create two identical grants and make access review confusing.
    await expect(grantRole(user.id, role.id)).rejects.toThrow();
  });

  it("allows the same role at different scopes", async () => {
    const root = await createOrgUnit("root", "/root", 0);
    const finance = await createOrgUnit("finance", "/root/finance", 1, root.id);
    const role = await createRole("reader", [IAM_PERMISSIONS.USER_READ]);
    const user = await createUser({ email: "multi-scope@example.com" });

    await grantRole(user.id, role.id, { scopeType: "GLOBAL" });
    await expect(
      grantRole(user.id, role.id, {
        scopeType: "ORG_UNIT",
        scopeOrgUnitId: finance.id,
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects a role grant referencing a user that does not exist", async () => {
    const prisma = testPrisma();
    const role = await createRole("reader", [IAM_PERMISSIONS.USER_READ]);
    await expect(
      prisma.userRole.create({
        data: { userId: crypto.randomUUID(), roleId: role.id, scopeType: "GLOBAL" },
      }),
    ).rejects.toThrow();
  });

  it("cascades role-permission links when a role is deleted", async () => {
    const prisma = testPrisma();
    const role = await createRole("temporary", [IAM_PERMISSIONS.USER_READ]);

    await prisma.role.delete({ where: { id: role.id } });

    const orphans = await prisma.rolePermission.findMany({ where: { roleId: role.id } });
    expect(orphans).toHaveLength(0);
  });

  it("refuses to delete an organisational unit that still has children", async () => {
    const prisma = testPrisma();
    const root = await createOrgUnit("root", "/root", 0);
    await createOrgUnit("finance", "/root/finance", 1, root.id);

    // onDelete: Restrict — removing a parent must not silently orphan a subtree
    // that scope resolution depends on.
    await expect(
      prisma.organizationalUnit.delete({ where: { id: root.id } }),
    ).rejects.toThrow();
  });

  it("enforces a unique organisational unit key", async () => {
    await createOrgUnit("root", "/root", 0);
    await expect(createOrgUnit("root", "/root-again", 0)).rejects.toThrow();
  });

  it("keeps login history after the user is deleted, so failed attempts survive", async () => {
    const prisma = testPrisma();
    const user = await createUser({ email: "transient@example.com" });

    await prisma.loginHistory.create({
      data: { userId: user.id, email: user.email, success: false, failureReason: "bad" },
    });

    await prisma.user.delete({ where: { id: user.id } });

    // onDelete: SetNull — the security record outlives the account (§22).
    const history = await prisma.loginHistory.findMany({
      where: { email: "transient@example.com" },
    });
    expect(history).toHaveLength(1);
    expect(history[0]?.userId).toBeNull();
  });

  it("stores timestamps as timestamptz in UTC", async () => {
    const prisma = testPrisma();
    const rows = await prisma.$queryRawUnsafe<{ data_type: string }[]>(
      `select data_type from information_schema.columns
        where table_schema = 'iam' and table_name = 'users' and column_name = 'created_at'`,
    );
    expect(rows[0]?.data_type).toBe("timestamp with time zone");
  });

  it("defaults uuid primary keys in the database, not only in application code", async () => {
    const prisma = testPrisma();
    const rows = await prisma.$queryRawUnsafe<{ column_default: string | null }[]>(
      `select column_default from information_schema.columns
        where table_schema = 'iam' and table_name = 'roles' and column_name = 'id'`,
    );
    expect(rows[0]?.column_default ?? "").toMatch(/gen_random_uuid|uuid/i);
  });
});
