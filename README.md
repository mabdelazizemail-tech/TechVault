# TechVault

A modular enterprise platform unifying CRM, ERP, ECM, HRIS, innovation management, identity
and analytics behind one product experience.

**[CLAUDE.md](./CLAUDE.md) is the architectural contract.** Read it before changing
anything — it defines module boundaries, the permission model, the database conventions and
the rules every change must follow. §28 is the authoritative implementation status.

## Current state

Phase 0 (foundation) and Phase 1 (identity, audit, app shell) are complete and **verified
against a live database**: Supabase in eu-west-1, three migrations applied, seed run.

| Suite                                      | Result      |
| ------------------------------------------ | ----------- |
| `npm run verify` (typecheck → lint → test) | 107 passing |
| Integration vs live PostgreSQL 17.6        | 27 passing  |
| Playwright e2e vs running app + Supabase   | 7 passing   |
| `npm run build`                            | 10 routes   |

**One step remains before anyone can sign in:** no administrator account exists yet. See
"Create the first administrator" below.

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

### Create the first administrator

The seed deliberately creates no user account — a seeded admin password would be a backdoor
committed to the repository. Two steps, once:

1. In the Supabase dashboard, go to **Authentication → Users → Add user**, create your
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
| `npm run test:e2e`           | Playwright against a running app                     |
| `npm run db:migrate`         | Create and apply a migration (review the diff first) |
| `npm run db:deploy`          | Apply pending migrations (no schema diffing)         |
| `npm run db:seed`            | Idempotent seed                                      |
| `npm run db:bootstrap-admin` | Link a Supabase user and grant `platform-admin`      |
| `npm run db:studio`          | Prisma Studio                                        |
| `npm run format`             | Prettier                                             |

### Running the integration tests

They are part of `npm run test` but skip themselves unless a test database is configured:

```bash
TEST_DATABASE_URL="<connection string>" npm run test
```

`TEST_DATABASE_URL` is a **separate variable** from `DATABASE_URL` on purpose: these tests
`TRUNCATE` every IAM and platform table. Point it at a dedicated database or a Supabase
branch — never production, and never a database holding real data.

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
