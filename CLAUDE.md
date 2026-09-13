# TechVault — Claude Code Instructions

> **This file is the single source of truth for developing the TechVault Ecosystem.**
> Read it fully before making any change. Where this file conflicts with a habit, a
> convention borrowed from another repository, or your own preference — this file wins.
> If a change genuinely requires contradicting this file, update this file in the same
> change and record the reasoning as an ADR in §27.

---

## 0. How to read this document

**Status legend.** Every capability below is tagged. Do not assume code exists because
it is described here.

| Tag                | Meaning                                                                              |
| ------------------ | ------------------------------------------------------------------------------------ |
| ✅ **IMPLEMENTED** | Code exists in this repository and works.                                            |
| 🟡 **PARTIAL**     | Some code exists; incomplete or not wired end-to-end.                                |
| 📋 **PLANNED**     | Agreed design, no code yet. Build it this way when you build it.                     |
| 💡 **RECOMMENDED** | Proposed by the architect, not yet ratified. Confirm with the owner before building. |

**As of 2026-09-13, Phase 0 (foundation) and Phase 1 (identity, audit, app shell) are
✅ complete and verified against a real database.** A Supabase project is provisioned
(eu-west-1), four migrations are applied (including deny-by-default RLS and an append-only
audit trigger, ADR-015), the seed has run, and the suites pass: 107 unit and authorization
tests, 35 integration tests (mostly local, ~9s), and 7 Playwright end-to-end tests against
the running app and live Supabase Auth.

**The last Phase 1 blocker is closed**: a real administrator account exists (created in
Supabase Auth, linked via `npm run db:bootstrap-admin`, verified by direct query — see §28).
Phase 1 is fully done.

**§28 holds the authoritative implementation status. Read it before trusting any claim in
this document, and update it with every change.** Phases 2–10 remain 📋 PLANNED.

**Provenance of the stack in §3.** The technology choices are not invented. They mirror
the established house stack of the sibling project `C:\Software\CaptureERP` (Next.js App
Router + TypeScript + Prisma + PostgreSQL/Supabase + Tailwind + Zod), so TechVault stays
consistent with how this team already builds. Deviations from that precedent are called
out and justified.

**Assumptions** — flagged because they drive the design. Correct them if wrong.

1. Single engineering team, small headcount, agent-assisted development.
2. Deployment to Vercel + Supabase (the CaptureERP target); self-hosted Postgres possible.
3. Users are internal employees of one organisation. Multi-tenancy is **not** a day-one
   requirement; ADR-008 keeps the door open cheaply.
4. Bilingual English/Arabic with RTL is a real requirement for this market (CaptureERP
   ships Arabic labels and an RTL dashboard). Budget for it from day one.
5. Currency is EGP by default, stored as integer minor units.

---

## 1. Project Overview

TechVault is a **modular enterprise platform** that unifies an organisation's major
operational functions — customer relationships, resource planning, content and documents,
identity, HR, innovation, and analytics — behind one coherent product experience, while
keeping each business domain independently evolvable.

It is **one application with strong internal boundaries** — not a suite of separate apps,
and not a microservice estate. See ADR-001.

**What "done well" looks like**

- A user moves from a customer record to that customer's contract to the invoice raised
  against it without ever feeling they changed systems.
- A developer adds an ERP feature without reading a line of CRM internals.
- Every business-significant write and every sensitive read is attributable to a person.
- No module can quietly reach into another module's tables.

**What failure looks like**

- A `modules/erp` file importing `modules/crm/repositories`.
- Two tables that both claim to be the real customer record.
- Authorization logic pasted into each module instead of asked of IAM.
- A "quick" direct SQL write into another domain's data.

---

## 2. Product Vision

TechVault replaces the usual organisational sprawl — a CRM here, spreadsheets there, a
shared drive of documents, HR in email — with one platform that shares identity, data,
audit, and workflow, and lets each functional domain grow at its own pace.

Non-negotiable product properties, in priority order:

1. **Correctness and auditability** over feature velocity. Financial, HR, and document
   records are evidence; they must be provably accurate and attributable.
2. **Security by default.** A feature without authorization is an unshipped feature.
3. **Coherence.** One navigation model, one component vocabulary, one terminology set.
4. **Information density without clutter.** Enterprise users live in tables and filters;
   optimise for operators, not for screenshots.
5. **Evolvability.** Boundaries exist so that in two years one domain can be extracted,
   rewritten, or scaled independently without a rescue project.
6. **AI as plumbing, not theatre.** Every AI feature respects the same permission checks
   as a human user.

Explicit non-goals for now: public self-service signup, offline-first clients, a plugin
marketplace, real-time collaborative editing.

---

## 3. Current Technology Stack

✅ **IMPLEMENTED** — installed and verified. Versions below are the exact pins in
`package.json` (all pinned, no ranges). Do not add a dependency not listed here without
an ADR, and read the compatibility notes before upgrading anything.

| Layer      | Choice                                                    | Version                  | Notes                                                                                                                 |
| ---------- | --------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Runtime    | Node.js                                                   | 24.14.0                  | `engines: >=24`. Next requires >=20.9, Prisma >=24 for the current line.                                              |
| Framework  | **Next.js** (App Router, Turbopack)                       | 16.3.5                   | Server Components by default; Server Actions for mutations.                                                           |
| UI library | React / React DOM                                         | 19.3.0                   |                                                                                                                       |
| Language   | **TypeScript**                                            | 5.9.3                    | **Pinned to 5.x deliberately — see ADR-011.** TS 7 is published but unusable here.                                    |
| Styling    | **Tailwind CSS** (CSS-first config)                       | 4.3.3                    | v4 has no `tailwind.config.js`: tokens live in `@theme` in `app/globals.css` (§17.1).                                 |
| PostCSS    | `@tailwindcss/postcss`                                    | 4.3.3                    | The only PostCSS plugin.                                                                                              |
| Primitives | `@radix-ui/react-dialog`, `@radix-ui/react-dropdown-menu` | 1.1.23 / 2.1.24          | Headless, for focus management and keyboard behaviour (§17.5).                                                        |
| Icons      | `lucide-react`                                            | 1.45.0                   |                                                                                                                       |
| ORM        | **Prisma** (multi-schema, GA)                             | 7.10.0                   | **Requires a driver adapter — see ADR-012.** Config lives in `prisma.config.ts`, not package.json.                    |
| DB driver  | `@prisma/adapter-pg`                                      | 7.10.0                   | Owns the Postgres connection. Prisma 7 has no embedded query engine.                                                  |
| Database   | **PostgreSQL** (Supabase-hosted)                          | —                        | One database, one schema per module (§8). **Do not introduce a second database technology.**                          |
| Auth       | **Supabase Auth** via `@supabase/ssr`                     | 0.12.7                   | `@supabase/supabase-js` 2.116.0. OIDC/SAML later without changing the identity model.                                 |
| Validation | **Zod**                                                   | 4.6.2                    | One schema per input, shared by action, route handler and form.                                                       |
| Forms      | `react-hook-form` + `@hookform/resolvers`                 | 7.88.0 / 5.9.1           | Installed for Phase 2 forms; Phase 1 uses `useActionState` directly.                                                  |
| Unit tests | **Vitest**                                                | 5.0.0                    | Config is `vitest.config.mts` (`.mts` so the native Vite config loader accepts ESM).                                  |
| E2E tests  | **Playwright**                                            | 1.63.0                   | Not part of `npm run verify`; needs a running app and a seeded database.                                              |
| Lint       | **ESLint** + `typescript-eslint` + `eslint-config-next`   | 9.39.5 / 8.70.0 / 16.3.5 | **Pinned to ESLint 9 — see ADR-011.** The boundary rules in `eslint.config.mjs` are how the architecture is enforced. |
| Format     | Prettier + `prettier-plugin-tailwindcss`                  | 3.9.6 / 0.8.1            | Tailwind class ordering is automatic; do not hand-sort.                                                               |
| Scripts    | `tsx`, `dotenv-cli`                                       | 4.23.13 / 11.0.0         | Seed script and env loading.                                                                                          |
| Deployment | Vercel + Supabase                                         | —                        | Vercel CLI is **not installed** — `npm i -g vercel` enables `vercel env pull`, deploys and logs.                      |

**Upgrade hazards — read before bumping anything:**

- **TypeScript must stay below 6.1.** `typescript-eslint@8` declares `typescript >=4.8.4 <6.1.0`.
  TypeScript 7.0.2 is the current `latest` on npm; installing it silently disables type-aware
  linting or breaks the lint run entirely (ADR-011).
- **ESLint must stay on 9.x.** `eslint-plugin-react` (bundled inside `eslint-config-next@16`)
  calls `context.getFilename()`, which ESLint 10 removed — every lint run crashes with
  `contextOrFilename.getFilename is not a function`. This was hit and reverted during the
  Phase 0 build-out; do not "upgrade" it back.
- **Prisma 8 is in release candidate.** Stay on 7.10.0 until it is GA and the adapter line
  matches.
- **Next 16 renamed the middleware convention.** The file is `proxy.ts` and the export is
  `proxy`, not `middleware`. `middleware.ts` still works but warns on every build.
- **Next 16 dropped the `eslint` key from `next.config.ts`.** Linting is not part of
  `next build`; `npm run verify` and CI run ESLint separately.

**Deliberately excluded**, with the trigger that would change the decision:

| Not using              | Reconsider when                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------- |
| Microservices          | A domain needs independent scaling, security isolation, or release cadence (ADR-001). |
| Kubernetes             | We outgrow managed/serverless hosting economics.                                      |
| Kafka / RabbitMQ       | Outbox throughput or cross-process fan-out becomes the bottleneck.                    |
| Redis                  | Measured cache or queue pressure Postgres cannot absorb.                              |
| Elasticsearch          | Postgres FTS fails a real relevance or latency requirement.                           |
| Separate warehouse     | Analytical load measurably harms transactional latency (§8.7).                        |
| GraphQL                | Multiple independent client teams need field-level flexibility.                       |
| tRPC                   | Server Actions stop being sufficient for internal calls.                              |
| A client state library | Server Components plus URL state stop covering real needs (§16.4).                    |

## 4. Repository Structure

✅ Actual layout as built. Directories marked 📋 do not exist yet — create them with the
code that populates them, never as empty placeholders.

```
TechVault/
├─ CLAUDE.md                     # this file — the architectural contract
├─ proxy.ts                      # ✅ session refresh + anonymous gate (Next 16 name)
├─ app/                          # ✅ App Router: routing + composition ONLY
│  ├─ (auth)/login/              #   ✅ sign-in page + form
│  ├─ auth/actions.ts            #   ✅ signIn / signOut server actions
│  ├─ (platform)/                #   ✅ authenticated shell (sidebar, header, breadcrumbs)
│  │  ├─ dashboard/              #   ✅ cross-module landing
│  │  ├─ admin/                  #   ✅ users, roles, permissions, org-units, audit
│  │  ├─ error.tsx               #   ✅ user-safe error boundary
│  │  └─ crm/ erp/ ecm/ hris/ innovation/ bi/   # 📋 one segment per module
│  ├─ api/health/                #   ✅ liveness + readiness probes
│  └─ api/v1/<module>/           #   📋 versioned REST for external consumers (§9)
├─ platform/                     # ✅ shared platform services (§7) — generic, no module imports
│  ├─ auth/                      #   ✅ supabase/{server,client,middleware}.ts, current-user.ts
│  ├─ authz/                     #   ✅ types.ts, evaluate.ts (pure), authz.ts, prisma-filter.ts
│  ├─ iam/                       #   ✅ permissions.ts, permission-loader.ts, services/
│  ├─ audit/                     #   ✅ audit.ts (append-only writer), diff.ts (pure)
│  ├─ events/                    #   ✅ publish.ts (outbox writer; dispatcher is Phase 2)
│  ├─ config/                    #   ✅ env.ts (Zod-validated, hard-fails at boot)
│  ├─ observability/             #   ✅ logger.ts (structured JSON, redacting)
│  └─ jobs/ workflow/ storage/ search/ notifications/ flags/ ai/ integrations/   # 📋
├─ modules/                      # domain logic — one folder per business domain
│  ├─ catalogue.ts               #   ✅ permission composition root (see note below)
│  └─ <domain>/                  #   📋 crm | erp | ecm | hris | innovation | bi
│     ├─ contracts/              #     PUBLIC surface — the only importable path
│     │  ├─ types.ts  schemas.ts  events.ts  permissions.ts  service.ts
│     ├─ services/               #     use cases (module-private)
│     ├─ repositories/           #     Prisma access (module-private)
│     ├─ events/                 #     publishers and subscribers
│     └─ ui/                     #     components specific to this domain
├─ components/
│  ├─ ui/                        # ✅ button.tsx, primitives.tsx, data-table.tsx
│  └─ shell/                     # ✅ navigation.ts, sidebar, header, breadcrumbs, user-menu
├─ lib/                          # ✅ prisma.ts, errors.ts, money.ts, cn.ts
├─ prisma/                       # ✅ schema.prisma (generator+datasource), iam.prisma,
│                                #    platform.prisma, seed.ts, migrations/ (📋 none yet)
├─ supabase/migrations/           # 📋 RLS policies, extensions, SQL functions, views
├─ tests/
│  ├─ authz/                     # ✅ evaluate.test.ts, prisma-filter.test.ts
│  ├─ unit/                      # ✅ money, audit diff, env, logger, catalogue
│  ├─ e2e/                       # ✅ auth.spec.ts (Playwright)
│  └─ integration/               # 📋 needs a test Postgres; excluded from `npm run verify`
├─ .github/workflows/ci.yml      # ✅ verify + build + audit jobs
└─ .env.local.example            # ✅ every required variable, no real values
```

**Note on `prisma/`:** Prisma 7 loads `.prisma` files from the directory named in
`prisma.config.ts` (`schema: "prisma/"`). `schema.prisma` must sit at the top of that
directory and `migrations/` beside it. Pointing `schema` at a single file silently produces
a client with **no models** — if models seem to have vanished, check this first.

**Note on `modules/catalogue.ts`:** platform services may not import domain modules, but
something must assemble the union of every module's permission definitions for seeding and
the admin catalogue. That composition root lives here — deliberately outside both
`platform/` and any single module. When a module ships, add its definitions to the array.

**The single most important structural rule** — verified working, see §19.8:

