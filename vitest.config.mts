import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Node environment: these suites cover business logic and services, not DOM
    // rendering. Component tests, when they arrive, get their own project.
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],

    // Integration suites are INCLUDED but gate themselves on TEST_DATABASE_URL
    // (see tests/integration/helpers/db.ts). With no test database configured they
    // report as skipped, so `npm run verify` stays runnable by anyone who has just
    // cloned the repository — while the suites stay visible rather than forgotten
    // behind an exclusion.
    //
    // They TRUNCATE tables. TEST_DATABASE_URL is deliberately a separate variable
    // from DATABASE_URL so aiming them at a real database is never an accident.
    exclude: ["node_modules/**", "tests/e2e/**"],

    // Integration suites share one database, so they must not run concurrently
    // against it: one suite's truncation would wipe another's fixtures mid-test.
    fileParallelism: process.env.TEST_DATABASE_URL === undefined,

    // A remote Postgres costs a few hundred milliseconds per round trip, so a
    // fixture-heavy integration test legitimately exceeds the 5s default. Unit
    // suites keep the tight default: a slow pure-logic test is a real smell.
    testTimeout: process.env.TEST_DATABASE_URL !== undefined ? 60_000 : 5_000,
    hookTimeout: process.env.TEST_DATABASE_URL !== undefined ? 60_000 : 10_000,

    reporters: ["default"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
});
