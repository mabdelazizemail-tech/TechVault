import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { recordAudit } from "@/platform/audit/audit";
import {
  hasTestDatabase,
  resetDatabase,
  teardownDatabase,
  testPrisma,
} from "./helpers/db";

/**
 * Database-layer security controls (CLAUDE.md ADR-002, §18.6).
 *
 * These assert the controls the application cannot enforce on its own. A rule
 * that lives only in service code is one careless query away from being bypassed;
 * these tests prove the database itself refuses.
 */
describe.skipIf(!hasTestDatabase)("database security controls (integration)", () => {
  afterAll(async () => {
    await teardownDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  describe("row-level security", () => {
    it("is enabled on every table in the iam and platform schemas", async () => {
      const rows = await testPrisma().$queryRawUnsafe<
        { schemaname: string; tablename: string; rowsecurity: boolean }[]
      >(
        `select schemaname, tablename, rowsecurity
           from pg_tables
          where schemaname in ('iam', 'platform')
          order by schemaname, tablename`,
      );

      expect(rows.length).toBeGreaterThan(0);
      const unprotected = rows
        .filter((row) => !row.rowsecurity)
        .map((row) => `${row.schemaname}.${row.tablename}`);

      // A table added without RLS is the gap this test exists to catch: the
      // migration that creates it must enable RLS too.
      expect(unprotected).toEqual([]);
    });

    it("grants no policies, so a non-owning role would match zero rows", async () => {
      const policies = await testPrisma().$queryRawUnsafe<{ count: bigint }[]>(
        `select count(*)::bigint as count
           from pg_policies
          where schemaname in ('iam', 'platform')`,
      );

      // Deny-by-default is the point: RLS enabled with no policy means no access.
      // If a policy is ever added here, it must be a deliberate, reviewed decision.
      expect(Number(policies[0]?.count ?? -1)).toBe(0);
    });

    it("does not prevent the application from reading its own tables", async () => {
      // The app connects as the table owner, which bypasses RLS because FORCE ROW
      // LEVEL SECURITY is deliberately not set. If this ever fails, RLS has been
      // forced and every query in the platform is about to break.
      await expect(testPrisma().permission.count()).resolves.toBeGreaterThanOrEqual(0);
      await expect(testPrisma().auditLog.count()).resolves.toBeGreaterThanOrEqual(0);
    });
  });

  describe("platform.audit_log is append-only", () => {
    it("accepts inserts", async () => {
      await recordAudit({
        actorLabel: "test",
        action: "test.insert",
        module: "test",
        entityType: "Test",
        summary: "append works",
      });

      const count = await testPrisma().auditLog.count({
        where: { action: "test.insert" },
      });
      expect(count).toBe(1);
    });

    it("refuses UPDATE, even for the table owner", async () => {
      await recordAudit({
        actorLabel: "test",
        action: "test.immutable",
        module: "test",
        entityType: "Test",
        summary: "original summary",
      });

      const record = await testPrisma().auditLog.findFirstOrThrow({
        where: { action: "test.immutable" },
        select: { id: true },
      });

      await expect(
        testPrisma().auditLog.update({
          where: { id: record.id },
          data: { summary: "tampered" },
        }),
      ).rejects.toThrow(/append-only/i);

      // And the row is unchanged.
      const after = await testPrisma().auditLog.findFirstOrThrow({
        where: { id: record.id },
        select: { summary: true },
      });
      expect(after.summary).toBe("original summary");
    });

    it("refuses DELETE, even for the table owner", async () => {
      await recordAudit({
        actorLabel: "test",
        action: "test.undeletable",
        module: "test",
        entityType: "Test",
        summary: "cannot be removed",
      });

      const record = await testPrisma().auditLog.findFirstOrThrow({
        where: { action: "test.undeletable" },
        select: { id: true },
      });

      await expect(
        testPrisma().auditLog.delete({ where: { id: record.id } }),
      ).rejects.toThrow(/append-only/i);

      expect(await testPrisma().auditLog.count({ where: { id: record.id } })).toBe(1);
    });

    it("refuses a bulk DELETE that matches nothing", async () => {
      // FOR EACH STATEMENT: the guard fires on the attempt, not on a matched row,
      // so a "harmless" cleanup query cannot quietly succeed when it matches zero
      // rows today and something tomorrow.
      await expect(
        testPrisma().auditLog.deleteMany({ where: { action: "does.not.exist" } }),
      ).rejects.toThrow(/append-only/i);
    });

    it("still allows TRUNCATE, which is how this suite resets", async () => {
      // Documented residual gap (§29): TRUNCATE fires a different trigger event and
      // requires table ownership. Closing it needs a dedicated application role.
      await recordAudit({
        actorLabel: "test",
        action: "test.truncatable",
        module: "test",
        entityType: "Test",
        summary: "will be truncated",
      });
      await expect(resetDatabase()).resolves.toBeUndefined();
      expect(await testPrisma().auditLog.count()).toBe(0);
    });
  });
});
