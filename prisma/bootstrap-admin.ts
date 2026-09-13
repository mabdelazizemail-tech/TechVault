import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { config as loadEnv } from "dotenv";
import { z } from "zod";
import { SYSTEM_ROLES } from "../platform/iam/permissions";

/**
 * Links an existing Supabase Auth user to IAM and grants it `platform-admin`.
 *
 * Run once, after `npm run db:seed`:
 *
 *   npm run db:bootstrap-admin -- --id <supabase-user-uuid> --email you@example.com \
 *     --name "Your Name"
 *
 * Deliberately does NOT create the Supabase Auth account. Creating accounts and
 * setting passwords is done by a person in the Supabase dashboard: a script that
 * provisions credentials needs the privileged secret key, and an account with a
 * script-chosen password is a backdoor. Create the user there first, copy its UUID
 * from Authentication → Users, and pass it here.
 *
 * Idempotent: safe to re-run. It will not silently change an existing user's email.
 */

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

const argsSchema = z.object({
  id: z.string().uuid("--id must be the Supabase user's UUID"),
  email: z.string().email("--email must be a valid address"),
  name: z.string().trim().min(1).optional(),
});

function parseArgs(argv: string[]): z.infer<typeof argsSchema> {
  const raw: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined || !token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    raw[key] = value;
    index += 1;
  }

  const parsed = argsSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(args)"}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Invalid arguments:\n${problems}\n\n` +
        `Usage: npm run db:bootstrap-admin -- --id <uuid> --email <address> [--name "Full Name"]`,
    );
  }
  return parsed.data;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const connectionString = process.env.DATABASE_URL;
  if (connectionString === undefined || connectionString === "") {
    throw new Error("DATABASE_URL is required.");
  }
  if (connectionString.includes("[YOUR-PASSWORD]")) {
    throw new Error(
      "DATABASE_URL still contains the [YOUR-PASSWORD] placeholder. Replace it " +
        "with the real database password in .env.local first.",
    );
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  try {
    const role = await prisma.role.findUnique({
      where: { key: SYSTEM_ROLES.PLATFORM_ADMIN },
      select: { id: true, key: true, _count: { select: { permissions: true } } },
    });

    if (role === null) {
      throw new Error(
        `The "${SYSTEM_ROLES.PLATFORM_ADMIN}" role does not exist. ` +
          `Run \`npm run db:seed\` first.`,
      );
    }

    const rootUnit = await prisma.organizationalUnit.findUnique({
      where: { key: "root" },
      select: { id: true },
    });

    const existing = await prisma.user.findUnique({
      where: { id: args.id },
      select: { id: true, email: true },
    });

    if (existing !== null && existing.email !== args.email) {
      // Changing the email of an existing account is a real administrative act
      // with audit implications; it is not this script's job to do it quietly.
      throw new Error(
        `A user with id ${args.id} already exists with a different email address. ` +
          `Change it through the admin console, not this script.`,
      );
    }

    await prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { id: args.id },
        create: {
          // The id MUST equal the Supabase auth.users.id (CLAUDE.md §11.1).
          id: args.id,
          email: args.email,
          fullName: args.name ?? null,
          orgUnitId: rootUnit?.id ?? null,
          isActive: true,
        },
        update: {
          fullName: args.name ?? undefined,
          isActive: true,
        },
        select: { id: true, email: true },
      });

      // Not an upsert: Prisma cannot express `null` inside a compound unique
      // `where`, because a nullable column in a unique constraint is not
      // addressable that way. Find-then-create keeps the script idempotent.
      const existingGrant = await tx.userRole.findFirst({
        where: {
          userId: user.id,
          roleId: role.id,
          scopeType: "GLOBAL",
          scopeOrgUnitId: null,
        },
        select: { id: true },
      });

      if (existingGrant === null) {
        await tx.userRole.create({
          data: {
            userId: user.id,
            roleId: role.id,
            scopeType: "GLOBAL",
          },
        });
      }

      await tx.auditLog.create({
        data: {
          actorId: null,
          actorLabel: "bootstrap-admin-script",
          action: "iam.user.bootstrapped",
          module: "iam",
          entityType: "User",
          entityId: user.id,
          summary: `Bootstrapped ${user.email} as ${role.key}`,
          changes: { roleKey: role.key, scopeType: "GLOBAL" },
          // Granting full administrative control is the highest-severity event
          // the platform can record.
          severity: "CRITICAL",
        },
      });
    });

    process.stdout.write(
      `\nLinked ${args.email} (${args.id}) and granted "${role.key}" ` +
        `(${role._count.permissions} permissions).\n` +
        `Audit record written.\n\n` +
        `Next: npm run dev, then sign in at http://localhost:3000/login\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `\nBootstrap failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
