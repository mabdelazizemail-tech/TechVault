import { config as loadEnv } from "dotenv";
import { defineConfig, env } from "prisma/config";

// `.env.local` is the house convention for local credentials (and is gitignored);
// `.env` is the fallback so CI can provide values however it prefers.
loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

/**
 * Prisma 7 configuration.
 *
 * `schema` points at the DIRECTORY, not a single file — Prisma only loads
 * `.prisma` files from this directory, and `schema.prisma` (holding the
 * generator and datasource blocks) must sit at its top level. Pointing this at
 * a single file silently produces a client with no models.
 */
export default defineConfig({
  schema: "prisma/",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Prisma 7's config exposes only `url` (and `shadowDatabaseUrl`). Against a
    // pooled Supabase connection, point DATABASE_URL at the DIRECT connection
    // when running migrations — see .env.local.example.
    url: env("DATABASE_URL"),
  },
});