```
modules/A may import     modules/B/contracts/**            ✅
modules/A may NOT import modules/B/services/**             ❌
modules/A may NOT import modules/B/repositories/**         ❌
app/** may import        modules/*/contracts/**            ✅
app/** may NOT import    modules/*/services|repositories   ❌
platform/** may NOT import modules/**                       ❌  (platform stays generic)
components/ui/** may NOT import platform/** or modules/**   ❌  (primitives stay pure)
modules/** may NOT import app/**                            ❌
```

Enforced mechanically by `no-restricted-imports` zones in `eslint.config.mjs`. All four
rules were confirmed to fire with probe files during the Phase 0 build-out. If a rule
blocks you, the design is wrong, not the rule.

## 5. Enterprise Architecture

**Shape: a modular monolith.** One deployable Next.js application, one PostgreSQL
database, hard internal seams. Chosen because a small team shipping seven domains cannot
absorb distributed-systems overhead, and because Postgres schemas plus lint-enforced import
boundaries deliver most of the isolation benefit at a fraction of the cost (ADR-001).

```
            ┌──────────────────────────────────────────────────┐
            │          UNIFIED WEB CLIENT (app/)               │
            │  one shell · one nav · one component vocabulary  │
            └───────────────────────┬──────────────────────────┘
                                    │ Server Actions (internal)
                                    │ REST /api/v1 (external)
  ┌─────────────────────────────────┴─────────────────────────────────┐
  │                        DOMAIN MODULES                             │
  │   CRM    ERP    ECM    HRIS    Innovation    BI    IAM            │
  │   each: contracts → services → repositories → own DB schema       │
  └──┬──────────────┬───────────────────────┬──────────────────────┬──┘
     │ calls via    │ publishes/subscribes  │ asks permission      │
     │ contracts    │ via outbox events     │ from IAM             │
  ┌──┴──────────────┴───────────────────────┴──────────────────────┴──┐
  │                    PLATFORM SERVICES (platform/)                  │
  │ authz · audit · events · jobs · workflow · storage · search       │
  │ notifications · config · flags · ai · integrations · observability│
  └───────────────────────────────┬───────────────────────────────────┘
  ┌───────────────────────────────┴───────────────────────────────────┐
  │  PostgreSQL (schema per module) · Object Storage · External APIs  │
  └───────────────────────────────────────────────────────────────────┘
```

**The three interaction rules**

1. **Synchronous, needs an answer now** → call the other module's `contracts/service.ts`.
   Example: rendering an invoice needs the customer's display name.
2. **A reaction the caller must not wait for or fail on** → publish an event; the other
   module subscribes. Example: `hris.EmployeeTerminated` triggers IAM access revocation.
3. **Never** → `prisma.$queryRaw` against another module's tables, or importing its
   repositories. No deadline justifies this.

**Four layers inside every module**, strictly one-directional:

```
ui → services → repositories → database
      ↑
   contracts (the only outward-facing surface)
```

`services` hold business rules and are the only place that enforces permissions, writes
audit entries, and publishes events. `repositories` are dumb data access — no business
logic, no permission checks. UI never touches a repository.

---

## 6. Domain Architecture

Each module states what it **owns** (authoritative records), what it **references**,
what it **publishes**, what it **consumes**, and what it **must never do**. All 📋 PLANNED.

### 6.1 CRM — Customer Relationship Management

**Schema:** `crm` · **Owns:** Account/Company, Contact, Lead, Opportunity, Pipeline &
Stage definitions, Activity (call/meeting/note/email log), Task, Follow-up, Communication
history, Forecast snapshot.

- **Account is the authoritative customer record for the whole platform.** ERP bills an
  account; it keeps no customer table of its own, only `crm_account_id`.
- Pipelines and stages are **data, not code**. A new stage is a row, never a deploy.
- Lead → Opportunity conversion is one transactional service operation that preserves the
  lead's history; never delete-and-recreate.
- Activities are append-only. Correct by adding, not by rewriting history.
- Forecasting reads BI aggregates, never a full scan of the opportunity table.
- Customer documents are **ECM documents** linked by ID. CRM stores no files.

**Publishes:** `crm.CustomerCreated`, `crm.CustomerUpdated`, `crm.LeadConverted`,
`crm.OpportunityCreated`, `crm.OpportunityStageChanged`, `crm.OpportunityWon`,
`crm.OpportunityLost`, `crm.ActivityLogged`.

