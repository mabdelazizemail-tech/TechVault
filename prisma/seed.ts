import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { config as loadEnv } from "dotenv";
import { PERMISSION_CATALOGUE, findDuplicatePermissionKeys } from "../modules/catalogue";
import {
  CRM_SALES_PERMISSIONS,
  CRM_SALES_ROLE,
} from "../modules/crm/contracts/permissions";
import { DEFAULT_STAGES } from "../modules/crm/domain/pipeline";
import {
  ERP_ACCOUNTANT_PERMISSIONS,
  ERP_ACCOUNTANT_ROLE,
  ERP_FINANCE_ADMIN_PERMISSIONS,
  ERP_FINANCE_ADMIN_ROLE,
} from "../modules/erp/contracts/permissions";
import { DEFAULT_CHART } from "../modules/erp/domain/chart";
import {
  DEFAULT_NUMBER_SERIES,
  DEFAULT_PAYMENT_METHODS,
  DEFAULT_RECEIVABLE_ACCOUNT_CODE,
} from "../modules/erp/domain/ar-defaults";
import { DEFAULT_NORMAL_BALANCE } from "../modules/erp/contracts/types";
import { MESSAGING_MEMBER_PERMISSIONS } from "../modules/messaging/contracts/permissions";
import {
  INNOVATION_ADMIN_PERMISSIONS,
  INNOVATION_ADMIN_ROLE,
  INNOVATION_MEMBER_PERMISSIONS,
} from "../modules/innovation/contracts/permissions";
import { INNOVATION_DEFAULT_CATEGORIES } from "../modules/innovation/domain/categories";
import {
  IAM_PERMISSIONS,
  PLATFORM_PERMISSIONS,
  SYSTEM_ROLES,
} from "../platform/iam/permissions";

