/**
 * Global Vitest setup.
 *
 * Two jobs:
 *
 * 1. Make app modules IMPORTABLE in every suite. `lib/prisma` constructs its
 *    client at import time, which validates configuration — so a suite that
 *    merely imports a service would fail to load without these values. The
 *    Postgres pool is lazy, so a placeholder connection string costs nothing
 *    until a query actually runs.
 *
 * 2. Point the app's Prisma singleton at the TEST database when one is
 *    configured. `TEST_DATABASE_URL` is a SEPARATE variable from `DATABASE_URL`
 *    on purpose: the integration suite truncates tables, so aiming it at a real
 *    database must be a deliberate act, never an accident of having a development
 *    connection in the environment.
 *
 * With `TEST_DATABASE_URL` unset, integration suites skip themselves and the unit
 * suites run unaffected.
 */

const PLACEHOLDER_DATABASE_URL =
  "postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder";

process.env.DATABASE_URL ??= PLACEHOLDER_DATABASE_URL;
process.env.APP_URL ??= "http://localhost:3000";
process.env.APP_ENV ??= "development";
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "sb_publishable_test";
process.env.LOG_LEVEL ??= "error";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (testDatabaseUrl !== undefined && testDatabaseUrl !== "") {
  // Deliberate override: integration tests must exercise the real services, and
  // those use the application's Prisma singleton.
  process.env.DATABASE_URL = testDatabaseUrl;
}
