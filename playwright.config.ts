import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end configuration (CLAUDE.md §20).
 *
 * E2E covers critical user journeys in a real browser. It needs a running app and
 * a seeded database, so it is NOT part of `npm run verify` — it runs as its own CI
 * job once a test database is configured.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  // A test that only passes on the second attempt is a flaky test, and flaky
  // tests teach people to ignore failures. Retries only in CI, and only one.
  retries: process.env.CI !== undefined ? 1 : 0,
  reporter: process.env.CI !== undefined ? "github" : "list",
  timeout: 30_000,

  use: {
    baseURL: process.env.APP_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // Operators use tablets on the floor; the layout must hold up there (§16.7).
    { name: "tablet", use: { ...devices["iPad (gen 7)"] } },
  ],

  webServer: {
    command: "npm run dev",
    url: process.env.APP_URL ?? "http://localhost:3000",
    reuseExistingServer: process.env.CI === undefined,
    timeout: 120_000,
  },
});
