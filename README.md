# TechVault

A modular enterprise platform unifying CRM, ERP, ECM, HRIS, innovation management, identity
and analytics behind one product experience.

**[CLAUDE.md](./CLAUDE.md) is the architectural contract.** Read it before changing
anything — it defines module boundaries, the permission model, the database conventions and
the rules every change must follow. §28 is the authoritative implementation status.

## Current state

Phase 0 (foundation) is complete. Phase 1 (identity, audit, app shell) is code-complete but
**has never run against a database** — no Supabase project is provisioned yet.

```bash
npm run verify
```

passes: typecheck, lint, and 101 tests. That proves the code compiles and the pure logic is
correct; it proves nothing about database-backed behaviour.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript 5.9 strict · Tailwind 4 · Prisma 7 with the
`pg` driver adapter · PostgreSQL (Supabase) · Supabase Auth · Zod · Vitest · Playwright.

Versions are pinned exactly. **Read the upgrade hazards in CLAUDE.md §3 before bumping
anything** — TypeScript must stay below 6.1 and ESLint on 9.x, or linting breaks.

## Getting started

```bash
npm install
cp .env.local.example .env.local   # then fill in real values
npx prisma generate
npm run dev
```

### Bringing up the database (not yet done)

1. Create a Supabase project; copy the connection strings and keys into `.env.local`.
2. Generate and apply the first migration. Because Prisma 7 reads only `DATABASE_URL`, use
   the direct (non-pooled) connection for migrations:
   ```bash
   DATABASE_URL="$DIRECT_URL" npx prisma migrate dev --name init
   ```
3. Seed the permission catalogue, system roles and root organisational unit:
   ```bash
   npm run db:seed
   ```
4. Create your user in Supabase Auth, then insert the matching `iam.users` row using the
   **same id** and grant it the `platform-admin` role. The seed deliberately creates no
   account — a seeded admin password would be a backdoor committed to the repository.

## Commands

| Command              | What it does                                           |
| -------------------- | ------------------------------------------------------ |
| `npm run dev`        | Development server                                     |
| `npm run verify`     | **The gate**: typecheck → lint → test. Must pass.      |
| `npm run build`      | Production build                                       |
| `npm run test`       | Unit and authorization suites                          |
| `npm run test:e2e`   | Playwright (needs a running app and a seeded database) |
| `npm run db:migrate` | Create and apply a migration (review the diff first)   |
| `npm run db:seed`    | Idempotent seed                                        |
| `npm run db:studio`  | Prisma Studio                                          |
| `npm run format`     | Prettier                                               |

## Architecture in one minute

A **modular monolith**: one Next.js app, one PostgreSQL database, one schema per module
(`iam`, `platform`, and later `crm`, `erp`, `ecm`, `hris`, `innovation`, `bi`).

- Business logic lives in `modules/<domain>/`; a module's `contracts/` is its only public
  surface. `services/` and `repositories/` are private.
- Cross-cutting capabilities live in `platform/` and never import a module.
- Every authorization decision comes from `platform/authz`. No module implements its own.
- These boundaries are enforced by ESLint, not by convention — see `eslint.config.mjs`.

## Security

Never commit `.env*` (only `.env.local.example`). The Supabase service-role key is
server-only; if it ever reaches a client bundle, rotate it. See CLAUDE.md §18.
