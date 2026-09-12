import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { serverEnv } from "@/platform/config/env";

/**
 * The single Prisma client for the process.
 *
 * Prisma 7 connects through a driver adapter rather than an embedded engine, so
 * the Postgres connection is owned by `@prisma/adapter-pg`. The connection string
 * comes from validated configuration rather than the ambient environment, so a
 * misconfigured deployment fails loudly at startup.
 *
 * Cached on `globalThis` in development so Next.js hot reloading does not open a
 * new connection pool on every edit.
 *
 * Repositories use this. Nothing else should: services go through repositories,
 * and no module may query another module's tables (CLAUDE.md §5).
 */
function createPrismaClient(): PrismaClient {
  const env = serverEnv();
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

  return new PrismaClient({
    adapter,
    log: env.APP_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/**
 * The transaction-scoped client type. Services that must write a business change,
 * its audit entry and its outbox event atomically accept this so every write
 * joins the same transaction (CLAUDE.md §19.2).
 */
export type PrismaTransaction = Parameters<
  Parameters<PrismaClient["$transaction"]>[0]
>[0];
