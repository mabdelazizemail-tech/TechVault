import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { recordAudit } from "@/platform/audit/audit";
import { IAM_PERMISSIONS } from "@/platform/iam/permissions";
import { publish } from "@/platform/events/publish";
import { setUserActive } from "@/platform/iam/services/user-service";
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

/**
 * Transactional integrity (CLAUDE.md §10, §18.6, §19.2).
 *
 * The rule is that a business change, its audit entry and its outbox event commit
 * or roll back TOGETHER. An audited change that did not happen is as wrong as an
 * unaudited change that did, and an event announcing a rolled-back change is a
 * data-consistency bug that surfaces days later in another module.
 *
 * Only a real database can prove this. It is the main reason §20 forbids mocking
 * Prisma in integration tests.
 */
describe.skipIf(!hasTestDatabase)("transactional integrity (integration)", () => {
  afterAll(async () => {
    // Leave the database as the suite found it (see teardownDatabase).
    await teardownDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedPermissions();
  });

  it("rolls back the audit record when the surrounding transaction fails", async () => {
    const prisma = testPrisma();

    await expect(
      prisma.$transaction(async (tx) => {
        await recordAudit(
          {
            actorId: null,
            actorLabel: "test",
            action: "test.rollback",
            module: "test",
            entityType: "Test",
            summary: "should never persist",
          },
          tx,
        );
        throw new Error("forced failure after the audit write");
      }),
    ).rejects.toThrow(/forced failure/);

    const records = await prisma.auditLog.findMany({
      where: { action: "test.rollback" },
    });
    expect(records).toHaveLength(0);
  });

  it("rolls back the outbox event when the surrounding transaction fails", async () => {
    const prisma = testPrisma();

    await expect(
      prisma.$transaction(async (tx) => {
        await publish(tx, {
          name: "test.ShouldNotEscape",
          payload: { marker: "rollback" },
        });
        throw new Error("forced failure after the event write");
      }),
    ).rejects.toThrow(/forced failure/);

    const events = await prisma.eventOutbox.findMany({
      where: { name: "test.ShouldNotEscape" },
    });
    // An event describing a change that rolled back is precisely what the outbox
    // pattern exists to prevent.
    expect(events).toHaveLength(0);
  });

  it("commits the change, its audit record and its event together", async () => {
    const prisma = testPrisma();

    const unit = await createOrgUnit("root", "/root", 0);
    const editor = await createRole("editor", [
      IAM_PERMISSIONS.USER_READ,
      IAM_PERMISSIONS.USER_UPDATE,
    ]);
    const actor = await createUser({ email: "editor@example.com", orgUnitId: unit.id });
    await grantRole(actor.id, editor.id);
    const target = await createUser({
      email: "target@example.com",
      orgUnitId: unit.id,
    });

    const result = await setUserActive(
      { id: actor.id },
      { userId: target.id, isActive: false, reason: "left the organisation" },
    );

    expect(result.isActive).toBe(false);

    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: target.id },
      select: { isActive: true },
    });
    expect(stored.isActive).toBe(false);

    const audit = await prisma.auditLog.findMany({
      where: { entityId: target.id, action: "iam.user.deactivated" },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.summary).toContain("left the organisation");
    expect(audit[0]?.severity).toBe("NOTICE");

    const events = await prisma.eventOutbox.findMany({
      where: { name: "iam.UserDeactivated" },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.status).toBe("PENDING");
    expect(events[0]?.payload).toEqual({ userId: target.id });
  });

  it("keeps sensitive values out of the audit change-set", async () => {
    const prisma = testPrisma();

    await recordAudit({
      actorId: null,
      actorLabel: "test",
      action: "test.sensitive",
      module: "test",
      entityType: "Test",
      summary: "a compensation change",
      // What a real HRIS caller would pass via diffForAudit with sensitiveKeys.
      changes: { baseSalaryMinor: { from: "[changed]", to: "[changed]" } },
    });

    const record = await prisma.auditLog.findFirstOrThrow({
      where: { action: "test.sensitive" },
    });
    expect(JSON.stringify(record.changes)).not.toMatch(/\d{4,}/);
  });

  it("writes an event payload that contains no sensitive fields", async () => {
    const prisma = testPrisma();
    const unit = await createOrgUnit("root", "/root", 0);
    const editor = await createRole("editor", [
      IAM_PERMISSIONS.USER_READ,
      IAM_PERMISSIONS.USER_UPDATE,
    ]);
    const actor = await createUser({ email: "auditor@example.com", orgUnitId: unit.id });
    await grantRole(actor.id, editor.id);
    const target = await createUser({ email: "subject@example.com", orgUnitId: unit.id });

    await setUserActive(
      { id: actor.id },
      { userId: target.id, isActive: false, reason: "policy" },
    );

    const event = await prisma.eventOutbox.findFirstOrThrow({
      where: { name: "iam.UserDeactivated" },
    });
    // Entity IDs only — events are logged, retried and inspected by humans (§10).
    expect(Object.keys(event.payload as Record<string, unknown>)).toEqual(["userId"]);
  });
});
