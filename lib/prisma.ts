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
  const adapter = new PrismaPg({
    connectionString: env.databaseUrl,
    max: poolSize(env.databaseUrl, env.appEnv),
    idleTimeoutMillis: 5_000,
  });

  return new PrismaClient({
    adapter,
    log: env.appEnv === "development" ? ["warn", "error"] : ["error"],
  });
}

/**
 * Connections each process may hold.
 *
 * Supabase's session pooler (5432) holds one server connection per client and
 * caps the project at 15, and on Vercel every function instance opens its own
 * pool: the `pg` default of 10 exhausted that cap with two warm instances
 * (§23). The transaction pooler (6543) multiplexes clients over a few server
 * connections, so a larger pool is safe there and stops a page's parallel
 * queries from queueing. Decided from the URL itself rather than assumed, so a
 * session-pooler URL can never get the larger pool.
 */
function poolSize(databaseUrl: string, appEnv: string): number {
  const port = URL.canParse(databaseUrl) ? new URL(databaseUrl).port : "";
  if (port === "6543") return 10;
  return appEnv === "development" ? 5 : 2;
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function getPrismaClient(): PrismaClient {
  const client = globalForPrisma.prisma ?? createPrismaClient();
  globalForPrisma.prisma = client;
  return client;
}

/**
 * Created on first use, not on import. `next build` imports every route to
 * collect page data, and a build must never need real credentials (§18.1): an
 * eager client read DATABASE_URL at import and failed any build without it.
 * The proxy keeps the `prisma.model.method()` call shape for every caller.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getPrismaClient();
    const value: unknown = Reflect.get(client, property, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

/**
 * The transaction-scoped client type. Services that must write a business change,
 * its audit entry and its outbox event atomically accept this so every write
 * joins the same transaction (CLAUDE.md §19.2).
 */
export type PrismaTransaction = Parameters<
  Parameters<PrismaClient["$transaction"]>[0]
>[0];
