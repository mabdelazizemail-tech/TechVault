import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Node environment: the suites here cover business logic and services, not
    // DOM rendering. Component tests, when they arrive, get their own project.
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Integration suites need a real Postgres (CLAUDE.md §20) and are excluded
    // until a test database is configured, so `npm run verify` stays runnable by
    // anyone who has just cloned the repository.
    exclude: ["tests/integration/**", "node_modules/**"],
    reporters: ["default"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
});
