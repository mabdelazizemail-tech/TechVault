import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

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
  // Prisma 7's config exposes only `url` (and `shadowDatabaseUrl`). Against a
  // pooled Supabase connection, point DATABASE_URL at the DIRECT connection
  // when running migrations — see .env.local.example.
  //
  // Omitted when DATABASE_URL is unset: `prisma generate` runs on every install
  // (including CI and Vercel, before any secret exists) and needs no database.
  // Migrate and introspect still fail loudly without it.
  datasource:
    process.env.DATABASE_URL === undefined
      ? undefined
      : { url: process.env.DATABASE_URL },
});
