import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { PERMISSION_CATALOGUE } from "@/modules/catalogue";
import { DEFAULT_STAGES } from "@/modules/crm/domain/pipeline";

/**
 * Integration-test database helpers (CLAUDE.md §20).
 *
 * ⚠️  These functions TRUNCATE tables. They run only when `TEST_DATABASE_URL` is
 * set, which must point at a dedicated test database or a Supabase branch —
 * NEVER production, and never the database a person is using for development.
 *
 * Integration tests run against real Postgres rather than a mocked Prisma,
 * because most real defects live in SQL, constraints and transactions — exactly
 * what a mock cannot reproduce.
 */

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";

/** True when a test database is configured; suites gate themselves on this. */
export const hasTestDatabase = TEST_DATABASE_URL !== "";

let client: PrismaClient | undefined;

/** A Prisma client bound explicitly to the test database. */
export function testPrisma(): PrismaClient {
  if (!hasTestDatabase) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Integration suites must gate on " +
        "`hasTestDatabase` before calling this.",
    );
  }
  client ??= new PrismaClient({
    adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }),
  });
  return client;
}

export async function disconnectTestPrisma(): Promise<void> {
  if (client !== undefined) {
    await client.$disconnect();
    client = undefined;
  }
}

/**
 * Standard suite teardown: empty the database, then disconnect.
 *
 * Resetting only in `beforeEach` leaves the last test's fixtures behind, which
 * then look like real rows to whoever opens the database next. A suite must leave
 * no trace.
 */
export async function teardownDatabase(): Promise<void> {
  if (hasTestDatabase) {
    await resetDatabase();
  }
  await disconnectTestPrisma();
}

/**
 * Tables emptied between tests, in an order that respects foreign keys. CASCADE
 * covers anything missed, but the explicit list documents what the suite owns and
 * makes an accidental truncation of a future table visible in review.
 */
const TABLES = [
  "messaging.message_attachments",
  "messaging.messages",
  "messaging.conversation_participants",
  "messaging.conversations",
  "messaging.user_presence",
  "crm.activities",
  "crm.opportunity_contacts",
  "crm.leads",
  "crm.opportunities",
  "crm.contacts",
  "crm.accounts",
  "crm.opportunity_stages",
  "platform.audit_log",
  "platform.event_outbox",
  "iam.user_permission_grants",
  "iam.user_roles",
  "iam.group_roles",
  "iam.group_members",
  "iam.role_permissions",
  "iam.service_account_roles",
  "iam.api_tokens",
  "iam.delegation_grants",
  "iam.login_history",
  "iam.users",
  "iam.groups",
  "iam.service_accounts",
  "iam.roles",
  "iam.permissions",
  "iam.organizational_units",
];

export async function resetDatabase(): Promise<void> {
  const prisma = testPrisma();
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`,
  );
}

/** Seeds the permission catalogue the way `prisma/seed.ts` does. */
export async function seedPermissions(): Promise<void> {
  const prisma = testPrisma();
  const definitions = PERMISSION_CATALOGUE;

  await prisma.permission.createMany({
    data: definitions.map((definition) => ({
      key: definition.key,
      module: definition.module,
      resource: definition.resource,
      action: definition.action,
      description: definition.description,
      isSensitive: definition.isSensitive ?? false,
    })),
  });
}

export type OrgUnitFixture = { id: string; key: string; path: string };

export async function createOrgUnit(
  key: string,
  path: string,
  depth: number,
  parentId?: string,
): Promise<OrgUnitFixture> {
  const prisma = testPrisma();
  const unit = await prisma.organizationalUnit.create({
    data: {
      key,
      name: key,
      path,
      depth,
      parentId: parentId ?? null,
    },
    select: { id: true, key: true, path: true },
  });
  return unit;
}

/** Creates a role holding the given permission keys. */
export async function createRole(
  key: string,
  permissionKeys: readonly string[],
): Promise<{ id: string; key: string }> {
  const prisma = testPrisma();
  const permissions = await prisma.permission.findMany({
    where: { key: { in: [...permissionKeys] } },
    select: { id: true },
  });

  if (permissions.length !== permissionKeys.length) {
    throw new Error(
      `createRole("${key}") referenced permissions that are not seeded. ` +
        `Call seedPermissions() first.`,
    );
  }

  return prisma.role.create({
    data: {
      key,
      name: key,
      permissions: {
        create: permissions.map((permission) => ({ permissionId: permission.id })),
      },
    },
    select: { id: true, key: true },
  });
}

export type UserFixture = { id: string; email: string };

export async function createUser(options: {
  email: string;
  orgUnitId?: string | null;
  isActive?: boolean;
}): Promise<UserFixture> {
  const prisma = testPrisma();
  return prisma.user.create({
    data: {
      id: crypto.randomUUID(),
      email: options.email,
      fullName: options.email.split("@")[0] ?? null,
      orgUnitId: options.orgUnitId ?? null,
      isActive: options.isActive ?? true,
    },
    select: { id: true, email: true },
  });
}

export async function grantRole(
  userId: string,
  roleId: string,
  scope: {
    scopeType?: "GLOBAL" | "ORG_UNIT" | "OWN_ORG_UNIT" | "OWN";
    scopeOrgUnitId?: string | null;
  } = {},
): Promise<void> {
  const prisma = testPrisma();
  await prisma.userRole.create({
    data: {
      userId,
      roleId,
      scopeType: scope.scopeType ?? "GLOBAL",
      scopeOrgUnitId: scope.scopeOrgUnitId ?? null,
    },
  });
}

/** Seeds the default CRM pipeline stages, as `prisma/seed.ts` does. */
export async function seedStages(): Promise<void> {
  await testPrisma().crmOpportunityStage.createMany({
    data: DEFAULT_STAGES.map((stage) => ({ ...stage })),
  });
}