/**
 * Seeds the permission catalogue, the system roles and the root organisational
 * unit.
 *
 * Idempotent: safe to run repeatedly. Permissions are upserted by key so a
 * renamed description updates in place, and role-permission links are
 * reconciled rather than duplicated.
 *
 * This script deliberately does NOT create a user. Accounts are created through
 * Supabase Auth and then linked; inventing an admin with a known password would
 * be a backdoor shipped in the repository.
 */

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined || connectionString === "") {
  throw new Error("DATABASE_URL is required to seed the database.");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/** Which permissions each system role grants. */
const ROLE_DEFINITIONS: Record<
  string,
  { name: string; description: string; permissions: string[] }
> = {
  [SYSTEM_ROLES.PLATFORM_ADMIN]: {
    name: "Platform administrator",
    description:
      "Full administrative control, including granting roles. Assign sparingly — this role can change what everyone else may do.",
    // Every permission in the catalogue, explicitly. There is no implication
    // between actions in the evaluator, so an admin role must enumerate them.
    permissions: PERMISSION_CATALOGUE.map((permission) => permission.key),
  },
  [SYSTEM_ROLES.IAM_ADMIN]: {
    name: "Identity administrator",
    description: "Manages users, roles and organisational structure.",
    permissions: [
      IAM_PERMISSIONS.ACCESS,
      IAM_PERMISSIONS.USER_READ,
      IAM_PERMISSIONS.USER_CREATE,
      IAM_PERMISSIONS.USER_UPDATE,
      IAM_PERMISSIONS.USER_ADMINISTER,
      IAM_PERMISSIONS.ROLE_READ,
      IAM_PERMISSIONS.PERMISSION_READ,
      IAM_PERMISSIONS.ORG_UNIT_READ,
      IAM_PERMISSIONS.ORG_UNIT_CREATE,
      IAM_PERMISSIONS.ORG_UNIT_UPDATE,
      IAM_PERMISSIONS.GROUP_READ,
      IAM_PERMISSIONS.GROUP_ADMINISTER,
      IAM_PERMISSIONS.LOGIN_HISTORY_READ,
    ],
  },
  [SYSTEM_ROLES.AUDITOR]: {
    name: "Auditor",
    description:
      "Read-only access to the audit trail and access configuration. Cannot change anything — which is what makes the role useful for assurance.",
    permissions: [
      IAM_PERMISSIONS.ACCESS,
      IAM_PERMISSIONS.USER_READ,
      IAM_PERMISSIONS.ROLE_READ,
      IAM_PERMISSIONS.PERMISSION_READ,
      IAM_PERMISSIONS.ORG_UNIT_READ,
      IAM_PERMISSIONS.LOGIN_HISTORY_READ,
      PLATFORM_PERMISSIONS.AUDIT_READ,
      PLATFORM_PERMISSIONS.AUDIT_EXPORT,
    ],
  },
  [CRM_SALES_ROLE]: {
    name: "Sales",
    description:
      "Works leads, contacts, companies and opportunities, and logs activity. Cannot change how the pipeline is configured.",
    permissions: [
      ...CRM_SALES_PERMISSIONS,
      ...MESSAGING_MEMBER_PERMISSIONS,
      ...INNOVATION_MEMBER_PERMISSIONS,
    ],
  },
  [INNOVATION_ADMIN_ROLE]: {
    name: "Think Tank admin",
    description:
      "Manages THE THINK TANK: reviews and assigns ideas, curates knowledge, runs projects and maintains categories.",
    permissions: [...INNOVATION_ADMIN_PERMISSIONS, ...MESSAGING_MEMBER_PERMISSIONS],
  },
  [ERP_FINANCE_ADMIN_ROLE]: {
    name: "Finance administrator",
    description:
      "Runs ERP finance: the chart of accounts, cost centres, accounting periods (including closing and reopening them) and the journal.",
    permissions: [...ERP_FINANCE_ADMIN_PERMISSIONS, ...MESSAGING_MEMBER_PERMISSIONS],
  },
  [ERP_ACCOUNTANT_ROLE]: {
    name: "Accountant",
    description:
      "Records, posts and reverses journal entries and maintains accounts and cost centres. Cannot create, close or reopen accounting periods, or deactivate accounts.",
    permissions: [...ERP_ACCOUNTANT_PERMISSIONS, ...MESSAGING_MEMBER_PERMISSIONS],
  },
  [SYSTEM_ROLES.EMPLOYEE]: {
    name: "Employee",
    description:
      "The baseline role every member of staff receives: messaging with colleagues, and no administrative access. Module access is added by assigning further roles.",
    permissions: [...MESSAGING_MEMBER_PERMISSIONS, ...INNOVATION_MEMBER_PERMISSIONS],
  },
};

async function main(): Promise<void> {
  const duplicates = findDuplicatePermissionKeys();
  if (duplicates.length > 0) {
    throw new Error(
      `Duplicate permission keys in the catalogue: ${duplicates.join(", ")}. ` +
        `Two modules cannot claim the same key.`,
    );
  }

  process.stdout.write("Seeding permissions…\n");
  for (const permission of PERMISSION_CATALOGUE) {
    await prisma.permission.upsert({
      where: { key: permission.key },
      create: {
        key: permission.key,
        module: permission.module,
        resource: permission.resource,
        action: permission.action,
        description: permission.description,
        isSensitive: permission.isSensitive ?? false,
      },
      update: {
        module: permission.module,
        resource: permission.resource,
        action: permission.action,
        description: permission.description,
        isSensitive: permission.isSensitive ?? false,
      },
    });
  }
  process.stdout.write(`  ${PERMISSION_CATALOGUE.length} permissions\n`);

  process.stdout.write("Seeding root organisational unit…\n");
  await prisma.organizationalUnit.upsert({
    where: { key: "root" },
    create: { key: "root", name: "Organisation", path: "/root", depth: 0 },
    update: {},
  });

  process.stdout.write("Seeding system roles…\n");
  for (const [key, definition] of Object.entries(ROLE_DEFINITIONS)) {
    const role = await prisma.role.upsert({
      where: { key },
      create: {
        key,
        name: definition.name,
        description: definition.description,
        isSystem: true,
      },
      update: { name: definition.name, description: definition.description },
      select: { id: true },
    });

    const permissions = await prisma.permission.findMany({
      where: { key: { in: definition.permissions } },
      select: { id: true, key: true },
    });

    const missing = definition.permissions.filter(
      (wanted) => !permissions.some((permission) => permission.key === wanted),
    );
    if (missing.length > 0) {
      throw new Error(
        `Role "${key}" references permissions that are not in the catalogue: ${missing.join(", ")}`,
      );
    }

    // Reconcile rather than append, so removing a permission from a role
    // definition actually removes it.
    await prisma.rolePermission.deleteMany({
      where: { roleId: role.id, permissionId: { notIn: permissions.map((p) => p.id) } },
    });

    for (const permission of permissions) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        create: { roleId: role.id, permissionId: permission.id },
        update: {},
      });
    }

    process.stdout.write(`  ${key}: ${permissions.length} permissions\n`);
  }

  process.stdout.write("Seeding CRM pipeline stages...\n");
  for (const stage of DEFAULT_STAGES) {
    // Create only: once a stage exists it is configuration an administrator may
    // have renamed or re-weighted, and a re-seed must not overwrite that.
    await prisma.crmOpportunityStage.upsert({
      where: { key: stage.key },
      create: { ...stage },
      update: {},
    });
  }
  process.stdout.write(`  ${DEFAULT_STAGES.length} stages\n`);

  process.stdout.write("Seeding Think Tank categories...\n");
  // Create only: administrators rename, reorder and archive categories, and a
  // re-seed must not undo that.
  for (const [kind, names] of Object.entries(INNOVATION_DEFAULT_CATEGORIES)) {
    const categoryKind = kind as "IDEA" | "KNOWLEDGE";
    let order = 0;
    for (const name of names) {
      order += 1;
      const existing = await prisma.innovationCategory.findFirst({
        where: { kind: categoryKind, name: { equals: name, mode: "insensitive" } },
        select: { id: true },
      });
      if (existing === null) {
        await prisma.innovationCategory.create({
          data: { kind: categoryKind, name, sortOrder: order },
        });
      }
    }
  }

  process.stdout.write("Seeding the starter chart of accounts...\n");
  // Create only, parents before children (DEFAULT_CHART is ordered that way): finance
  // administrators rename, restructure and deactivate accounts, and a re-seed must
  // not undo that. No periods or cost centres are seeded — both are organisation-
  // specific.
  let accountsCreated = 0;
  for (const account of DEFAULT_CHART) {
    const existing = await prisma.erpAccount.findUnique({
      where: { code: account.code },
      select: { id: true },
    });
    if (existing !== null) continue;
    const parent =
      account.parentCode === null
        ? null
        : await prisma.erpAccount.findUnique({
            where: { code: account.parentCode },
            select: { id: true },
          });
    await prisma.erpAccount.create({
      data: {
        code: account.code,
        name: account.name,
        nameAr: account.nameAr,
        type: account.type,
        normalBalance: DEFAULT_NORMAL_BALANCE[account.type],
        parentId: parent?.id ?? null,
        isPostable: account.isPostable,
      },
    });
    accountsCreated += 1;
  }
  process.stdout.write(
    `  ${accountsCreated} of ${DEFAULT_CHART.length} accounts created\n`,
  );

  process.stdout.write("Seeding accounts receivable configuration...\n");
  // Create only: numbering, payment methods and AR settings are an administrator's to
  // change, and a re-seed must not undo that. No tax rates are seeded.
  for (const series of DEFAULT_NUMBER_SERIES) {
    await prisma.erpNumberSeries.upsert({
      where: { documentType: series.documentType },
      create: { ...series },
      update: {},
    });
  }
  for (const method of DEFAULT_PAYMENT_METHODS) {
    await prisma.erpPaymentMethod.upsert({
      where: { code: method.code },
      create: { ...method },
      update: {},
    });
  }
  const receivable = await prisma.erpAccount.findUnique({
    where: { code: DEFAULT_RECEIVABLE_ACCOUNT_CODE },
    select: { id: true, type: true, isPostable: true },
  });
  await prisma.erpArSettings.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      defaultReceivableAccountId:
        receivable !== null && receivable.type === "ASSET" && receivable.isPostable
          ? receivable.id
          : null,
    },
    update: {},
  });
  process.stdout.write(
    `  ${DEFAULT_NUMBER_SERIES.length} number series, ${DEFAULT_PAYMENT_METHODS.length} payment methods, settings\n`,
  );

  process.stdout.write("Seeding security policies…\n");
  const policies: { key: string; value: unknown; description: string }[] = [
    {
      key: "password.minLength",
      value: 12,
      description: "Minimum password length enforced at sign-up and reset.",
    },
    {
      key: "session.idleTimeoutMinutes",
      value: 60,
      description: "Idle time before a session must be re-established.",
    },
    {
      key: "mfa.required",
      value: false,
      description:
        "Whether multi-factor authentication is mandatory. Kept as policy data so enabling MFA is configuration, not a deploy.",
    },
  ];
  for (const policy of policies) {
    await prisma.securityPolicy.upsert({
      where: { key: policy.key },
      create: {
        key: policy.key,
        value: policy.value as never,
        description: policy.description,
      },
      update: { description: policy.description },
    });
  }

  process.stdout.write("\nSeed complete.\n");
  process.stdout.write(
    "No user accounts were created. Create one in Supabase Auth, then insert the\n" +
      "matching iam.users row with the same id and grant it the platform-admin role.\n",
  );
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`Seed failed: ${String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
