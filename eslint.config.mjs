import js from "@eslint/js";
import tseslint from "typescript-eslint";
import next from "eslint-config-next/core-web-vitals";

/**
 * TechVault lint configuration.
 *
 * The module-boundary rules below are not style preferences — they are how the
 * architecture in CLAUDE.md §4 is actually enforced. A human promise is not an
 * architecture. If a rule blocks you, the design is wrong, not the rule:
 * move the code, or expose what you need through the owning module's contracts.
 */

/** Every domain module. Adding a module here is what turns on its boundary rules. */
const MODULES = ["iam", "crm", "erp", "ecm", "hris", "innovation", "bi"];

/** Paths inside a module that are private to it. */
const PRIVATE_SEGMENTS = ["services", "repositories", "events"];

const PUBLIC_SURFACE_MESSAGE =
  "Module internals are private. Import the owning module's public surface " +
  "instead: '@/modules/<module>' or '@/modules/<module>/contracts/*'. " +
  "See CLAUDE.md §4 and §5.";

/**
 * For each module, forbid reaching into every OTHER module's private folders.
 * A module may of course import its own internals, so the patterns are built
 * per-module rather than as one blanket rule.
 */
const moduleBoundaryConfigs = MODULES.map((self) => {
  const others = MODULES.filter((other) => other !== self);
  const patterns = others.flatMap((other) =>
    PRIVATE_SEGMENTS.flatMap((segment) => [
      `@/modules/${other}/${segment}`,
      `@/modules/${other}/${segment}/*`,
      `@/modules/${other}/${segment}/**`,
      // Relative paths must not be an escape hatch.
      `**/modules/${other}/${segment}/**`,
    ]),
  );

  return {
    name: `techvault/boundaries/modules-${self}`,
    files: [`modules/${self}/**/*.{ts,tsx}`],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: patterns, message: PUBLIC_SURFACE_MESSAGE },
            {
              group: ["@/app/*", "@/app/**", "**/app/**"],
              message:
                "Modules must not depend on the app/ routing layer — the dependency " +
                "runs the other way (CLAUDE.md §4).",
            },
          ],
        },
      ],
    },
  };
});

export default tseslint.config(
  {
    name: "techvault/ignores",
    ignores: [
      ".next/**",
      "out/**",
      "node_modules/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "prisma/migrations/**",
      "next-env.d.ts",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...next,

  {
    name: "techvault/language",
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  {
    name: "techvault/typescript",
    files: ["**/*.{ts,tsx}"],
    rules: {
      // Type safety (CLAUDE.md §19.5).
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],

      // Error handling (CLAUDE.md §19.3): never swallow an error.
      "no-empty": ["error", { allowEmptyCatch: false }],

      // Logging (CLAUDE.md §19.4): structured logger only.
      "no-console": "error",

      // Encourages the typed-error pattern over ad-hoc throws of strings.
      "no-throw-literal": "error",

      eqeqeq: ["error", "always", { null: "ignore" }],
      "prefer-const": "error",
      "no-var": "error",
    },
  },

  ...moduleBoundaryConfigs,

  {
    name: "techvault/boundaries/platform",
    files: ["platform/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/modules/*", "@/modules/**", "**/modules/**"],
              message:
                "Platform services are generic and must not depend on any domain " +
                "module. Invert the dependency: the module calls the platform " +
                "service, passing what it needs (CLAUDE.md §4, §7).",
            },
            {
              group: ["@/app/*", "@/app/**"],
              message: "Platform services must not depend on the app/ routing layer.",
            },
          ],
        },
      ],
    },
  },

  {
    name: "techvault/boundaries/app",
    files: ["app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/modules/*/services",
                "@/modules/*/services/**",
                "@/modules/*/repositories",
                "@/modules/*/repositories/**",
              ],
              message:
                "Routes must go through a module's public surface " +
                "('@/modules/<module>' or its contracts/), not its internals. " +
                "Repositories especially: they perform no permission checks " +
                "(CLAUDE.md §9, §11.4).",
            },
          ],
        },
      ],
    },
  },

  {
    name: "techvault/boundaries/ui-primitives",
    files: ["components/ui/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/modules/**", "@/platform/**"],
              message:
                "Design-system primitives must stay free of business logic and " +
                "data access so they remain reusable (CLAUDE.md §16.3).",
            },
          ],
        },
      ],
    },
  },

  {
    name: "techvault/env-access",
    // Only the config service, and the build config that cannot use it, may read
    // process.env directly (CLAUDE.md §25.3).
    files: ["modules/**/*.{ts,tsx}", "app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message:
            "Read configuration through platform/config (serverEnv / publicEnv) so " +
            "every variable is validated in exactly one place (CLAUDE.md §18.1).",
        },
      ],
    },
  },

  {
    name: "techvault/platform-exceptions",
    files: [
      "platform/config/**/*.ts",
      "platform/observability/**/*.ts",
      "*.config.{ts,mjs,js}",
      "prisma.config.ts",
    ],
    rules: {
      "no-restricted-properties": "off",
      "no-console": "off",
    },
  },

  {
    name: "techvault/tests",
    files: ["tests/**/*.{ts,tsx}", "**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}"],
    rules: {
      // Tests legitimately reach across boundaries to set up and assert state.
      "no-restricted-imports": "off",
      "no-restricted-properties": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
