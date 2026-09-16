import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { config as loadEnv } from "dotenv";
import { INNOVATION_MEMBER_ROLE } from "../modules/innovation/contracts/permissions";
import { CRM_SALES_ROLE } from "../modules/crm/contracts/permissions";
import { SYSTEM_ROLES } from "../platform/iam/permissions";

/**
 * Grants the new Think Tank section role to everyone who used to reach THE THINK
 * TANK through `employee` or `sales` (ADR-030).
 *
 * Until ADR-030 those two roles carried the Think Tank member permissions, so
 * ticking or unticking a section role could not actually show or hide the
 * section. The seed reconciles role permissions, so re-seeding removes them —
 * which would quietly take the section away from people who have it today. This
 * script gives those people the `think-tank-user` role instead, so what they see
 * does not change and each section now follows its own checkbox.
 *
 * Run once, immediately after `npm run db:seed`:
 *
 *   npm run db:backfill-section-roles            # report what it would do
 *   npm run db:backfill-section-roles -- --apply # write the grants
 *
 * Idempotent: a second run finds nothing to do. Every grant is audited.
 */

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined || connectionString === "") {
  throw new Error("DATABASE_URL is required.");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/** The roles that used to confer Think Tank access as a side effect. */
const SOURCE_ROLE_KEYS = [SYSTEM_ROLES.EMPLOYEE, CRM_SALES_ROLE];

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  const target = await prisma.role.findUnique({
    where: { key: INNOVATION_MEMBER_ROLE },
    select: { id: true, key: true },
  });
  if (target === null) {
    throw new Error(
      `Role "${INNOVATION_MEMBER_ROLE}" does not exist. Run npm run db:seed first.`,
    );
  }

  // Everyone holding one of the old roles, however it is scoped: the permissions
  // rode along with the role, so the person could open the section.
  const candidates = await prisma.user.findMany({
    where: {
      deletedAt: null,
      roles: { some: { role: { key: { in: SOURCE_ROLE_KEYS } } } },
    },
    orderBy: { email: "asc" },
    take: 5000,
    select: {
      id: true,
      email: true,
      roles: { select: { roleId: true, scopeType: true, scopeOrgUnitId: true } },
    },
  });

  const missing = candidates.filter(
    (user) =>
      !user.roles.some(
        (grant) =>
          grant.roleId === target.id &&
          grant.scopeType === "GLOBAL" &&
          grant.scopeOrgUnitId === null,
      ),
  );

  process.stdout.write(
    `${candidates.length} user(s) hold ${SOURCE_ROLE_KEYS.join(" or ")}; ` +
      `${missing.length} need "${target.key}".\n`,
  );
  for (const user of missing) process.stdout.write(`  ${user.email}\n`);

  if (missing.length === 0) return;
  if (!apply) {
    process.stdout.write("\nNothing written. Re-run with --apply to grant them.\n");
    return;
  }

  for (const user of missing) {
    await prisma.$transaction(async (tx) => {
      // Find-then-create rather than upsert: a nullable column in a compound
      // unique is not addressable in a Prisma `where` (the same reason as
      // bootstrap-admin).
      const existing = await tx.userRole.findFirst({
        where: {
          userId: user.id,
          roleId: target.id,
          scopeType: "GLOBAL",
          scopeOrgUnitId: null,
        },
        select: { id: true },
      });
      if (existing !== null) return;

      await tx.userRole.create({
        data: { userId: user.id, roleId: target.id, scopeType: "GLOBAL" },
      });
      await tx.auditLog.create({
        data: {
          actorId: null,
          actorLabel: "backfill-section-roles-script",
          action: "iam.user_role.granted",
          module: "iam",
          entityType: "User",
          entityId: user.id,
          summary: `Granted ${user.email} the "${target.key}" role, keeping the Think Tank access that moved out of employee and sales (ADR-030)`,
          changes: { roleKey: target.key, scopeType: "GLOBAL" },
          severity: "WARNING",
        },
      });
    });
  }

  process.stdout.write(`\nGranted "${target.key}" to ${missing.length} user(s).\n`);
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
