# TechVault

A modular enterprise platform unifying CRM, ERP, ECM, HRIS, innovation management, identity
and analytics behind one product experience.

**[CLAUDE.md](./CLAUDE.md) is the architectural contract.** Read it before changing
anything — it defines module boundaries, the permission model, the database conventions and
the rules every change must follow. §28 is the authoritative implementation status.

## Current state

**Phase 0 and Phase 1 are fully done and verified against a live database**: Supabase in
eu-west-1, four migrations applied (including deny-by-default row-level security and an
append-only audit trigger), seed run, and a real administrator account created and
verified — anyone with that account can sign in today.

| Suite                                        | Result      |
| -------------------------------------------- | ----------- |
| `npm run verify` (typecheck → lint → test)   | 107 passing |
| Integration vs PostgreSQL (local by default) | 35 passing  |
| Playwright e2e vs running app + Supabase     | 7 passing   |
| `npm run build`                              | 10 routes   |

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

### Creating another administrator (or the first one, on a fresh environment)

The seed deliberately creates no user account — a seeded admin password would be a backdoor
committed to the repository. Two steps, once per environment:

1. In the Supabase dashboard, go to **Authentication → Users → Add user**, create the
   account with a password, and copy its **User UID**.
2. Link it to IAM and grant full administrative access:

```bash
npm run db:bootstrap-admin -- --id <user-uid> --email you@example.com --name "Your Name"
```

Then `npm run dev` and sign in at http://localhost:3000/login.

### Connecting to Supabase

Both `DATABASE_URL` and `DIRECT_URL` use the **session pooler** (port 5432), not
`db.<ref>.supabase.co`. That direct host publishes only an `AAAA` record, so any machine
without routable IPv6 cannot reach it at all. Do not switch to the transaction pooler on
6543: it breaks migrations and Prisma's prepared statements. Details in CLAUDE.md §23.

## Commands

| Command                      | What it does                                         |
| ---------------------------- | ---------------------------------------------------- |
| `npm run dev`                | Development server                                   |
| `npm run verify`             | **The gate**: typecheck → lint → test. Must pass.    |
| `npm run build`              | Production build                                     |
| `npm run test`               | Unit, authorization and (if configured) integration  |
| `npm run test:integration`   | Integration suite against the local test database    |
| `npm run test:e2e`           | Playwright against a running app                     |
| `npm run db:migrate`         | Create and apply a migration (review the diff first) |
| `npm run db:deploy`          | Apply pending migrations (no schema diffing)         |
| `npm run db:seed`            | Idempotent seed                                      |
| `npm run db:bootstrap-admin` | Link a Supabase user and grant `platform-admin`      |
| `npm run db:studio`          | Prisma Studio                                        |
| `npm run format`             | Prettier                                             |

### Running the integration tests

```bash
npm run test:integration
```

This reads `TEST_DATABASE_URL` from `.env.local`, which points at a **local** PostgreSQL
database `techvault_test` — isolated from the Supabase development data and ~6x faster than
reaching eu-west-1 (9s vs 55s).

`TEST_DATABASE_URL` is a **separate variable** from `DATABASE_URL` on purpose: these tests
`TRUNCATE` every IAM and platform table, so pointing them at real data must be a deliberate
act. Never aim it at Supabase or production.

To recreate the test database from scratch:

```bash
psql -U postgres -c "CREATE DATABASE techvault_test"
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/techvault_test" npx prisma migrate deploy
```

## Architecture in one minute

A **modular monolith**: one Next.js app, one PostgreSQL database, one schema per module
(`iam`, `platform`, and later `crm`, `erp`, `ecm`, `hris`, `innovation`, `bi`).

- Business logic lives in `modules/<domain>/`; a module's `contracts/` is its only public
  surface. `services/` and `repositories/` are private.
- Cross-cutting capabilities live in `platform/` and never import a module.
- Every authorization decision comes from `platform/authz`. No module implements its own.
- These boundaries are enforced by ESLint, not by convention — see `eslint.config.mjs`.

## Security

Never commit `.env*` (only `.env.local.example`). The Supabase secret/service-role key is
server-only and is currently **not configured**, because nothing needs it yet. See
CLAUDE.md §18.