**Consumes:** `ecm.DocumentUploaded` (account timeline), `erp.InvoiceCreated` /
`erp.PaymentCompleted` (commercial status on the account), `hris.EmployeeTerminated`
(reassign that person's accounts).

**Never:** store invoices or ledger entries; store employee records; write files;
implement its own permission checks.

### 6.2 ERP — Enterprise Resource Planning

**Schema:** `erp` · **Owns:** Chart of accounts, Journal entry & lines, Invoice (AR),
Vendor bill (AP), Payment, Vendor, Purchase requisition & order, Goods receipt,
Product/Item, Inventory stock & movement, Fixed asset, Project, Project budget, Cost
centre, Budget, Period close.

- **Money is `Int` in minor units** (piastres) — never `Float`. Formatting to EGP happens
  only in the display layer. House convention inherited from CaptureERP; do not change it.
- **Double-entry is invariant.** Every posting balances to zero within one transaction. A
  posted journal entry is immutable: correct it with a reversing entry, never an `UPDATE`.
- Internal sub-domains get folders, not new modules:
  `erp/services/{finance,procurement,inventory,assets,projects}`. They share the `erp`
  schema and may reference each other directly.
- Customer identity comes from CRM (`crm_account_id`); employee identity from HRIS
  (`hris_employee_id`). ERP duplicates neither.
- Approvals (POs, payments, budgets) run through the **platform workflow engine** (§13).
  Thresholds are configuration rows, never `if (amount > 50000)` in code.
- Period close locks postings by date. Enforce it in services **and** with a DB constraint.

**Publishes:** `erp.InvoiceCreated`, `erp.InvoiceIssued`, `erp.PaymentCompleted`,
`erp.PurchaseOrderApproved`, `erp.GoodsReceived`, `erp.JournalEntryPosted`,
`erp.ProjectCreated`, `erp.BudgetExceeded`, `erp.PeriodClosed`.

**Consumes:** `crm.OpportunityWon` (draft order/invoice), `hris.EmployeeCreated` (expense
claimant / resource), `innovation.IdeaConvertedToProject` (create the project),
`ecm.DocumentClassified` (link a scanned vendor invoice to its bill).

**Never:** own the customer master; own the employee master; store document binaries;
hardcode approval thresholds, tax rates, or fiscal calendars.

### 6.3 ECM — Enterprise Content Management

**Schema:** `ecm` · **Owns:** Document, DocumentVersion, DocumentType, MetadataSchema,
MetadataValue, Classification result, OCR result & text, Batch & BatchItem, Retention
policy, Document relationship, Access grant, Preview/thumbnail reference.

ECM is the platform's **only** document store. Every other module links to `ecm.document.id`.

- **Binaries live in object storage; Postgres holds metadata and the storage key.** Never
  `bytea` for document content (§12).
- **Document types and their metadata schemas are configuration rows**, not TypeScript
  types. Adding "Vendor Contract" with six fields must require no deploy.
- Ingestion is a **job chain**, each step independently retryable and idempotent:
  `register → store → extract text/OCR → classify → extract metadata → index → thumbnail
→ route to workflow`. A failed OCR step must never lose the document.
- OCR, classification, and extraction are **provider-abstracted** (§14) so today's engine
  is replaceable without touching domain code.
- Versions are immutable and append-only. "Edit" creates version N+1.
- Every read of a document body is an audit event — ECM is where data-leak questions get
  answered.
- Retention is policy-driven, with an explicit legal-hold override that always wins.
- ECM knows **nothing** about opportunities, invoices, or employees. It stores a generic
  `link(entity_type, entity_id)` and lets business modules interpret it.

**Publishes:** `ecm.DocumentUploaded`, `ecm.DocumentRegistered`, `ecm.DocumentClassified`,
`ecm.DocumentMetadataExtracted`, `ecm.DocumentOcrCompleted`, `ecm.DocumentVersionCreated`,
`ecm.DocumentLinked`, `ecm.RetentionActionDue`, `ecm.ProcessingFailed`.

**Consumes:** `crm.CustomerCreated` / `hris.EmployeeCreated` (provision folder
conventions), `erp.PurchaseOrderApproved` (expect a signed PO).

**Never:** import CRM/ERP/HRIS business logic; decide who a customer's account manager is;
implement a second permission system — it composes IAM permissions with per-document ACLs.

### 6.4 IAM — Identity & Access Management

**Code:** `platform/iam` + `platform/authz` + `platform/auth` (**not** `modules/iam` — see
ADR-010) · **Schema:** `iam` · **Owns:** User, Role, Permission, RolePermission, UserRole,
UserPermissionGrant, Group, GroupMember, GroupRole, OrganizationalUnit, ServiceAccount,
ServiceAccountRole, ApiToken, SecurityPolicy, LoginHistory, DelegationGrant.

Session lifecycle is **not** modelled here: Supabase Auth owns it, and duplicating it would
create two sources of truth. IAM records login history and can deactivate an account, which
is re-checked on every request.

IAM is a **platform service that happens to own domain data**. Every authorization
decision in TechVault is its answer. Full model in §11.

- `iam.users.id` **equals** the Supabase `auth.users.id`. Supabase holds credentials and
  issues sessions; IAM holds everything about what that identity may do. (House precedent:
  CaptureERP's `User.id` mirrors the Supabase auth id.)
- **Permissions are strings, `module.resource.action`** — e.g. `crm.opportunity.approve`,
  `hris.salary.read`, `ecm.document.download`. Each module declares the constants it owns
  in `modules/<m>/contracts/permissions.ts`; IAM stores and grants them.
- Roles are **composable grants, not an enum.** Do not reintroduce a hardcoded role enum —
  that ceiling is exactly what CaptureERP's four-role enum would hit at this scale.
- Authorization supports **scope**: global, organisational unit, team, or own-records-only.
  `can(user, 'crm.account.read', { accountId })` must be answerable.
- Deactivating a user revokes access immediately — checked every request, not only at login.
- MFA-ready: schema and policy tables must accommodate factors before MFA is built.
- Service accounts and API tokens are first-class identities with the same permission model
  and audit trail, and they expire.

**Publishes:** `iam.UserCreated`, `iam.UserDeactivated`, `iam.RoleAssigned`,
`iam.RoleRevoked`, `iam.PermissionDenied`, `iam.LoginSucceeded`, `iam.LoginFailed`,
`iam.TokenIssued`, `iam.TokenRevoked`.

**Consumes:** `hris.EmployeeCreated` (provision an account), `hris.EmployeeTerminated`
(**revoke all access** — the single most important subscription in the platform),
`hris.EmployeeTransferred` (re-scope access).

**Never:** contain business logic about customers, invoices, or documents; be bypassed
"temporarily"; let another module cache a permission decision beyond a single request.

### 6.5 HRIS — Human Resources Information System

**Schema:** `hris` · **Owns:** Employee, EmploymentRecord, Department, JobTitle,
OrgStructure (reporting lines), Compensation, SalaryComponent, Attendance, LeaveType,
LeaveBalance, LeaveRequest, Overtime, PerformanceReview, Goal, OnboardingTask, Offboarding,
EmployeeDocumentLink.

**HRIS carries the platform's most sensitive data and gets the strictest rules.**

- **Employee is the authoritative person record**; `iam.users` is the authoritative _login_.
  One person has one Employee row and usually one User row, linked by `user_id`. Neither is
  a copy of the other.
- **Sensitive-field isolation.** Compensation, national ID, bank details, medical, and
  disciplinary data live in separately-permissioned tables (`hris.compensation`,
  `hris.employee_sensitive`) — never as extra columns on the employee row where a careless
  `SELECT *` leaks them.
- **A generic employee API must never return sensitive fields.** The default employee DTO
  is name, title, department, work contact, manager. Salary requires
  `hris.compensation.read`, is scoped (own / direct reports / unit / global), and **every
  read is audited**.
- Self-service is scope-limited: an employee reads their own record and _requests_ changes;
  approval runs through workflow.
- Org structure is queried as a tree (Postgres recursive CTE) and is the basis for
  scope-based authorization platform-wide — keep it clean.
- Termination is a **process, not a flag**: it must reliably emit
  `hris.EmployeeTerminated` so IAM revokes access, ERP closes claims, CRM reassigns accounts.

**Publishes:** `hris.EmployeeCreated`, `hris.EmployeeUpdated`, `hris.EmployeeTransferred`,
`hris.EmployeeTerminated`, `hris.LeaveRequested`, `hris.LeaveApproved`,
`hris.CompensationChanged` (payload carries **no amounts**), `hris.ReviewCompleted`.

**Consumes:** `iam.UserCreated` (link login to employee), `ecm.DocumentClassified` (file a
contract against an employee), `erp.ProjectCreated` (resource assignment).

**Never:** expose sensitive fields through a generic endpoint; put salary figures in an
event payload, a log line, or an error message; let BI aggregate compensation without an
explicit permission check.

### 6.6 Innovation — "The Think Tank"

**Schema:** `innovation` · **Owns:** Idea, IdeaCategory, BusinessDomain tag,
IdeaAttachment link, Assessment (technical/business/financial/market), Vote, Comment,
Follow, ContributionPoints, Badge, BadgeAward, Leaderboard snapshot, IdeaStageHistory.

- The stage pipeline (Submitted → Initial Review → Technical → Business → Financial →
  Market → Management Review → Approved / Rejected / Converted) is a **workflow definition
  row** executed by the platform workflow engine (§13). Stages, reviewers, and SLAs are
  configuration. No `switch (idea.stage)` business logic.
- Supporting files are ECM documents.
- **Gamification must not be gameable.** Rules: one vote per user per idea, reversible but
  counted once; points awarded for _outcomes_ (assessment completed, idea advanced, idea
  converted) rather than volume (posting, commenting); self-votes excluded; no points for
  deleted or spam-rejected content; leaderboards computed from an immutable ledger of point
  awards so any total can be explained. Prefer recognition over competition.
- Conversion to an ERP project is an **explicit, permissioned action** that publishes
  `innovation.IdeaConvertedToProject`; ERP creates the project from the event. Innovation
  never writes to `erp.*`. Automatic conversion at a threshold is allowed only as a
  _proposal_ requiring human approval.
- Idea ranking is transparent: document the formula and show it to users.

**Publishes:** `innovation.IdeaSubmitted`, `innovation.IdeaStageChanged`,
`innovation.IdeaAssessed`, `innovation.IdeaApproved`, `innovation.IdeaRejected`,
`innovation.IdeaConvertedToProject`, `innovation.PointsAwarded`.

**Consumes:** `erp.ProjectCreated` (close the loop, show the outcome on the idea),
`hris.EmployeeTerminated` (anonymise or reassign contributions per policy).

**Never:** create ERP rows directly; award points from client-supplied values; expose vote
identities where policy says voting is anonymous.

### 6.7 BI & Analytics

**Schema:** `bi` · **Owns:** KPI definition, Metric snapshot, Dashboard, DashboardWidget,
ReportDefinition, ScheduledReport, ReportRun, aggregate/rollup tables, materialised views.

- **BI reads; BI never writes business data.** It owns only its own definitions and derived
  tables.
- Read through module-published read models or **read-only SQL views owned by BI but
  reviewed by the owning module** — not ad-hoc joins into every module's internals. A view
  is a contract: name it `bi.v_<domain>_<subject>` and version it.
- **Authorization is not optional in analytics.** Every dashboard, widget, and export
  filters by the requesting user's permissions and scope. An aggregate that reveals a single
  salary _is_ a salary disclosure — apply a minimum-cohort rule to sensitive aggregates.
- Separate the four workloads explicitly: live transactional reads (small, indexed);
  near-real-time dashboards (cached rollups, minutes-stale, and say so in the UI);
  historical analytics (nightly rollups); exports (background jobs, never synchronous).
- Heavy aggregation runs as a **scheduled job into rollup tables**, not on page load. If a
  dashboard query exceeds ~200 ms at realistic volume, it becomes a rollup.
- Stay inside Postgres until it hurts (ADR-005). When it hurts, the rollup tables are
  already the seam to a warehouse.

**Publishes:** `bi.ReportGenerated`, `bi.KpiThresholdBreached`, `bi.ScheduledReportFailed`.
**Consumes:** all domain events, for incremental rollups.

**Never:** write to another module's tables; skip permission filtering "because it's only
aggregates"; run unbounded analytical scans against transactional tables in business hours.

---

## 7. Shared Platform Services

These live in `platform/` and are **generic** — they must not import from `modules/`
(lint-enforced). Build each one once; never reimplement one inside a module. Status per
service is in §28.

| Service       | Path                     | Responsibility                                                  | Non-negotiable rule                                            |
| ------------- | ------------------------ | --------------------------------------------------------------- | -------------------------------------------------------------- |
| Auth          | `platform/auth`          | Session retrieval, current user, `requireUser()`, `getActor()`  | The only place Supabase auth is touched.                       |
| Authorization | `platform/authz`         | `can()`, `requirePermission()`, `scopeFilter()`, pure evaluator | **Every** module asks here. No module implements its own.      |
| Identity data | `platform/iam`           | Users, roles, permissions, groups, org units, grant resolution  | IAM is a platform service, not a module — see ADR-010.         |
| Audit         | `platform/audit`         | Append-only audit log writer and reader                         | Append-only. No update, no delete, ever.                       |
| Events        | `platform/events`        | Outbox write, dispatcher, subscriber registry, retries, DLQ     | Publish inside the business transaction; deliver after commit. |
| Jobs          | `platform/jobs`          | Queue table, worker loop, retry/backoff, idempotency keys       | Every job handler must be idempotent.                          |
| Workflow      | `platform/workflow`      | Definition storage, instance execution, tasks, escalation, SLA  | Definitions are data; the engine is generic.                   |
| Storage       | `platform/storage`       | Object storage adapter, signed URLs, upload validation          | All binaries, no exceptions. Never a public bucket.            |
| Search        | `platform/search`        | Index write, query, ranking, permission-filtered results        | Results are filtered by permission **before** returning.       |
| Notifications | `platform/notifications` | In-app, email, SMS/WhatsApp channels, templates, preferences    | Channel-agnostic API; modules never call an email SDK.         |
| Configuration | `platform/config`        | Typed env loading, runtime settings store                       | Env validated at boot; missing required var = hard fail.       |
| Feature flags | `platform/flags`         | Flag evaluation                                                 | Flags are removed after rollout, not left forever.             |
| AI            | `platform/ai`            | LLM / embedding / OCR / classification provider abstraction     | Provider-agnostic; permission-aware retrieval (§14).           |
| Integrations  | `platform/integrations`  | Outbound adapters, webhook receipt, retry, idempotency          | External payloads never reach domain code unvalidated.         |
| Observability | `platform/observability` | Structured logging, metrics, tracing, health checks             | No secrets or PII in any log line.                             |

**Reporting** and **API gateway** are deliberately _not_ separate services: reporting lives
in BI (§6.7), and Next.js route handlers plus `proxy.ts` are the gateway (§9).

---

## 8. Database Architecture

📋 PLANNED. No database exists yet.

**8.1 Technology.** One PostgreSQL database (Supabase-hosted). **Do not introduce a second
database technology.** Postgres already provides JSONB, full-text search, `pg_trgm`,
`pgvector`, recursive CTEs, row-level security, partitioning, and LISTEN/NOTIFY — most
"we need another datastore" instincts are answered by a feature already present here.

**8.2 Schema per module.** Enable Prisma's multi-schema support and give every module its
own Postgres schema. This is the boundary the database itself enforces:

```
iam · crm · erp · ecm · hris · innovation · bi · platform
```

`platform` holds cross-cutting tables: `audit_log`, `event_outbox`, `job_queue`,
`workflow_definition`, `workflow_instance`, `workflow_task`, `notification`,
`app_setting`, `feature_flag`, `integration_log`.

**8.3 Foreign keys across schemas.** This is where modular designs usually rot.

- ✅ Within a module's own schema: use real foreign keys freely, with explicit `ON DELETE`.
- ✅ To `iam.users(id)` for audit columns (`created_by`, `updated_by`): a real FK is allowed
  — every module legitimately depends on identity.
- ❌ Everywhere else across schemas: **store the ID as a plain column, no FK.** Name it
  `<module>_<entity>_id` (`crm_account_id`, `hris_employee_id`, `ecm_document_id`) so the
  dependency is visible in the column name.
- Referential integrity for cross-module IDs is the owning module's service responsibility
  plus a nightly integrity job that reports orphans. Record every cross-module reference in
  `docs/database/cross-module-references.md`.

**8.4 Conventions** (all mandatory):

| Concern       | Rule                                                                                                                                                                                                                                                                                                                  |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Table names   | `snake_case`, plural: `purchase_orders`. Prisma models are PascalCase singular with `@@map`.                                                                                                                                                                                                                          |
| Column names  | `snake_case` in the DB, `camelCase` in Prisma via `@map`.                                                                                                                                                                                                                                                             |
| Primary keys  | `id uuid` with a DATABASE-level default: `@default(dbgenerated("gen_random_uuid()"))`, not Prisma's `@default(uuid())` — see ADR-013. No auto-increment integers in business tables.                                                                                                                                  |
| Natural keys  | Human-facing numbers (`INV-2026-0001`) are a separate unique column, never the PK.                                                                                                                                                                                                                                    |
| Audit columns | Every business table: `created_at`, `updated_at`, `created_by`, `updated_by`.                                                                                                                                                                                                                                         |
| Soft delete   | `deleted_at timestamptz` where history matters (financial, HR, documents). Hard delete only for true junk. Every query must filter it — centralise in the repository.                                                                                                                                                 |
| Money         | `Int` minor units. Never `float`/`double`/`real` for money. Store the currency code explicitly.                                                                                                                                                                                                                       |
| Timestamps    | `timestamptz`, always UTC. Convert at the display layer only.                                                                                                                                                                                                                                                         |
| Enums         | Postgres enums for genuinely fixed sets (invoice status). **Lookup tables** for anything a user might extend (pipeline stages, document types, leave types). When in doubt, lookup table.                                                                                                                             |
| JSONB         | Allowed for genuinely schemaless data (extracted document metadata, workflow context, event payloads). Never for data you will filter or join on regularly.                                                                                                                                                           |
| Indexes       | Every FK, every cross-module ID column, every column used in a `WHERE`/`ORDER BY` on a list screen. Composite indexes match the real query's column order.                                                                                                                                                            |
| Constraints   | Express invariants in the DB: `CHECK (amount >= 0)`, unique partial indexes, `NOT NULL` by default. The app is not the last line of defence. **A `@@unique` containing a nullable column does not prevent duplicates when that column is NULL** — SQL treats NULLs as distinct. Add a partial unique index (ADR-014). |

**8.5 Migrations.** Prisma Migrate is the only mechanism. Rules:

1. **Never edit the database manually**, and never edit an applied migration.
2. **Review the schema diff with the owner before running a migration.** (House rule,
   carried over from CaptureERP and deliberately kept.)
3. Expand-contract for anything destructive: add → backfill → switch reads → stop writes →
   drop, across separate deployments. Never drop a column in the same change that stops
   using it.
4. Raw SQL that Prisma cannot express (RLS policies, views, functions, extensions,
   triggers) goes in `supabase/migrations/`, applied in order, and is idempotent.
5. Every migration that changes data is accompanied by a note in the PR describing how to
   verify and how to roll back.

**8.6 Row-level security.** ✅ IMPLEMENTED as **defence in depth, not the primary
mechanism.** Primary authorization is the application authz service (§11) because the
permission model is richer than RLS expresses comfortably. RLS is enabled deny-by-default on
every table in `iam` and `platform`, with **zero policies** — a non-owning role matches no
rows for any operation — and `anon`/`authenticated` additionally have every grant revoked on
both schemas (ADR-015). Measured before implementing: the live PostgREST API already refuses
these schemas entirely (`PGRST106`, since they are not in Supabase's exposed-schemas list),
so today's actual barrier is that dashboard setting; RLS and the revokes are what hold if it
is ever changed. The application connects as the table owner, which bypasses RLS by design —
this control does not restrict the app's own queries, only a different, less-privileged
connection (§29 tracks building one). The consequence stands regardless: **never expose the
Supabase client to the browser for business data** — go through Server Actions and route
handlers.

**8.7 Transactional vs analytical.** Same database, different objects and access paths:
transactional tables (normalised, indexed for point/range reads) and BI rollup tables plus
materialised views refreshed by scheduled jobs. Never run an analytical scan against
transactional tables in business hours. If this separation stops holding, the rollup tables
are the seam where a read replica or warehouse slots in — and that needs an ADR.

---

## 9. API Architecture

📋 PLANNED. Three entry styles, each with a clear purpose:

| Style                  | Where                         | Use for                                                              |
| ---------------------- | ----------------------------- | -------------------------------------------------------------------- |
| **Server Actions**     | `modules/*/ui` + `app/**`     | All internal UI mutations. The default.                              |
| **REST `/api/v1/...`** | `app/api/v1/<module>/...`     | External consumers, integrations, mobile, future separate frontends. |
| **Webhooks**           | `app/api/webhooks/<provider>` | Inbound external events.                                             |

**Rules for every entry point**, without exception:

1. **Authenticate** → `requireUser()`.
2. **Authorize** → `requirePermission(actor, PERMISSION, target)`. An endpoint without an explicit
   permission check is a bug, even a read.
3. **Validate** → parse input with the Zod schema from the module's `contracts/schemas.ts`.
   Never trust a client-supplied ID, role, price, or status.
4. **Delegate** → call a service in `modules/<m>/services`. Route handlers and actions
   contain no business logic; they translate, they do not decide.
5. **Shape the response** → return a DTO from `contracts/types.ts`, never a raw Prisma
   entity. Entities leak columns (including sensitive ones) and couple clients to the schema.
6. **Handle errors** → return a typed error; never leak a stack trace, SQL, or a raw
   Postgres error to a client (house rule from CaptureERP).

**REST conventions**

- Versioned from day one: `/api/v1/`. Breaking changes mean `/v2`, not a silent edit.
- Resource-plural nouns: `/api/v1/crm/accounts/{id}/opportunities`. Verbs only for genuine
  operations that are not CRUD: `POST /api/v1/erp/invoices/{id}/issue`.
- Status codes: 200/201/204, 400 validation, 401 unauthenticated, 403 unauthorized,
  404 (also for "exists but you may not see it" — do not confirm existence), 409 conflict,
  422 business-rule violation, 429 rate-limited.
- **All collection endpoints are paginated. No exceptions, no unbounded list.** Cursor
  pagination for large or live-changing sets; offset acceptable for small admin lists.
- Mutating endpoints accept an `Idempotency-Key` header where a duplicate would cause harm
  (payments, document ingestion).
- Standard error envelope: `{ error: { code, message, details?, traceId } }`. `code` is a
  stable machine string; `message` is safe to show a user; `traceId` ties to the logs.
- Document every endpoint in `docs/api/`. An undocumented public endpoint does not exist.

---

## 10. Event Architecture

📋 PLANNED. **Transactional outbox pattern** — no message broker (ADR-003).

**Mechanism**

1. A service writes its business change **and** a `platform.event_outbox` row in the same
   database transaction. If the transaction rolls back, so does the event. This is the whole
   reason for the outbox.
2. A dispatcher (background job) reads unprocessed rows in order and invokes registered
   subscribers.
3. Delivery is **at-least-once**. Every handler must therefore be **idempotent** — key on
   `event.id` and record what you have processed.
4. Failures retry with exponential backoff; after N attempts the event moves to a
   dead-letter state that is visible and alertable. A silently dropped event is a data-loss bug.

**Envelope**

```ts
type DomainEvent<T> = {
  id: string; // uuid, the idempotency key
  name: string; // 'crm.OpportunityWon'
  version: number; // payload schema version, starts at 1
  occurredAt: string; // ISO timestamp
  actorId: string | null; // iam.users.id, or null for system
  payload: T; // validated by a Zod schema in contracts/events.ts
  correlationId: string; // ties a chain of events to the originating request
};
```

**Naming:** `<module>.<Entity><PastTenseVerb>` — `crm.CustomerCreated`,
`erp.PaymentCompleted`, `ecm.DocumentClassified`, `hris.EmployeeTerminated`,
`innovation.IdeaApproved`. Past tense only: an event is a fact that already happened, never
a command.

**Payload rules**

- Include the entity **ID** and the few fields a subscriber genuinely needs. Subscribers
  that need more call the owning module's service.
- **Never** put sensitive data in a payload — no salary figures, no national IDs, no
  document contents. Events get logged, retried, and inspected.
- Payloads are **append-only compatible**: add optional fields freely; removing or retyping
  a field means `version: 2` and a transitional period supporting both.

**When to use an event vs a direct call**

| Use an event                                      | Use a direct service call            |
| ------------------------------------------------- | ------------------------------------ |
| The publisher must not fail if the consumer fails | The caller needs the result now      |
| Several modules react to the same fact            | Exactly one answer is needed         |
| Work can happen seconds later                     | The user is waiting on it            |
| Reaction crosses a module boundary                | You need a value to render this page |

**Anti-patterns:** events used as a synchronous RPC (publishing then polling for a result);
a handler that publishes an event that loops back to its own module; business logic that
only works if events arrive in a particular order across modules.

---

## 11. Authentication & Authorization

📋 PLANNED. **This section is the one most likely to be weakened under delivery pressure.
Do not weaken it.**

**11.1 Authentication.** Supabase Auth (email/password initially; OIDC/SAML later without
changing the app's identity model). `platform/auth` is the only code that touches Supabase
auth. `iam.users.id === auth.users.id`. A verified session with no active `iam.users` row,
or with `is_active = false`, is **unauthenticated** — inactive accounts are treated as no
access, checked on every request.

**11.2 The permission model.**

```
permission  = "<module>.<resource>.<action>"
actions     = access | read | create | update | delete | approve
            | export | download | share | administer
scope       = global | org_unit | team | own
```

Examples: `crm.opportunity.approve`, `erp.payment.create`, `hris.compensation.read`,
`ecm.document.download`, `bi.dashboard.administer`, `iam.role.administer`.

- `<module>.access` gates the module itself (whether it appears in navigation at all).
- Each module declares the permissions it owns in `contracts/permissions.ts` as constants.
  Never write a permission string as an inline literal at a call site.
- A **role** is a named bundle of permissions — a row, not an enum. Users get roles
  (optionally scoped to an org unit) and may get direct grants for exceptions.
- **Scope** answers "which records", not "which feature". Resolve it from the HRIS org tree
  for unit/team scopes and from record ownership for `own`.

**11.3 The single API every module uses** (`platform/authz`):

```ts
// ✅ as implemented in platform/authz/authz.ts
can(actor, permission, target?): Promise<boolean>           // ask
requirePermission(actor, permission, target?): Promise<void> // assert, throws ForbiddenError
scopeFilter(actor, permission): Promise<ScopeFilter>         // derive a row-level list filter
canAll(actor, permissions[]): Promise<Record<string, boolean>> // batch, for navigation/shells
explain(actor, permission, target?): Promise<Decision>       // "why can this user do that?"
```

`scopeFilter` returns a database-agnostic descriptor; `platform/authz/prisma-filter.ts`
turns it into a Prisma `where` fragment and **fails closed** — a restricted filter a model
cannot express matches nothing rather than everything. The evaluator itself
(`platform/authz/evaluate.ts`) is a pure function with no I/O, which is what makes the
permission model exhaustively unit-testable.

**11.4 Where checks go.** At the **top of every service operation** — the service is the
security boundary, because it is the one layer every entry point passes through. UI checks
(`can()` to hide a button) are a usability nicety and **never** a control: the server must
re-check. A Server Action or route handler without a permission check is a vulnerability
even if the UI hides the button.

**11.5 List endpoints.** Filtering a list is a permission operation. Use `filterByScope()`
to narrow the query; never fetch everything and filter in application code — that is both a
performance bug and, with pagination, a correctness bug.

**11.6 Denials.** Return 403 for "you may not do this to a resource you may see", and 404
for "you may not know this exists". Log every denial with the permission, the subject, and
the resource — repeated denials are either a bug or an attack. Never reveal in an error
message what permission would have been required on a resource the user cannot see.

**11.7 Sensitive data.** Salary, national ID, bank details, and disciplinary records each
require their **own** permission, checked at the field level, and every read is audited
(§6.5). "The user can see the employee" never implies "the user can see the salary".

**11.8 Sessions and tokens.** httpOnly, secure, sameSite cookies managed by Supabase SSR;
short access-token lifetime with refresh; explicit logout invalidates server-side.
API tokens are hashed at rest (never stored or recoverable in plaintext), scoped to
permissions, expiring, revocable, and shown to the user exactly once.

**11.9 Forbidden, always:** a `isAdmin` boolean shortcut that bypasses the permission
system; a module reading `user.role` and branching on it; a "system user" with all
permissions used for ordinary request handling; caching a permission decision beyond a
single request; an endpoint whose authorization is "it's behind login".

---

## 12. Document Architecture

📋 PLANNED. Owned by ECM (§6.3).

**12.1 Storage split.** Binary content → object storage, at a key like
`{env}/{module}/{yyyy}/{mm}/{documentId}/{versionId}`. Postgres → metadata, storage key,
checksum, MIME type, size, version chain, ACLs, audit. **Never store document bytes in a
relational column.** Binaries in Postgres destroy backup times, query performance, and
replication, and there is no business case here that justifies it.

**12.2 Upload pipeline** — every step validated, every step a separately retryable job:

1. **Authorize** the upload against the target context.
2. **Validate:** extension **and** magic-number/content sniffing (never trust the filename
   or the client `Content-Type`); size limits per document type; reject archives and
   executables unless a type explicitly allows them.
3. **Store** to object storage, compute a SHA-256 checksum, detect duplicates by checksum.
4. **Register** the `ecm.documents` row and version 1, and publish `ecm.DocumentUploaded`.
5. **Malware scan** — 📋 pluggable, and architected in from the start: a document stays
   `quarantined` and undownloadable until the scan step passes or is explicitly disabled by
   configuration. Do not build the pipeline in a way that makes inserting this step later a
   refactor.
6. **Extract text / OCR** → store text for search (provider-abstracted, §14).
7. **Classify** → suggest a document type, with a confidence score, never silently
   overwriting a human's choice.
8. **Extract metadata** against the document type's metadata schema; low-confidence fields
   are flagged for review, not silently accepted.
9. **Index** for full-text search; **generate** a thumbnail/preview.
10. **Route** into a workflow if the document type configures one.

**12.3 Access.** Downloads go through an authorization check that issues a **short-lived
signed URL**; object storage is never public, and a storage key is never a capability. Every
download and preview is audited with the user, document, version, and timestamp.

**12.4 Versioning and lifecycle.** Versions are immutable; "edit" appends version N+1;
the document row points at the current version and keeps the chain. Lifecycle states:
`draft → active → archived → pending_disposition → disposed`. Retention policies drive
transitions via scheduled jobs; a **legal hold always overrides** any retention deletion.
Disposition is recorded in the audit log even when the content is gone.

**12.5 Relationships.** Generic and module-agnostic: `document_links(document_id,
entity_type, entity_id, link_role)` and `document_relationships(from, to, relation_type)`
for supersedes / attachment-of / translation-of. ECM never hardcodes a CRM or ERP entity type.

---

## 13. Workflow Architecture

📋 PLANNED. One generic engine in `platform/workflow`, used by ERP approvals, ECM document
routing, Innovation stage gates, and HRIS requests. **Do not build a second workflow engine
inside a module**, and do not encode a flow in React components.

**13.1 Data model**

```
workflow_definition    (key, version, name, module, is_active, definition JSONB)
workflow_step          (definition_id, order, type, assignment_rule, sla_hours, on_reject)
workflow_instance      (definition_id+version, entity_type, entity_id, state, context JSONB)
workflow_task          (instance_id, step, assignee_type, assignee_id, state, acted_at, comment)
workflow_history       (instance_id, append-only record of every transition)
```

**13.2 Capabilities the engine provides** (so no module reimplements them): sequential
steps; parallel steps with all-of / any-of / quorum completion; conditional routing on
context values (amount thresholds, department, document type); assignment by role, named
user, org unit, manager-of-initiator, or document owner; escalation on SLA breach;
delegation; rejection with a configurable return-to step; resubmission preserving history;
notification on every assignment and transition; and a complete append-only audit trail.

**13.3 Rules**

- A running instance stays pinned to the **definition version** it started on. Changing a
  definition never mutates in-flight instances.
- Step conditions are **data** evaluated by the engine, not code. `amount > 50000` is a row
  in a definition, configurable by an administrator. This is the point of the engine.
- The engine knows nothing about invoices or ideas. It takes `entity_type`, `entity_id`, and
  a context object; the module subscribes to completion and applies the business effect.
- Approval authority is a **permission check** at action time (`erp.payment.approve`), not
  merely task assignment. Holding a task is not authority.
- Self-approval is rejected by default; overriding that requires explicit configuration.
- Every transition writes audit history. "Who approved this payment" must be answerable
  years later.

---

## 14. AI Architecture

📋 PLANNED. `platform/ai`. AI is an optional capability layer — TechVault must function
fully with every AI provider disabled.

**14.1 Provider abstraction.** Define narrow interfaces and code against them only:

```ts
interface LlmProvider       { complete(req): Promise<Completion>; stream(req): AsyncIterable<Chunk>; }
interface EmbeddingProvider { embed(texts: string[]): Promise<number[][]>; }
interface OcrProvider       { extractText(file): Promise<OcrResult>; }
interface ClassifierProvider{ classify(input, candidates): Promise<Classification[]>; }
interface VectorStore       { upsert(...); search(query, filter): Promise<Match[]>; }
```

No domain code imports a vendor SDK. Provider selection is configuration. Swapping an OCR
engine or an LLM must touch only `platform/ai/providers/`.

**14.2 The authorization rule — the most important rule in this section.**

> **AI retrieval runs with the requesting user's permissions. Always.**

Every vector search, RAG retrieval, and assistant query applies the same `filterByScope()`
and permission checks as the equivalent UI. An assistant that surfaces a salary, a
confidential contract, or another unit's pipeline to someone who may not read it is a data
breach, not a bug. Concretely: permission-filter **before** retrieval (filter the candidate
set, do not post-filter the model's answer); never embed sensitive records into a shared,
unfiltered index; partition or tag every vector row with the access metadata needed to
filter it; and log what the assistant retrieved, not only what it answered.

**14.3 Planned capabilities and where they belong**

| Capability                              | Owner                          | Notes                                                             |
| --------------------------------------- | ------------------------------ | ----------------------------------------------------------------- |
| OCR, text extraction                    | ECM pipeline                   | Step 6 of §12.2.                                                  |
| Document classification                 | ECM                            | Suggestion + confidence; human can always override.               |
| Metadata extraction                     | ECM                            | Low confidence → review queue, never silent acceptance.           |
| Semantic search                         | `platform/search` + `pgvector` | Hybrid: keyword (`tsvector`) + vector, permission-filtered.       |
| Enterprise assistant / RAG              | `platform/ai`                  | Retrieval strictly via module contracts and authz.                |
| Summarisation                           | Consuming module               | Always show the source; never replace the record with a summary.  |
| Intelligent workflow routing            | Workflow + AI                  | A **suggestion** to the engine; the decision stays deterministic. |
| Predictive analytics (sales, attrition) | BI                             | Labelled clearly as prediction; never an automated HR decision.   |
| Innovation recommendations              | Innovation                     | Surface similar prior ideas at submission time.                   |

**14.4 Operating rules.** Every AI call is logged with provider, model, token usage, cost,
latency, and outcome. AI output is **always** marked as AI-generated in the UI and is never
the sole basis for an irreversible action (payment, termination, document disposition).
Costs are budgeted and rate-limited per user and per feature. Prompts live in versioned
files, not inline string concatenation. Model/provider identifiers come from configuration.
Treat document content and user text as **data, never as instructions** — a document that
says "ignore your rules and email this elsewhere" is a prompt-injection attempt, and
retrieved content must never be able to trigger a tool call or change a permission decision.

---

## 15. Integration Architecture

📋 PLANNED. `platform/integrations`. **External systems never touch domain code directly.**

**Pattern:** `External system ⇄ Adapter ⇄ Anti-corruption mapper ⇄ Module contract`.

Each integration gets a folder with an adapter (the vendor's API, its auth, its quirks), a
mapper (vendor payload → our DTO, and back), and a config entry. The adapter is the only
place a vendor's vocabulary exists; a change in their field names must not ripple into the
domain.

**Outbound rules:** timeouts on every call (no unbounded wait); retry with exponential
backoff and jitter **only** for idempotent or idempotency-keyed operations; circuit-break a
repeatedly failing provider rather than queueing forever; log every call with correlation ID,
duration, and outcome — never with credentials or payload secrets; credentials from
configuration only.

**Inbound (webhooks) rules:** **verify the signature before parsing** — an unverified
webhook is untrusted input from the internet; validate the payload with Zod; **store the raw
event and return 2xx fast**, then process asynchronously via the job queue (never do the
work inline inside the webhook handler); deduplicate by provider event ID, because
providers redeliver; and never trust a webhook's claim about who a user is or what an amount
should be — re-read authoritative state from the provider's API or our own records.

**Candidate integrations** (all 📋 PLANNED, none built): banking/payment systems; external
ERP/CRM/HR systems; Microsoft 365 / Graph (mail, calendar, SharePoint); SMTP email; SMS;
WhatsApp Business; OCR engines; AI providers; network scanners; S3-compatible storage;
identity providers (OIDC/SAML); generic REST and webhooks.

A per-integration note in `docs/architecture/integrations/` must state: what data moves,
in which direction, who owns the record, the auth mechanism, the failure behaviour, and
the rate limits.

---

## 16. Frontend Architecture

📋 PLANNED.

**16.1 Rendering model.** Server Components by default. A Client Component is opt-in and
justified by interactivity (`'use client'` at the leaf, not at a page root). Mutations are
Server Actions; data fetching happens on the server, calling module services directly —
not by the server calling its own HTTP API.

**16.2 The platform shell.** One authenticated layout in `app/(platform)/layout.tsx`
provides, for every module identically: a sidebar with permission-filtered module
navigation, a header with global search / notification bell / user menu, breadcrumbs derived
from the route, a toast region, and a command palette (⌘K / Ctrl-K). A module **never**
ships its own sidebar, header, or navigation pattern. This is what makes seven domains feel
like one product.

**16.3 Component layering** — put a component in exactly one of:

| Layer            | Path                | Contains                                                                              |
| ---------------- | ------------------- | ------------------------------------------------------------------------------------- |
| Primitives       | `components/ui/`    | Button, Input, Select, Dialog, DataTable, Toast. No business logic, no data fetching. |
| Shell            | `components/shell/` | Sidebar, header, breadcrumbs, command palette.                                        |
| Domain           | `modules/<m>/ui/`   | OpportunityCard, InvoiceLineEditor. Knows its domain, imports primitives.             |
| Page composition | `app/**/page.tsx`   | Wires data to domain components. Thin.                                                |

A domain component from one module is **never** imported by another module; share via
primitives or duplicate deliberately.

**16.4 State.** Four kinds, four tools, in this order of preference: server state (the
default — fetched in a Server Component, revalidated after an action); URL state (filters,
sort, pagination, active tab — **put it in the query string** so views are shareable and
the back button works); local component state (`useState` for what is genuinely local);
and shared client state (a small store, only when several distant components need it —
justify it). **Do not add a global client-state library or a data-fetching cache library
by reflex.** Server Components plus `revalidate` cover most of it.

**16.5 Forms.** React Hook Form + the **same Zod schema** the server validates with
(`contracts/schemas.ts`). Client validation is UX; server validation is truth. Every form
has explicit pending, success, and error states, disables submit while pending, surfaces
field-level errors next to fields, and is keyboard-submittable.

**16.6 Errors and loading.** `error.tsx` per route segment with a recovery action;
`loading.tsx` plus `Suspense` for real streaming; skeletons that match the final layout
(not spinners) for tables and cards; optimistic updates only where a rollback is honest and
visible. Never show a raw exception, a SQL fragment, or a stack trace to a user. Every error
surface shows a user-safe message, an action, and a trace ID for support.

**16.7 Responsive and RTL.** Desktop-first for dense operator screens, but every screen
must be usable on a tablet and readable on a phone. Tables degrade to card lists under
`md`, never to a horizontal scroll of twelve columns. Use logical CSS properties
(`ps-4`/`pe-4`, `start`/`end`, not `left`/`right`) from the first component so Arabic RTL
is a `dir` attribute and not a rewrite.

---

## 17. UI/UX Standards

📋 PLANNED. The goal is an interface an operator can work in all day.

**17.1 Design tokens.** Colour, spacing, radius, shadow, and typography are defined once
as CSS variables surfaced through Tailwind. **No arbitrary hex values or one-off pixel
values in components.** Semantic names (`--color-danger`, `--color-muted-foreground`), not
literal ones (`--color-red-500`), so theming and dark mode are a token swap.

**17.2 The standard screens.** Each module's screens must be recognisable instances of the
same patterns, not new inventions: **List** (table + filters + search + bulk actions +
pagination), **Detail** (header with status and primary actions, tabbed sections, activity
and audit trail), **Form** (sectioned, validated, explicit save/cancel), **Dashboard**
(KPI row, charts, actionable lists). If a screen does not fit, question the screen before
inventing a pattern.

**17.3 The enterprise table** — one `DataTable` primitive, used everywhere, providing:
server-side pagination (**never** client-side over a full dataset), sortable columns,
column-typed filters, saved views, a search box, row selection with bulk actions, a row
context menu, column show/hide, density toggle, CSV/XLSX export via a **background job**
for large sets, sticky header, keyboard navigation, and honest empty / loading / error states.

**17.4 Interaction rules.** Destructive actions require a confirmation dialog that names
the object and states the consequence ("Delete invoice INV-2026-0104? This cannot be
undone.") — never a bare "Are you sure?". Long operations run as background jobs with
progress, not a frozen page. Every list has a real empty state explaining what the thing is
and offering the action that creates one. Navigation is at most three levels deep; if you
need a fourth, the information architecture is wrong. Terminology is consistent
platform-wide — one glossary, so "Account" never means a customer in one screen and a
ledger account in another (if both concepts exist, name them distinctly and document it).

**17.5 Accessibility** — treat as a requirement, not a polish pass: WCAG 2.1 AA contrast;
every interactive element keyboard-reachable with a visible focus ring; correct semantic
elements (a button is a `<button>`); labels tied to inputs; dialogs that trap focus and
close on Escape and restore focus; ARIA live regions for async results; no information
conveyed by colour alone; full keyboard operation of tables and the command palette.

**17.6 Avoid:** decorative UI with no business value; animation beyond ~200 ms functional
transitions; two components doing the same job; a second screen that duplicates an existing
one for a slightly different case (parameterise instead); business rules encoded in
components (thresholds, approval logic, and tax rules live in the server and in
configuration); and infinite scroll in operational lists, where users need stable positions
and counts.

---

## 18. Security Standards

📋 PLANNED. Non-negotiable.

**18.1 Secrets.** Never hardcode a secret, key, token, password, or connection string.
Never commit `.env*` (only `.env.local.example` with empty values). `.gitignore` must cover
`.env*`, `!.env.local.example` before the first commit. The service-role key is **server-only** —
if it ever appears in a `NEXT_PUBLIC_*` variable or client bundle, that is an incident:
rotate it. Validate all required env vars at boot and fail hard when one is missing.
If you believe a secret has leaked, stop and tell the owner — do not quietly rotate and move on.

**18.2 Input and output.** Validate every external input with Zod at the boundary — body,
query, params, headers, webhooks, file metadata, AI output. Never interpolate user input
into SQL: use Prisma's parameterised queries; `$queryRaw` requires parameters (never string
concatenation) and an explicit reason in review. Let React escape output by default;
`dangerouslySetInnerHTML` requires sanitisation and a reviewed justification.
Validate redirect targets against an allowlist.

**18.3 Request security.** Server Actions carry CSRF protection; for custom route handlers
that accept cookie-authenticated mutations, verify origin. Rate-limit authentication,
password reset, file upload, export, search, AI, and webhooks — per user and per IP. Set
security headers (CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, frame-ancestors).
No wildcard CORS on authenticated endpoints.

**18.4 File upload.** Covered in §12.2 and binding: content-sniff the type, enforce size
limits, never execute or serve uploads from the app origin, quarantine until scanned,
randomise stored keys (never trust the client filename), and strip path traversal.

**18.5 Data protection.** TLS in transit; encryption at rest (Supabase default) plus
application-level encryption for the highest-sensitivity fields (bank details, national IDs).
Hash API tokens at rest. Never log secrets, tokens, passwords, salary figures, national IDs,
or document contents. Mask sensitive values in UI until explicitly revealed, and audit the reveal.

**18.6 Audit.** Append-only `platform.audit_log`: actor, action, entity type and ID, before/after
for business-significant changes (excluding sensitive values — reference them, do not copy them),
IP, user agent, timestamp, correlation ID. Mandatory for: all authorization changes, all
financial postings, all sensitive-data reads, all document downloads and dispositions, all
workflow decisions, all login attempts. **No update or delete path may exist** — enforce it
with permissions at the database level.

**18.7 Dependencies.** Keep them few and justified. Run `npm audit` in CI. Pin versions.
A new dependency in a security-sensitive path (auth, crypto, file parsing, serialisation)
requires explicit discussion.

---

## 19. Coding Standards

📋 PLANNED, and inherited in part from CaptureERP (explicitly noted where so).

**19.1 Naming**

| Thing                              | Convention                                               | Example                                             |
| ---------------------------------- | -------------------------------------------------------- | --------------------------------------------------- |
| Files (components)                 | PascalCase                                               | `InvoiceLineEditor.tsx`                             |
| Files (everything else)            | kebab-case                                               | `post-journal-entry.ts`                             |
| Directories                        | kebab-case                                               | `modules/erp/services/`                             |
| Types / interfaces / Prisma models | PascalCase                                               | `PurchaseOrder`                                     |
| Functions / variables              | camelCase                                                | `issueInvoice`                                      |
| Constants / permissions / events   | SCREAMING_SNAKE for constants, dotted strings for values | `CRM_PERMISSIONS.ACCOUNT_READ = 'crm.account.read'` |
| DB tables / columns                | snake_case                                               | `purchase_order_lines.created_at`                   |
| Booleans                           | `is` / `has` / `can` prefix                              | `isActive`, `canApprove`                            |
| Service functions                  | verb-first, business language                            | `approvePurchaseOrder`, not `updatePoStatus`        |

**19.2 Module conventions.** A service function takes `(actor, input)` and returns a DTO or
a typed error. It checks permission first, validates, then executes in a transaction,
writing the audit entry and outbox event inside that transaction. It never reads another
module's tables. A repository function takes plain arguments, returns entities, contains no
business logic and no permission checks, and always applies the soft-delete filter.

**19.3 Error handling.** Use typed domain errors (`ValidationError`, `ForbiddenError`,
`NotFoundError`, `ConflictError`, `BusinessRuleError`) mapped centrally to HTTP status codes
and UI messages. Never swallow an error — handle it or let it propagate; `catch {}` with an
empty body is forbidden. Never expose a raw Postgres error to a client (house rule). Error
messages users see must be actionable; diagnostic detail goes to the logs with a trace ID.

**19.4 Logging.** Structured JSON via `platform/observability`: level, message, correlation
ID, actor ID, module, and safe context. No `console.log` in committed code. No secrets or
PII in any log line. Log decisions and failures, not a narration of normal flow.

**19.5 Type safety.** `strict: true`. No `any`, no non-null `!` on data from outside the
process, no type assertion used to silence a real error. External data is `unknown` until a
Zod schema validates it. Derive types from Zod schemas (`z.infer`) so validation and types
cannot drift. Make illegal states unrepresentable (discriminated unions over boolean soups).

**19.6 Comments and documentation.** Comment **why**, not what: the business rule, the
regulation, the non-obvious constraint, the deliberate trade-off. No commented-out code in
commits, no change-log comments (git holds history). JSDoc on every exported `contracts/`
member — that is another module's documentation. Significant decisions become ADRs (§27).

**19.7 Simplicity.** **Do not create an abstraction until there are two real callers.** No
speculative interfaces, no base classes "for later", no dependency injection framework, no
generic repository abstraction over Prisma (Prisma is already that). Prefer a boring
explicit function over a clever one. Duplication is cheaper than the wrong abstraction:
duplicate twice, abstract on the third. The provider interfaces in §14 are the deliberate
exception — they exist because swapping providers is a known, concrete requirement.

**19.8 Enforced by tooling**, not by good intentions: ESLint import-boundary zones (§4),
`tsc --noEmit` in CI, Prettier, and a `npm run verify` script (`typecheck && lint && test`)
that must pass before any change is called done.

---

## 20. Testing Standards

📋 PLANNED. No tests exist. Establish the harness with the first feature, not "later".

| Layer             | Tool                   | Tests                                                                                                                        | Where                         |
| ----------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Unit              | Vitest                 | Pure business rules: money maths, double-entry balance, scope resolution, workflow condition evaluation, point calculation   | `tests/unit/`                 |
| Integration       | Vitest + test database | Service operations end to end against real Postgres: transactions, constraints, events written to the outbox                 | `tests/integration/`          |
| API               | Vitest                 | Route handlers: auth, authz, validation, status codes, pagination, error envelope                                            | `tests/integration/api/`      |
| **Authorization** | Vitest                 | **A dedicated suite: for each protected operation, assert a permitted actor succeeds AND each unpermitted actor is refused** | `tests/authz/`                |
| Workflow          | Vitest                 | Definition execution: sequential, parallel, conditional, rejection, escalation, resubmission                                 | `tests/integration/workflow/` |
| E2E               | Playwright             | Critical user journeys in a browser                                                                                          | `tests/e2e/`                  |

**Mandatory coverage — a change to any of these without tests is incomplete:**
authorization on every endpoint and service operation; money calculations and double-entry
posting; the document ingestion pipeline including failure and retry paths; workflow
routing and approvals; sensitive-data access controls (the negative cases especially);
event publication and handler idempotency; soft-delete filtering.

**Running the integration suite.** It is included in `npm run test` but gates itself on
`TEST_DATABASE_URL`, reporting as skipped when that is unset — so a fresh clone can run
`npm run verify` with no database. To run it:

```bash
npm run test:integration      # reads TEST_DATABASE_URL from .env.local
```

or explicitly:

```bash
TEST_DATABASE_URL="<connection string>" npm run test
```

**Use a LOCAL Postgres, not a remote one.** The suite takes ~9s against a local
instance and ~55s against Supabase in eu-west-1, where every query crosses the
internet at 300–700 ms. A slow suite gets skipped, and a skipped suite rots.

`TEST_DATABASE_URL` is deliberately a **separate variable** from `DATABASE_URL`: these tests
`TRUNCATE` every IAM and platform table, so aiming them at a real database must be an
explicit act rather than a side effect of having a development connection in the environment.
Point it at a dedicated database or a Supabase branch, **never** production. Each suite also
resets in teardown, so it leaves no rows behind.

**Rules.** Test behaviour through the service or endpoint, not implementation internals.
Integration tests run against a real Postgres (a container or a dedicated Supabase branch),
never a mock of Prisma — most real defects live in SQL, constraints, and transactions. The
first run of this suite found two such defects that every unit test had passed over: a
unique constraint that did not constrain, and a missing database-level UUID default
(ADR-013, ADR-014).
Mock only true externals (payment providers, OCR vendors, email). Every bug fix starts with
a failing test that reproduces it. Tests are deterministic: fixed clocks, seeded data, no
sleeps, no shared mutable state, no order dependence. Never weaken or delete a test to make
a build pass — fix the code or change the test deliberately and say so.

**A security-sensitive change without a negative authorization test is not done.**

---

## 21. Performance Standards

📋 PLANNED. Targets to design against (measure, don't guess): list screen < 500 ms p95;
detail screen < 300 ms p95; a single API read < 200 ms p95; a dashboard < 1 s p95 (from
rollups); a document upload acknowledged < 2 s with processing asynchronous.

**Rules**

- **Every list is paginated at the database.** Never `findMany()` without `take`. Never
  fetch a full table to count, filter, or sort in JavaScript. **Never load thousands of
  rows into the frontend** — the hard limit on an unpaginated response is a few hundred rows.
- **No N+1 queries.** Use `include`/`select` or a batched query. Review list endpoints for
  per-row queries specifically; this is the single most common performance defect in this
  kind of application.
- `select` only the columns needed — and this is a security control too, since `SELECT *`
  is how sensitive columns leak into DTOs.
- Index for the queries you actually run: every FK, every cross-module ID, every filter and
  sort column on a list screen, composite indexes in the query's column order. Check the
  plan with `EXPLAIN ANALYZE` on realistic data volumes, not on ten seeded rows.
- Anything slow or bulky is a **background job**: exports, report generation, OCR,
  classification, bulk import, bulk update, notification fan-out, rollup refresh. The
  request returns a job ID; the UI polls or is notified.
- Bulk operations are chunked with progress, partial-failure reporting, and resumability —
  never one transaction over 50,000 rows.
- Cache deliberately and with an invalidation story: Next.js route/data caching for
  reference data, rollup tables for dashboards. An unbounded in-memory cache in a serverless
  runtime is not a cache.
- Frontend: stream with Suspense, lazy-load heavy components (charts, viewers, editors),
  keep `'use client'` at the leaves, and virtualise any list that genuinely must render
  more than ~100 rows.

---

## 22. Observability

📋 PLANNED. `platform/observability`. The standard: **when a user reports a problem, you
can reconstruct what happened from the logs without reproducing it — and without finding
sensitive data there.**

| Stream            | Contents                                                                                                                                                           | Retention                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| Application logs  | Structured JSON: timestamp, level, message, correlationId, actorId, module, operation, durationMs, safe context                                                    | 30 days                      |
| Error logs        | The above plus stack trace, fingerprint, request context                                                                                                           | 90 days                      |
| Audit log (§18.6) | Business and security events, in Postgres, append-only                                                                                                             | Per retention policy (years) |
| Metrics           | Request rate, latency percentiles, error rate, job queue depth and age, event outbox lag and DLQ size, integration success rate, AI cost and tokens, DB pool usage | 13 months (aggregated)       |
| Health checks     | `/api/health` (liveness) and `/api/health/ready` (DB, storage, queue)                                                                                              | —                            |

**Correlation ID** is generated at the edge of every request, attached to every log line,
propagated into jobs and events (as `correlationId` in the envelope), included in outbound
integration calls, and returned to the user in error responses as `traceId`. Without this,
debugging an asynchronous pipeline is guesswork.

**Alert on** (not merely log): error-rate spikes; authentication failure spikes and
repeated authorization denials; event dead-letter entries; jobs retried to exhaustion; job
queue age beyond threshold; integration circuit-breaker trips; failed scheduled reports;
ECM documents stuck in processing; AI spend above budget; health check failures.

**Never in a log or error message:** passwords, tokens, keys, connection strings, salary
figures, national IDs, bank details, document contents, or full request bodies that could
contain any of them. Log the entity **ID**, not the entity.

---

## 23. Deployment & Environment Management

✅ CI exists (`.github/workflows/ci.yml`: verify + build + dependency audit).
✅ A Supabase project is provisioned (`yobzdfdqonzjbeuvnqox`, eu-west-1, PostgreSQL 17.6)
with 4 migrations applied (schema, uuid defaults, unique indexes, RLS — ADR-015) and the
seed run.
📋 Nothing is deployed to a hosting environment yet.

**Environments:** `local` (developer machine, local or branch Supabase) → `preview` (per
pull request, isolated data, **never** production data) → `production`. Never point a
preview or local environment at the production database.

**Required environment variables** — `.env.local.example` is the authoritative list, and
`platform/config/env.ts` validates them at boot (names follow CaptureERP where equivalent):

```
DATABASE_URL=                      # pooled connection (app runtime)
DIRECT_URL=                        # direct connection (migrations — see note)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=         # SERVER ONLY — never NEXT_PUBLIC_*
APP_URL=
APP_ENV=                           # development | preview | production
STORAGE_BUCKET=
LOG_LEVEL=                         # debug | info | warn | error
# add as the features land: SMTP_*, AI provider keys, OCR provider keys, integration creds
```

Only variables genuinely safe in a browser bundle may be prefixed `NEXT_PUBLIC_`. A missing
or malformed required variable is a **hard failure at boot**, and the error names the
variable without ever printing its value.

**Connecting to Supabase — what actually works here.** The project is `yobzdfdqonzjbeuvnqox`
in **eu-west-1**. Both `DATABASE_URL` and `DIRECT_URL` point at the **session pooler**:

```
postgresql://postgres.<ref>:<password>@aws-1-eu-west-1.pooler.supabase.com:5432/postgres
```

Three findings worth keeping, because each cost time to establish:

1. **`db.<ref>.supabase.co` is IPv6-only.** It publishes an `AAAA` record and no `A` record.
   Any machine or CI runner without routable IPv6 gets `ENOTFOUND` and cannot use the direct
   connection at all. The session pooler is IPv4-reachable and is the right default.
2. **Use the SESSION pooler (port 5432), not the transaction pooler (6543).** Session mode
   supports prepared statements and DDL; transaction mode breaks both migrations and
   Prisma's prepared statements.
3. **The pooler username is `postgres.<project-ref>`**, and the hostname generation matters:
   this project is `aws-1-eu-west-1`, and `aws-0-eu-west-1` returns
   "tenant or user not found". Take the exact string from the dashboard rather than
   assuming.

**Migration connection caveat.** Prisma 7's `prisma.config.ts` exposes only `url`, so
`DIRECT_URL` is not wired in automatically. When the two differ, run migrations with the
direct connection substituted:

```bash
DATABASE_URL="$DIRECT_URL" npm run db:migrate
```

`.env.local` holds the real development credentials and is gitignored. CI needs no real
secrets: the build runs on placeholders, because proving the code compiles must never
require production credentials.

**Release rules.** CI runs `typecheck → lint → test → build` on every pull request and must
be green to merge. Migrations run as an explicit, reviewed step — `prisma migrate deploy`,
never `migrate dev` against a shared environment — and are backward-compatible with the
currently running code (expand-contract, §8.5) so a rollback does not corrupt data. Because
code can roll back but data cannot, the rollback plan for a destructive migration is written
_before_ it runs. Verify production deploys with the health endpoints, and keep a documented
backup and restore procedure that has been tested at least once.

**Vercel CLI is not installed.** `npm i -g vercel` enables `vercel env pull`, `vercel deploy`,
and `vercel logs` — useful, but environment variables in Vercel remain the source of truth.

---

## 24. Development Workflow

✅ Git is initialised on `main`, with a `.gitignore` covering `node_modules`, `.next` and
`.env*` (keeping `!.env.local.example`) in place **before** the first commit — so no secret
has ever entered history.

**The gate.** `npm run verify` runs `typecheck → lint → test`. It must pass before any
change is called done, and CI runs it on every pull request alongside a production build and
a dependency audit. Do not claim a change works without running it and reading the output.

**Build order.** Domains depend on the platform. Build the foundation first; a feature built
before its platform service will be rebuilt.

```
Phase 0  ✅ DONE  Foundation: scaffold, Prisma multi-schema, env validation, ESLint boundaries, CI
Phase 1  ✅ DONE (verified against live Postgres + Supabase Auth)
         IAM + platform/auth + platform/authz + platform/audit + the app shell.
         Outstanding: create the first administrator account (§28, §29 #2).
Phase 2  platform/jobs + platform/events dispatcher + platform/storage + notifications
Phase 3  ECM core (register → store → version → search → download, permissioned)
Phase 4  platform/workflow + the first real approval flow
Phase 5  CRM core (accounts, contacts, opportunities, pipeline-as-data)
Phase 6  ERP finance core (chart of accounts, invoices, payments, double-entry)
Phase 7  HRIS core (employees, org structure, sensitive-field isolation)
Phase 8  Innovation (ideas, configurable stage workflow, voting)
Phase 9  BI (rollups, dashboards, scheduled reports)
Phase 10 AI layer (OCR/classification, then permission-filtered semantic search)
```

**One module at a time, vertically.** For each: schema → migration → repository → service
(with permissions, audit, events) → API/action → UI → tests. Finish and verify a slice
before starting the next. (House rule from CaptureERP: do not scaffold several modules in
one pass.)

**Per-change loop.** Read the relevant code → confirm the owning module → write or update
the test → implement → `npm run verify` → update §28 and any affected docs → commit with a
message that says _why_. Conventional-commit prefixes scoped by module: `feat(crm):`,
`fix(ecm):`, `refactor(platform/authz):`.

**Escalate to the owner before acting** on: any migration (house rule — review the schema
diff first); any change to money calculations, permission logic, or RLS policy (house rule);
introducing a dependency or a technology; changing a cross-module contract or event payload;
anything that removes or weakens a test or a security control.

---

## 25. Claude Code Rules

**Read this section before every change.**

### 25.1 Before changing code

1. **Read the existing implementation** of what you are touching. Do not infer it from
   this document — this document states intent, the code states reality.
2. **Identify the owning module** (§26). If the change belongs to another module, work
   there instead of reaching across.
3. **Map dependencies:** who calls this, what events it publishes, who subscribes.
4. **Check the database relationships** and whether a migration is implied.
5. **Search for an existing component or service** that already does this. Reuse beats
   rebuild; a second `DataTable` or a second "send email" helper is a defect.
6. **Determine the permission** required, and its scope.
7. **Read the existing tests** — they encode requirements you are about to break.
8. **Confirm you are not duplicating functionality** that exists elsewhere.

### 25.2 Before creating anything new

Answer all six, out loud, in your response:

- Does something similar already exist in `components/ui/`, `platform/`, or this module?
- Which module owns this functionality, per §26?
- Can an existing service be extended instead?
- Does this introduce coupling between modules? If yes, can a contract or an event remove it?
- Does it violate any rule in this document?
- Which permission guards it, and which test proves the guard works?

### 25.3 Never

- Rewrite large parts of the application when a focused change would do.
- Introduce a framework, library, or database technology without an ADR and the owner's agreement.
- Duplicate a platform service inside a module (a second auth check, queue, mailer, or uploader).
- Duplicate a business entity that another module owns (a second customers or employees table).
- Bypass IAM, or add an `isAdmin` shortcut around the permission system.
- Bypass Zod validation at any boundary.
- Read or write another module's tables, or import its `services/` or `repositories/`.
- Hardcode a secret, key, token, or connection string.
- Hardcode a configurable business rule: approval thresholds, tax rates, pipeline stages,
  document types, retention periods, SLA hours, point values.
- Put sensitive data (salary, national ID, document content) in a log, an error message, or
  an event payload.
- Change the database schema without a migration, or edit a migration that has been applied.
- Remove or weaken existing functionality, a test, or a security control without an explicit
  instruction to do so.
- Claim something works without running it. Run `npm run verify` and report the real output.
- Mark a feature ✅ IMPLEMENTED in §28 when it is partial. Say 🟡 and say what is missing.

### 25.4 Always

- Preserve existing behaviour unless changing it is the point of the task.
- Follow the established architecture, even when a shortcut is shorter.
- Reuse existing components, services, and patterns.
- Keep the change focused: one concern per change; unrelated cleanups go in their own change.
- Check permission at the top of every service operation.
- Write the audit entry and publish the event **inside** the business transaction.
- Validate every input with Zod; return DTOs, never raw Prisma entities.
- Paginate every list.
- Add or update tests, including the negative authorization case.
- Update §28 (status) and §29 (debt) when reality changes.
- Record a significant decision as an ADR in §27.
- **State your assumptions explicitly** when the task is ambiguous, and proceed with the
  most defensible reading rather than stalling — but stop and ask when proceeding wrongly
  would be unsafe or destructive.

### 25.5 Red flags — stop and reconsider

"I'll just query their table directly" · "I'll add the permission check later" · "This
doesn't need a test" · "I'll put the threshold in the code for now" · "I'll store the file
in the database for simplicity" · "The UI hides the button, so it's protected" ·
"It's only an aggregate, so permissions don't matter" · "I'll disable the lint rule" ·
"I'll load all of them and filter in JS" · "I'll make this generic in case we need it".

Each of these is the start of a defect this document exists to prevent.

---

## 26. Module Ownership Matrix

The authoritative answer to "where does this belong?". One owner per entity. Other modules
reference by ID.

| Entity / concern                                                                            | Owner                                            | DB schema               | Others may                                                              |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------- | ----------------------------------------------------------------------- |
| User, Role, Permission, Group, OrgUnit, ApiToken, Delegation, LoginHistory                  | **IAM** (`platform/iam`, ADR-010)                | `iam`                   | Ask `can()`; FK to `iam.users(id)` for audit columns                    |
| Authentication & authorization decisions                                                    | **IAM** (`platform/authz` + `platform/auth`)     | `iam`                   | Only call it — never reimplement                                        |
| Session lifecycle                                                                           | **Supabase Auth** (not modelled in `iam`)        | —                       | Read the current user via `platform/auth`; never duplicate sessions     |
| Account/Company, Contact, Lead, Opportunity, Pipeline, Activity                             | **CRM**                                          | `crm`                   | Store `crm_account_id`                                                  |
| Invoice, Payment, Journal entry, Vendor, PO, Inventory, Asset, Project, Budget              | **ERP**                                          | `erp`                   | Store `erp_*_id`                                                        |
| Document, Version, DocumentType, Metadata, OCR, Classification, Retention                   | **ECM**                                          | `ecm`                   | Store `ecm_document_id`; link via `document_links`                      |
| Employee, Department, JobTitle, Org structure, Compensation, Attendance, Leave, Performance | **HRIS**                                         | `hris`                  | Store `hris_employee_id`; **never** read sensitive tables               |
| Idea, Assessment, Vote, Comment, Points, Badge                                              | **Innovation**                                   | `innovation`            | Read via contracts                                                      |
| KPI, Dashboard, Report, Rollup, Materialised view                                           | **BI**                                           | `bi`                    | Read BI views; BI reads everyone, writes no one                         |
| Workflow definition, instance, task, history                                                | **Workflow** (`platform/workflow`)               | `platform`              | Start instances, subscribe to completion                                |
| Notification, template, channel, preference                                                 | **Notifications** (`platform/notifications`)     | `platform`              | Call the channel-agnostic API                                           |
| Audit log                                                                                   | **Audit** (`platform/audit`)                     | `platform`              | Write via the service; read with permission; **never** update or delete |
| Event outbox, dispatcher                                                                    | **Events** (`platform/events`)                   | `platform`              | Publish and subscribe only                                              |
| Job queue, scheduler                                                                        | **Jobs** (`platform/jobs`)                       | `platform`              | Enqueue idempotent handlers                                             |
| Object storage, signed URLs                                                                 | **Storage** (`platform/storage`)                 | —                       | Through ECM for documents                                               |
| Search index and query                                                                      | **Search** (`platform/search`)                   | `platform`              | Index via the service; results are permission-filtered                  |
| Settings, feature flags                                                                     | **Config** (`platform/config`, `platform/flags`) | `platform`              | Read typed config; no ad-hoc `process.env` in modules                   |
| AI providers, embeddings, RAG                                                               | **AI** (`platform/ai`)                           | `platform` + `pgvector` | Call providers only through the interfaces                              |
| External adapters, webhooks                                                                 | **Integrations** (`platform/integrations`)       | `platform`              | Never call a vendor SDK from a module                                   |

**Disputed cases, resolved here** so they are not re-litigated:

| Question                                          | Answer                                                                                                                           |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Where does a customer's contract document live?   | ECM owns the document; CRM stores the link.                                                                                      |
| Where does an employee's salary live?             | HRIS, in `hris.compensation`, separately permissioned. ERP reads payroll totals via a contract, never the table.                 |
| Who creates the project when an idea is approved? | ERP, reacting to `innovation.IdeaConvertedToProject`.                                                                            |
| Who decides if a user may approve a $1M payment?  | IAM grants the permission; Workflow routes the task; ERP checks `erp.payment.approve` at action time. Three parts, one decision. |
| Where does "customer" live — CRM or ERP?          | **CRM.** ERP stores `crm_account_id`. This is the most common architectural mistake available here.                              |
| Who owns a person's identity — HRIS or IAM?       | HRIS owns the _person_ (Employee), IAM owns the _login_ (User), linked by `user_id`.                                             |
| Where do dashboard numbers come from?             | BI rollups, not live scans of transactional tables.                                                                              |

---

## 27. Architectural Decision Records

Format: context → decision → consequences → revisit trigger. Add an ADR for any decision a
future developer would otherwise reverse by accident. Long-form ADRs live in
`docs/decisions/NNNN-title.md`; the summary stays here.

**ADR-001 — Modular monolith, not microservices.** _Context:_ seven domains, one small team.
_Decision:_ one Next.js app, one Postgres database, schema-per-module, lint-enforced import
boundaries. _Consequences:_ one deploy, simple transactions, no network failure modes between
domains — but boundaries depend on discipline plus tooling, and all domains scale together.
_Revisit when:_ a domain needs independent scaling, security isolation, a different release
cadence, or a heavy isolated workload (ECM/OCR processing is the likeliest first candidate —
extract it as a worker, not the whole domain).

**ADR-002 — Application-layer authorization, RLS as defence in depth.** _Context:_ the
permission model (module.resource.action plus scope) is richer than RLS expresses comfortably,
and must be testable. _Decision:_ `platform/authz` is the primary mechanism; RLS is enabled
deny-by-default as a second line. _Consequences:_ authorization is unit-testable and uniform,
but a bug in a service is a real exposure, so every service operation needs a negative test;
also the Supabase client must never be used from the browser for business data.
_Revisit when:_ direct client-to-database access becomes a requirement.

**ADR-003 — Transactional outbox, not a message broker.** _Context:_ we need reliable
cross-module reactions without losing events. _Decision:_ events in a Postgres outbox written
in the business transaction, dispatched by a background worker. _Consequences:_ atomic and
inspectable with no new infrastructure; throughput is bounded by Postgres and delivery is
at-least-once, so every handler must be idempotent. _Revisit when:_ fan-out or throughput
outgrows a single database, or an external consumer needs a stream.

**ADR-004 — Postgres-backed job queue, not Redis/SQS.** _Context:_ background work needs
durability and transactional enqueue. _Decision:_ a `platform.job_queue` table with
`FOR UPDATE SKIP LOCKED` workers. _Consequences:_ one fewer system to operate, jobs visible
in SQL, transactional enqueue for free; lower throughput ceiling and polling latency.
_Revisit when:_ sustained job volume or latency requirements exceed what Postgres handles
comfortably.

**ADR-005 — Postgres full-text search, not Elasticsearch.** _Context:_ documents and business
records need search. _Decision:_ `tsvector` + `pg_trgm`, with `pgvector` for semantic search.
_Consequences:_ no sync pipeline, no second source of truth, and permission filtering is a
plain SQL join — but relevance tuning and very large corpora are weaker. _Revisit when:_ a
concrete relevance or latency requirement fails.

**ADR-006 — Money as integer minor units.** _Context:_ floating point corrupts financial
data. _Decision:_ `Int` in the smallest currency unit, formatted only at display. Inherited
from CaptureERP. _Consequences:_ no rounding drift; every developer must remember the unit —
so name variables `amountMinor` and centralise conversion in `lib/money.ts`.
_Revisit when:_ never, short of a currency needing more than integer range.

**ADR-007 — Schema-per-module in one database.** _Context:_ we want real boundaries without
distributed data. _Decision:_ one Postgres schema per module, cross-schema references by ID
without foreign keys (except to `iam.users`). _Consequences:_ the database enforces the
boundary and extraction later is tractable; referential integrity across modules becomes a
service and integrity-job responsibility. _Revisit when:_ a module is extracted to its own
service.

**ADR-008 — Single-tenant now, multi-tenant-ready.** _Context:_ the current need is one
organisation; a rewrite later would be expensive. _Decision:_ do **not** build tenant
isolation now, but keep org-unit scoping rigorous and never assume "one organisation" in
business logic. _Consequences:_ no tenant complexity tax today; if multi-tenancy arrives it is
a schema and scoping change rather than a redesign. _Revisit when:_ a second organisation is
a real requirement.

**ADR-009 — Bilingual EN/AR with RTL from day one.** _Context:_ the market requires Arabic,
and CaptureERP already ships Arabic labels and an RTL dashboard; retrofitting RTL is
expensive. _Decision:_ externalise all user-facing strings from the first component and use
logical CSS properties only. _Consequences:_ small ongoing discipline cost, no rewrite later.
_Revisit when:_ never.

---

**ADR-010 — IAM lives in `platform/`, not `modules/`.** _Context:_ §7 places the
authorization service in `platform/`, but IAM also owns real domain data (users, roles,
org units). If `platform/authz` read those tables while a `modules/iam` also owned them,
two components would own one dataset — the exact smell §26 exists to prevent. _Decision:_
IAM is a platform service. `platform/iam/` holds its permissions catalogue, grant resolution
and management services; `platform/authz/` holds the pure evaluator and the public API; the
admin UI lives in `app/(platform)/admin/`. There is no `modules/iam`. _Consequences:_ one
owner for the `iam` schema, no dependency-injection ceremony to let the evaluator read its
own data, and the "platform must not import modules" rule stays intact. The permission
catalogue still needs composing across modules, which is why `modules/catalogue.ts` exists
outside both. _Revisit when:_ IAM grows business workflows (joiner/leaver processes) that
are genuinely domain logic rather than infrastructure.

**ADR-011 — Pin TypeScript to 5.x and ESLint to 9.x.** _Context:_ at scaffold time npm
`latest` was TypeScript 7.0.2 and ESLint 10.10.0. Both break this toolchain:
`typescript-eslint@8` declares `typescript >=4.8.4 <6.1.0`, and `eslint-plugin-react`
(bundled in `eslint-config-next@16`) calls `context.getFilename()`, removed in ESLint 10 —
which crashes every lint run. ESLint 10 was installed, observed to fail, and reverted.
_Decision:_ TypeScript 5.9.3, ESLint 9.39.5, exact pins, no ranges anywhere in
`package.json`. _Consequences:_ we are deliberately behind `latest` on two tools, and an
`npm update` will break linting; in exchange, the boundary enforcement that the whole
architecture depends on actually runs. _Revisit when:_ `typescript-eslint` supports TS 7 and
`eslint-config-next` supports ESLint 10 — upgrade both together, and run `npm run verify`
before believing it worked.

**ADR-012 — Prisma 7 with the `pg` driver adapter.** _Context:_ Prisma 7 removed the
embedded query-engine connection; `PrismaClientOptions` now requires either a driver adapter
or a Prisma Accelerate URL, and `datasourceUrl` no longer exists. _Decision:_
`@prisma/adapter-pg` constructed in `lib/prisma.ts` from the validated `DATABASE_URL`, with
the datasource URL declared in `prisma.config.ts` rather than the schema. _Consequences:_
the connection is owned by a standard Postgres driver we can configure and instrument, at
the cost of one more dependency; and because Prisma 7's config exposes only `url`,
migrations against a pooled Supabase connection must be run with `DATABASE_URL` pointed at
the direct connection (documented in `.env.local.example`). _Revisit when:_ Prisma 8 reaches
GA, or Supabase's pooler makes a different adapter preferable.

**ADR-013 — UUID primary keys are generated by the database.** _Context:_ §8.4 documents
`id uuid default gen_random_uuid()`, but Prisma's `@default(uuid())` generates the value in
the CLIENT and emits no database default. The first integration run proved it: `column_default`
for `iam.roles.id` was empty. Any raw SQL insert — a data fix, a migration, a psql session,
a future RLS-era insert — would have failed on a null id. _Decision:_ every uuid primary key
uses `@default(dbgenerated("gen_random_uuid()"))`. _Consequences:_ the invariant holds
wherever the row is created, not only when Prisma creates it, which is what §8.4 means by
"the app is not the last line of defence"; the id is assigned by the database, so code must
read it back from the result rather than assuming it knew it in advance.
_Revisit when:_ never, short of changing the key strategy entirely.

**ADR-014 — Partial unique indexes for unscoped grants.** _Context:_ `iam.user_roles`
declares `@@unique([user_id, role_id, scope_type, scope_org_unit_id])`, and
`scope_org_unit_id` is NULL for every GLOBAL, OWN_ORG_UNIT and OWN grant. In SQL, NULL is
not equal to NULL, so the constraint permitted unlimited duplicate rows precisely in the
common case — a double-submitted "assign role" would have created two identical grants.
Duplicates are not a privilege escalation (the evaluator is idempotent over grants) but they
corrupt access review: "why does this user have this permission?" gains phantom answers, and
revoking one row leaves the other. _Decision:_ partial unique indexes
(`... WHERE scope_org_unit_id IS NULL`) on `user_roles` and `user_permission_grants`,
declared as raw SQL inside the Prisma migration history — Prisma's schema language supports
neither `UNIQUE NULLS NOT DISTINCT` nor partial indexes. Keeping them in `prisma/migrations`
rather than `supabase/migrations` means replaying history reproduces them and `migrate dev`
reports no drift. _Consequences:_ the constraint is split between the Prisma schema and raw
SQL, so anyone changing these tables must read both. _Revisit when:_ Prisma supports partial
indexes or `NULLS NOT DISTINCT`.

**ADR-015 — RLS deny-by-default, no policies, plus a revoke of the API roles.** _Context:_
ADR-002 called for RLS as defence in depth but deferred it. Before writing policies, the
actual attack surface was measured: probing the live PostgREST API with the publishable key
returned `PGRST106 "Only the following schemas are exposed: public, graphql_public"` for
every `iam`/`platform` table — Supabase does not expose these schemas today. That is a
**dashboard setting**, not a database-level guarantee, and it is exactly the kind of control
that gets changed by someone adding a table to `public` for an unrelated reason and
widening the exposed-schema list along with it. _Decision:_ enable RLS on every table in
both schemas with **zero policies** (deny-by-default: a non-owning role matches no rows for
any operation), and explicitly `REVOKE ALL` on both schemas from `anon` and `authenticated`
so the database itself refuses even if the dashboard setting ever changes. Separately,
`platform.audit_log` gets a `BEFORE UPDATE OR DELETE` trigger that unconditionally raises —
the append-only guarantee in §18.6 cannot be expressed as a `GRANT`, because the application
connects as the table owner and an owner keeps its rights; a trigger is the one control that
still fires for the owner. `TRUNCATE` is deliberately left open, because the integration
suite needs it to reset fixtures and it requires table ownership regardless.
_Consequences:_ the primary control is unchanged (Supabase's schema exposure) but is now
backed by two independent database-level controls that hold even if it is misconfigured;
the RLS enablement does **not** restrict the application itself, because it connects as the
table owner and `FORCE ROW LEVEL SECURITY` is deliberately not set — so this is depth added
against a future integration or a compromised anon key, not a control on today's app code.
Closing that remaining gap needs a dedicated, unprivileged application role (tracked in §29).
_Revisit when:_ a second, non-Supabase Postgres consumer of this schema exists, or when the
dedicated application role is built.

---

## 28. Current Implementation Status

**Snapshot date: 2026-09-13, after Phase 1 was verified end to end against a live database.
Keep this section honest and current — it is what the next session trusts.**

### Verification state — what was actually run

| Gate                                                   | Result                                                                                                                                         |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run verify` (typecheck → lint → test)             | ✅ 0 type errors, 0 lint errors, **107 tests passing**                                                                                         |
| `npm run build`                                        | ✅ succeeds, 10 routes                                                                                                                         |
| Integration suite, local PostgreSQL (default)          | ✅ **35 tests passing** in ~9s, self-cleaning (skipped unless `TEST_DATABASE_URL` is set)                                                      |
| Integration suite against **live Supabase**            | ✅ **35 tests passing** in ~55s (same suite, `TEST_DATABASE_URL` pointed at the pooler)                                                        |
| Playwright e2e vs **running app + live Supabase Auth** | ✅ **7 tests passing**                                                                                                                         |
| `prisma migrate deploy`                                | ✅ 4 migrations applied (schema, uuid defaults, unique indexes, RLS)                                                                           |
| `npm run db:seed`                                      | ✅ 25 permissions, 4 system roles, root org unit, 3 security policies                                                                          |
| `/api/health/ready`                                    | ✅ `{"status":"ready","checks":{"database":"ok"}}`                                                                                             |
| Anonymous access to `/dashboard`, `/admin/users`       | ✅ 307 → `/login?next=…`                                                                                                                       |
| Failed sign-in against live Supabase                   | ✅ uniform "Those credentials are not valid."; attempt recorded in `iam.login_history` with IP and user agent, **no credential in the record** |
| RLS + append-only trigger, both environments           | ✅ confirmed by direct query: RLS on all 20 tables, 0 policies, both triggers present, app reads/writes unaffected                             |

### Database — provisioned and verified

Supabase project `yobzdfdqonzjbeuvnqox`, eu-west-1, PostgreSQL 17.6, reached through the
session pooler (§23). Schemas `iam` (16 tables) and `platform` (4 tables). RLS enabled
deny-by-default on all 20 tables; `platform.audit_log` additionally rejects UPDATE/DELETE
via trigger (ADR-015). Mirrored on the local integration-test database, PostgreSQL 18.1.

| Migration                                  | What it does                                                         |
| ------------------------------------------ | -------------------------------------------------------------------- |
| `20260912163132_init`                      | The full `iam` + `platform` schema                                   |
| `20260912163714_uuid_db_defaults`          | Database-level `gen_random_uuid()` defaults (ADR-013)                |
| `20260912164500_unique_unscoped_grants`    | Partial unique indexes closing the NULL-in-unique hole (ADR-014)     |
| `20260913071500_rls_and_append_only_audit` | Deny-by-default RLS on all 20 tables + append-only trigger (ADR-015) |

Seeded baseline, confirmed by direct SQL: 25 permissions, 4 roles, 46 role-permission
links, 1 org unit, 3 security policies, **0 users**, 0 audit rows, 0 outbox rows.

### ✅ Implemented and verified

| Area                      | What exists                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository                | Git on `main`; `.gitignore` covered `.env*` before the first commit; `.gitattributes` normalises line endings                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Scaffold                  | Next 16 App Router, React 19, TypeScript 5.9 strict, Tailwind 4 CSS-first tokens                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Config                    | `platform/config/env.ts` — Zod-validated, hard-fails at boot, never echoes a value into an error; supports both Supabase client-key generations; the privileged key is **optional** because nothing uses it                                                                                                                                                                                                                                                                                                                      |
| Boundaries                | ESLint zone rules for all four boundary classes, each probe-tested to confirm it fires                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Database schema           | 20 tables across two schemas, applied and queried                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Authorization             | Pure evaluator: `module.resource.action`, four scope types, DENY-wins, validity windows, materialised-path subtree matching, no action implication. Verified against stored grants, including role/group/direct/delegated sources                                                                                                                                                                                                                                                                                                |
| Scope narrowing           | `scopeFilter` → Prisma `where`, fails closed. **Verified**: a unit-scoped reader sees 2 of 3 users and `total` reflects the narrowing                                                                                                                                                                                                                                                                                                                                                                                            |
| Audit                     | Append-only, no update/delete path, written inside the business transaction. **Verified**: rolls back with its transaction; permission denials recorded at WARNING                                                                                                                                                                                                                                                                                                                                                               |
| Events                    | Outbox writer requiring a transaction client. **Verified**: rolls back with its transaction; payload carries only entity IDs                                                                                                                                                                                                                                                                                                                                                                                                     |
| Auth                      | Supabase SSR clients; no auto-provisioning; sign-in/out actions; login history with IP and user agent                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Shell                     | One sidebar/header/breadcrumbs/user menu; navigation permission-filtered on the server, batched into one evaluation                                                                                                                                                                                                                                                                                                                                                                                                              |
| UI primitives             | `Button`, `TextInput`, `Panel`, `Badge`, `EmptyState`, `ErrorState`, `PageHeader`, `DataTable` (DB-side pagination, URL-state sorting, mobile column hiding). Styled to the TechVault design (`design/`, Modernist system): Archivo via `next/font`, zero radius, 2px rules, one red accent; tokens in `app/globals.css`; light and dark themes with a cookie-backed toggle read on the server (no inline script). The design's mock KPIs, search, Create, AI, notifications and SSO controls are deliberately not built (§17.6) |
| Admin screens             | Users, Roles, Permissions, Organisation units, Audit trail                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| IAM services              | `listUsers`, `setUserActive`, `assignRole` — permission-checked, Zod-validated, audit + event inside the transaction                                                                                                                                                                                                                                                                                                                                                                                                             |
| Scripts                   | Idempotent `db:seed`; `db:bootstrap-admin` to link a Supabase user and grant `platform-admin` (its npm script was missing from `package.json` until this fix — the file existed but was never runnable)                                                                                                                                                                                                                                                                                                                          |
| **Administrator account** | ✅ Created: `iam.users` row linked to a real Supabase Auth user, granted `platform-admin` (GLOBAL scope, 25 permissions). Verified by direct query, not just script output. Audit record written at CRITICAL severity.                                                                                                                                                                                                                                                                                                           |
| Tests                     | 107 unit/authz + 35 integration + 7 e2e; integration gated on a separate `TEST_DATABASE_URL`, runs against an isolated local PostgreSQL in ~9s, self-cleaning                                                                                                                                                                                                                                                                                                                                                                    |
| CI                        | verify + build + dependency-audit jobs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **RLS**                   | ✅ Enabled deny-by-default on all 20 tables in `iam` and `platform`, on both the local test database and Supabase, verified by direct query — 0 policies defined, which is correct (no non-owning role should read these tables at all). `platform.audit_log` additionally enforces append-only with a trigger rejecting UPDATE/DELETE for every role, including the owning connection. 5 integration tests assert both controls. See ADR-002 and ADR-015.                                                                       |

### 🟡 Partial — knowingly incomplete

| Area                                                             | State           | What is missing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Event pipeline                                                   | Writer verified | No dispatcher, subscriber registry, retries or DLQ (Phase 2). Events accumulate as a visible backlog.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **RLS's residual gap**                                           | Documented      | The app connects as `postgres`, the table owner, so RLS is bypassed for it by design (FORCE ROW LEVEL SECURITY is deliberately not set). The control that matters today is Supabase's exposed-schemas setting — verified: `iam`/`platform` are not exposed to PostgREST, confirmed by probing the REST API and getting PGRST106 — plus the API-role grants this migration revokes. A future dedicated, unprivileged application role would let RLS police the app's own queries too, and would close `TRUNCATE` on `audit_log` (§29). |
| i18n / RTL                                                       | Groundwork only | Logical CSS properties throughout and `locale` on the user; no string externalisation or Arabic yet (ADR-009).                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Notifications, search, jobs, workflow, storage, AI, integrations | Not started     | Phase 2+                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| CSP                                                              | Omitted         | Other security headers set in `next.config.ts`; CSP needs a nonce in `proxy.ts` (§29).                                                                                                                                                                                                                                                                                                                                                                                                                                                |

### 📋 Not started

All six domain modules (CRM, ERP, ECM, HRIS, Innovation, BI). Their navigation entries and
permission keys are declared but uncatalogued, so they correctly do not render.

### The honest summary

**The foundation is real, enforced, and now proven against a live database.** The integration
suite earned its place immediately by finding two defects no unit test could see. What
remains before Phase 1 is fully closed is a single human step: create the first Supabase Auth
user and bootstrap it.

### How to update this section

Move a row to 🟡 or ✅ and say what exists. Mark ✅ only when the feature is implemented,
permission-checked, tested **and** exercised against a real database. When in doubt, 🟡 with
a note. An inaccurate status section is worse than none, because the next session acts on it.

## 29. Technical Debt

Resolved (kept for the record, because each was a critical risk and regressing any of them
would be expensive):

| Was                                       | Now                                                                                                                        |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| No git repository                         | ✅ Initialised on `main` with a complete `.gitignore` **before** the first commit                                          |
| Authorization retrofitted                 | ✅ Built first; no business feature exists without it                                                                      |
| Boundaries unenforced                     | ✅ ESLint zones, probe-verified                                                                                            |
| Audit added later                         | ✅ Append-only, inside business transactions, verified to roll back                                                        |
| No tests on first features                | ✅ 107 unit/authz + 35 integration + 7 e2e                                                                                 |
| No database ever provisioned              | ✅ Supabase eu-west-1, 4 migrations applied, seeded                                                                        |
| No integration tests running              | ✅ 35 passing (27 authz/atomicity/constraints + 8 security), local by default                                              |
| `.env.local` placeholders                 | ✅ Real credentials in place (gitignored)                                                                                  |
| Unique constraints that did not constrain | ✅ Partial unique indexes (ADR-014)                                                                                        |
| UUIDs generated only in application code  | ✅ Database-level defaults (ADR-013)                                                                                       |
| No dedicated test database                | ✅ Local PostgreSQL 18.1, database `techvault_test`, isolated from the Supabase development data                           |
| Integration suite slow (~55s)             | ✅ ~9s locally via `npm run test:integration`                                                                              |
| RLS not enabled                           | ✅ Deny-by-default on all 20 tables + append-only trigger on `audit_log` (ADR-015)                                         |
| No administrator account                  | ✅ Created via `npm run db:bootstrap-admin`, granted `platform-admin`, verified by direct query                            |
| `db:bootstrap-admin` npm script missing   | ✅ Discovered when first run failed with "Missing script"; the file existed but was never wired into `package.json`. Added |

Open debt and risk:

| #   | Item                                                        | Why it matters                                                                                                                                                                                                          | Mitigation                                                                                                     | Severity  |
| --- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | **Event dispatcher missing**                                | Events are written but never delivered, so cross-module reactions silently do not happen                                                                                                                                | Phase 2                                                                                                        | 🟠 High   |
| 2   | **No CSP**                                                  | Other security headers are set; CSP needs a nonce-based policy in `proxy.ts` because Next injects inline bootstrap scripts                                                                                              | Implement with the nonce; never `unsafe-inline`                                                                | 🟠 High   |
| 3   | **Database password was shared in a chat transcript**       | The original was rotated on 2026-09-13 (old value verified rejected, new value verified by Prisma and `/api/health/ready`), but the replacement was also typed into the same transcript                                 | Rotate once more to a value that never appears in chat; update only `.env.local`                               | 🟡 Medium |
| 4   | **RLS does not restrict the app's own connection**          | The app connects as the table owner, which bypasses RLS by design (`FORCE ROW LEVEL SECURITY` is not set); the real barrier is Supabase's schema-exposure setting plus the revoked API grants (ADR-015), not RLS itself | Build a dedicated, unprivileged application role if a second, non-owner consumer of this schema ever exists    | 🟡 Medium |
| 5   | **Scoped DENY grants are not expressible as a list filter** | `scopeFilterFor` applies global denials but cannot express a scope-limited DENY as positive SQL, so a list may include a row the caller may not act on                                                                  | Documented in `evaluate.ts`: re-check any row a list acts on with `requirePermission` and a target             | 🟡 Medium |
| 6   | **Org-unit `path` is maintained by the service layer**      | A bug in re-parenting would silently widen or narrow access platform-wide, since scope resolution is a prefix match on this column                                                                                      | Write the re-parent operation with tests before exposing org-unit editing; consider a trigger or integrity job | 🟡 Medium |
| 7   | **Pinned below the latest TypeScript and ESLint**           | TS 7 and ESLint 10 break linting here (ADR-011); an innocent `npm update` breaks the lint run                                                                                                                           | Constraints documented in §3 and ADR-011                                                                       | 🟡 Medium |
| 8   | **i18n/RTL groundwork only**                                | Strings are hardcoded English; layout is RTL-ready but the text is not                                                                                                                                                  | Externalise strings when Arabic is scheduled (ADR-009)                                                         | 🟡 Medium |
| 9   | **`react-hook-form` installed but unused**                  | Phase 1 forms use `useActionState`. An unused dependency is small but real surface                                                                                                                                      | Use it in Phase 2 forms or remove it                                                                           | 🟢 Low    |

Add real debt here as it accrues, with why it was accepted and the trigger to repay it. A
TODO in code without a row here is invisible debt.

## 30. Future Roadmap

Sequenced by dependency, not by excitement. Each phase ends with something usable, tested,
and permission-checked.

| Phase                       | Scope                                                                                                                                                                                                                                                | Done when                                                                                                                                                                                                                                                               |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0 — Foundation** ✅       | `git init` + `.gitignore`; Next.js + TS strict scaffold; Prisma multi-schema; env validation; ESLint boundary zones; Vitest + Playwright; `npm run verify`; CI                                                                                       | ✅ Done. Verify passes (107 tests), build succeeds, all four boundary rules probe-tested                                                                                                                                                                                |
| **1 — Identity & shell** ✅ | IAM schema; Supabase auth; `platform/authz` with `can`/`requirePermission`/`scopeFilter`; `platform/audit`; admin console for users/roles/permissions/org-units/audit; the platform shell; deny-by-default RLS + append-only audit trigger (ADR-015) | ✅ **Fully done.** Verified against live Postgres and Supabase Auth: 4 migrations applied, seed run, first administrator account created and granted `platform-admin` (verified by direct query), 35 integration + 7 e2e tests passing. The command palette is deferred |
| **2 — Platform backbone**   | Job queue + worker; event outbox + dispatcher + DLQ; object storage adapter; notifications (in-app + email); config and feature flags                                                                                                                | An event reliably triggers a job that sends a notification, idempotently, with retries visible                                                                                                                                                                          |
| **3 — ECM core**            | Document register/store/version; document types and metadata schemas as data; permissioned download via signed URLs; full-text search; preview                                                                                                       | A document is uploaded, typed, searched, downloaded — every access audited, quarantine hook in place                                                                                                                                                                    |
| **4 — Workflow engine**     | Definitions, instances, tasks, sequential/parallel/conditional routing, SLA, escalation, delegation, history; first real approval flow                                                                                                               | An administrator changes an approval threshold **without a deploy**                                                                                                                                                                                                     |
| **5 — CRM core**            | Accounts, contacts, leads, opportunities, pipeline-as-data, activities, tasks; ECM document links                                                                                                                                                    | A sales user works a deal from lead to won, with documents attached and events published                                                                                                                                                                                |
| **6 — ERP finance core**    | Chart of accounts, double-entry journal, AR invoices, AP bills, payments, period close; approvals via workflow                                                                                                                                       | An invoice posts a balanced journal entry, is approved through workflow, and reconciles                                                                                                                                                                                 |
| **7 — HRIS core**           | Employees, departments, org tree, sensitive-field isolation, leave and attendance, self-service; IAM provisioning and revocation on termination                                                                                                      | Terminating an employee revokes platform access automatically — with a test proving it                                                                                                                                                                                  |
| **8 — Innovation**          | Ideas, categories, configurable stage workflow, assessments, voting, non-gameable points and badges, conversion to ERP project                                                                                                                       | An approved idea creates an ERP project via event, with the points ledger explainable                                                                                                                                                                                   |
| **9 — BI**                  | KPI definitions, rollup jobs, executive and per-module dashboards, scheduled reports, background exports                                                                                                                                             | A dashboard loads under 1 s from rollups and shows only permitted data                                                                                                                                                                                                  |
| **10 — AI layer**           | Provider abstractions; OCR and classification in the ECM pipeline; embeddings; permission-filtered semantic search; then an assistant                                                                                                                | Semantic search provably cannot return a document the user may not read                                                                                                                                                                                                 |
| **Later**                   | MFA; SSO (OIDC/SAML); mobile-optimised views; external/customer portal; advanced integrations (banking, Microsoft 365, WhatsApp); extraction of ECM processing into a worker if load justifies it (ADR-001)                                          | —                                                                                                                                                                                                                                                                       |

**Before building anything in any phase:** re-read §25, confirm ownership in §26, and check
§28 for what actually exists.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
