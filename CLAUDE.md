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
this document, and update it with every change.** Phases 2–4 and 6–10 remain 📋 PLANNED. The CRM (Phase 5) was built ahead of that
order at the owner's request and is 🟡 PARTIAL — see §28.

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
| Runtime    | Node.js                                                   | 24.14.0                  | `engines: 24.x` (a major upgrade is deliberate, not automatic on Vercel). Next requires >=20.9, Prisma >=24.          |
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

- **npm 12 blocks dependency install scripts** unless the root `package.json` lists them in
  `allowScripts` (pinned `name@version`). Vercel builds with npm 12. When you upgrade Prisma, esbuild or
  `unrs-resolver`, re-approve the new versions with `npx npm@12 approve-scripts <pkg>` or their install
  scripts are silently skipped.

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
│  │  └─ crm/ (🟡) erp/ ecm/ hris/ innovation/ bi/   # 📋 one segment per module
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
│  ├─ ui/                        # ✅ button.tsx, primitives.tsx, data-table.tsx, dialog.tsx, form-controls.tsx
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
- Activities are never deleted to rewrite history by the people who work them: only an administrator holding
  `crm.activity.delete` may delete a call, email, meeting, note or task (a soft delete, audited — ADR-024), and the
  CRM's own status and stage entries go only with their record. Calls, emails, meetings, notes and tasks may be corrected by
  holders of `crm.activity.update` within their scope — subject, text, timing, and a task's due date, priority and
  assignee — with every edit audited; an activity's type and linked records never change, and the CRM's own
  status and stage entries are immutable.
- Forecasting reads BI aggregates, never a full scan of the opportunity table.
- Customer documents are **ECM documents** linked by ID. CRM stores no files.

**Publishes:** `crm.CustomerCreated`, `crm.CustomerUpdated`, `crm.LeadConverted`,
`crm.OpportunityCreated`, `crm.OpportunityStageChanged`, `crm.OpportunityWon`,
`crm.OpportunityLost`, `crm.ActivityLogged`, and on administrator deletion `crm.LeadDeleted`, `crm.CustomerDeleted`,
`crm.ContactDeleted`, `crm.OpportunityDeleted`, `crm.ActivityDeleted` (ADR-024).

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

**Publishes:** `erp.ARInvoicePosted`, `erp.ARReceiptAllocated` and the other AR events of ADR-023 (in place of the
planned `erp.InvoiceCreated`, `erp.InvoiceIssued`, `erp.PaymentCompleted`),
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
// For records with no org unit or owner (ERP's ledger, module settings) — ADR-025:
requireGlobalPermission(actor, permission): Promise<void>    // only a GLOBAL grant passes
canGlobally(actor, permission) / canAllGlobally(actor, permissions[])
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
🟡 Deployed to Vercel (project `tech-vault`, Git-connected to `github.com/mabdelazizemail-tech/TechVault`,
`main` → Production, `vercel.json` sets the Next.js framework). The build succeeds with no secrets
(the Prisma client is created on first use); runtime variables are set in the Vercel dashboard.
Verified 2026-09-14 on `https://tech-vault-gamma.vercel.app`: `/api/health` 200,
`/api/health/ready` 200 with `database: ok` (Supabase session pooler), `/login` 200, and
`/dashboard` and `/crm` redirect anonymous visitors to sign-in. Per-deployment URLs sit behind
Vercel Deployment Protection; the production domain does not.

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
2. **Session pooler (5432) for migrations and local work; transaction pooler (6543) for
   Vercel.** Session mode supports DDL, so migrations must use it. But session mode holds one
   server connection per client and caps the project at 15 clients, and every Vercel function
   instance opens its own pool: production hit `EMAXCONNSESSION ... pool_size: 15` on
   2026-09-14 with two warm deployments. The runtime `DATABASE_URL` in Vercel therefore uses
   port **6543**. Verified that day with `@prisma/adapter-pg`: plain queries, interactive
   `$transaction`, 25 parallel queries and repeated identical statements all work in
   transaction mode. `lib/prisma.ts` also keeps each instance's pool small (`max` 2 outside
   development).
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
Phase 5  CRM core (accounts, contacts, opportunities, pipeline-as-data) — 🟡 built ahead of order (§28)
Phase 6  ERP finance core — 🟡 ERP Phase 1 "finance foundation" built (chart of accounts, periods,
         cost centres, double-entry journal, §28); ERP Phase 2 accounts receivable built (customer
         invoices, approval, receipts, allocation, balances, aging, §28); payables follow
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

**ADR-016 — CRM data model: one activity table, per-currency money, company-first deals.**
_Context:_ the CRM had to ship leads, deals and a single timeline of calls, emails, meetings, tasks and
notes, for a team that sells in both EGP and USD, directly and through channel partners. _Decision:_
(1) Prisma models are prefixed `Crm` (`CrmAccount`, `CrmLead`, …) so they cannot collide with other
modules' models in the one generated client; tables stay unprefixed inside the `crm` schema.
(2) One `crm.activities` table holds every activity type — tasks and notes included, plus the system
`STATUS_CHANGE`/`STAGE_CHANGE` rows — with nullable links to lead, company, contact and opportunity and
a CHECK that at least one is set: one timeline query, one permission model, no union views. (3) Every
amount carries its currency, and totals are a list with one entry per currency — never summed across
currencies, in services, DTOs or UI. (4) The sales channel (`DIRECT`/`INDIRECT` plus partner name) is a
column on the deal, enforced by CHECK. (5) An opportunity requires a company (`account_id NOT NULL`,
`ON DELETE RESTRICT`); conversion reuses an existing company by case-insensitive name and an existing
contact by email, backed by partial unique indexes on live rows. (6) Stages are rows with a `kind`
(`OPEN`/`WON`/`LOST`); closing requires details, enforced by the pure `planStageMove` rule and by a CHECK.
_Consequences:_ the timeline and dashboard are simple queries and a new activity type is an enum value;
mixed-currency pipelines stay honest at the cost of multi-line figures; a deal with no company cannot be
recorded until rule (5) is relaxed. _Revisit when:_ activity volume makes the single table a hot spot
(partition by `occurred_at`), reporting needs exchange rates (add a rates table and convert explicitly,
for reporting only), or the owner wants company-less deals.

**ADR-017 — Join-based relation loading and co-located compute.** _Context:_ a measured audit on
2026-09-14 found that Postgres execution was negligible (~0.4 ms per statement) and that page time was
network round trips: every statement cost ~80 ms because Vercel functions ran in `iad1` (Washington)
against Supabase in `eu-west-1`, and Prisma loaded nested relations one query per level, so the
per-request permission set took 21 statements in ~13 sequential rounds (1.06–1.13 s). _Decision:_
(1) enable Prisma's `relationJoins` preview feature, which loads nested relations in one SQL
statement; the permission set became 1 statement (95 ms) and the full unit, authz and integration
suites pass unchanged; (2) pin Vercel functions to `dub1` (`vercel.json` `regions`), the same AWS
region as the database. _Consequences:_ we depend on a Prisma preview feature — re-run the suites on
every Prisma upgrade, and if it regresses, remove the generator flag (behaviour is identical, only
slower). Moving the database would require moving the function region with it. _Revisit when:_
`relationJoins` reaches GA (drop the flag), or the database region changes.

**ADR-018 — Verify the session once with the Auth server, then locally.** _Context:_ every page made two
Supabase Auth round trips: `proxy.ts` and `getCurrentUser` both called `auth.getUser()`. The project signs
tokens with an asymmetric ES256 key (published JWKS). _Decision:_ `proxy.ts` keeps `getUser()` — it runs on
every matched request (pages, Server Actions, route handlers), refreshes the session and catches revoked
sessions. `getCurrentUser` now uses `getClaims()` via `platform/auth/verify-token.ts`, which verifies the
token signature against the public keys and its expiry locally; the keys are cached per process for 10
minutes (public data, safe to share), and an unknown key id or a symmetric token makes `getClaims` go to the
Auth server itself. The IAM `is_active` check still runs on every request. `lib/prisma.ts` sizes the pool from
the URL: 10 on the transaction pooler (6543), 2 otherwise. _Consequences:_ one Auth round trip per page
instead of two; negative unit tests prove a token signed by another key, altered, expired or without a subject
is rejected. Revocation is enforced by the proxy check on the same request, so a route excluded from the proxy
matcher must not rely on `getCurrentUser` alone. _Revisit when:_ the proxy matcher excludes a dynamic route,
or the project returns to symmetric JWT signing.

**ADR-019 — User administration: server-side, soft delete, and a last-administrator guard.** _Context:_ the
owner asked for full user administration for `platform-admin` (create, edit, roles, unit, activate/deactivate,
password reset, delete) without a parallel authorization system. Sign-in accounts live in Supabase Auth, outside
the database transaction. _Decision:_ (1) All privileged Supabase Auth calls are in
`platform/auth/identity-admin.ts`, the only code using `SUPABASE_SECRET_KEY`; it is server-only and authorises
nothing itself. (2) IAM services in `platform/iam/services/user-admin-service.ts` check permissions first — read
(view), create, update (profile, unit, status), administer (roles, sign-in email, password reset) and a new
`iam.user.delete` — then validate, then write the change, audit record and outbox event in one transaction.
Record-level checks use the target user's unit; a user outside scope is a 404. Granting or removing a role also
requires holding every permission it confers, so nobody can escalate. (3) Create makes the Supabase account first
(its id is the IAM id) and deletes it again if the IAM write fails; an email change updates Supabase first and
reverts on failure. (4) Delete is a soft delete: the IAM row is kept, deleted and inactive, so audit records,
sign-in history and CRM ownership stay attributable; roles, grants and group memberships are removed, API tokens
and delegations revoked, the Supabase account deleted, and the address cannot be reused. (5) Deactivation is
enforced by IAM on every request and, when the key is set, by a Supabase ban; a disabled account with a live
session is signed out through `/auth/signout` instead of looping between `/login` and the app, and sign-in
refuses it. (6) Deactivating, deleting or removing `platform-admin` takes a transaction-scoped advisory lock and
refuses to leave no active platform administrator. (7) Password resets use Supabase's reset email (implicit flow,
landing on the public `/auth/set-password` page); no administrator sets or sees a password, except an optional
temporary one at creation, which is never stored or audited. _Consequences:_ user administration is enforced on the
server and covered by 20 integration tests with Supabase Auth faked; creating, re-addressing and deleting sign-in
accounts needs `SUPABASE_SECRET_KEY` on the server and the set-password URL in Supabase's redirect allow list, and
Supabase's default email sender is rate-limited. _Revisit when:_ HRIS provisions accounts from
`hris.EmployeeCreated`, or deleted addresses must become reusable.

**ADR-020 — Messaging: database-owned delivery signals, Realtime for ephemera, ECM-gated attachments.** _Context:_ the
owner asked for internal one-to-one chat with presence, typing, delivery/read status, unread counts and document
sharing, without polling, without heartbeat writes, and without weakening ADR-002/015. The browser may not read
business data through Supabase, and no document store exists yet (ECM, Phase 3). _Decision:_ (1) A `messaging` module
and schema: `conversations` (DIRECT now, GROUP reserved; one direct conversation per pair via a unique sorted
`direct_key`), `conversation_participants` (per-person `last_delivered_at`/`last_read_at` watermarks — message status
is derived, never stored per message), `messages` (soft delete, client-chosen id as idempotency key),
`message_attachments` (`ecm_document_id` only, nothing copied) and `user_presence` (`last_seen_at` only). (2) Content
is read and written only through Server Actions that check the feature permission and participation. (3) Delivery:
AFTER INSERT/UPDATE triggers call `realtime.send` to the private topic `messaging:user:<id>` with ids only; the client
then fetches through a Server Action. A rolled-back write is never announced and a Realtime outage cannot block a
send. (4) Presence (`messaging:presence`) and typing (`messaging:conversation:<id>`) are Realtime only and never touch
a table; `last_seen_at` is written on connect and on page hide, at most once a minute. (5) Realtime authorization is
RLS on `realtime.messages` through one definer-rights function, `messaging.realtime_topic_allowed`; `authenticated`
gets USAGE on the schema and EXECUTE on that function, and no table privilege. (6) Triggers enforce what must hold even
for the owner connection: a sender must be an active participant; an attachment's sharer must be the message author, an
active participant, and able to read the document according to ECM's future contract function
`ecm.user_can_read_document(user, document)` — absent today, so attaching fails closed; attachments are immutable.
Viewers are re-checked against ECM with their own permissions when opening a document: sharing grants nothing.
(7) RLS on every messaging table is participant-only with no grants (the ADR-015 posture). (8) Sending writes no audit
row and no outbox event (the message row is the record); starting a conversation writes both. (9) The Realtime client
is imported after the page is idle, so no route ships it in its entry JavaScript. (10) The UI is a floating
Messenger mounted in the platform layout — launcher, panel, up to three chat windows by width, chat heads for
minimised chats, one full-screen chat on phones — not a page; the panel and windows are a separate chunk loaded on
first use. Window state is plain React state (the layout persists across navigation) mirrored to sessionStorage. _Consequences:_ no polling, one
UPDATE per read however many messages it covers, and chat history survives deactivation and deletion. Document sharing
is unavailable until ECM publishes its contract function; presence reveals online user ids to any active account; a
message costs one extra round trip after its signal. _Revisit when:_ ECM ships (add the picker, cards and viewer link),
group chat is built (receipts already generalise), or Realtime connection quotas bind.

**ADR-021 — THE THINK TANK: a deliberately simple innovation module, with files in private storage.** _Context:_ the
owner asked for Innovation (§6.6) as "a simple internal innovation and knowledge hub, not a complicated enterprise
platform": ideas with votes and comments, a knowledge library with files, projects that grow from approved ideas, and
an Ask Think Tank screen ready for AI later. §6.6 planned a workflow-engine stage pipeline, gamification and conversion
to ERP projects; none of Phase 2 (storage, jobs), Phase 3 (ECM), Phase 4 (workflow) or ERP exists. _Decision:_ (1) Schema
`innovation`, module `modules/innovation`: categories (rows, per kind), files, ideas (+ votes, comments), knowledge_items
(documents, SOPs, best practices, lessons learned and templates are CATEGORIES, and a project's documents and lessons
are knowledge items linked to it — one searchable library), projects (+ members). (2) Idea status is a plain field an
administrator sets — New, Reviewing, Approved, In progress, Implemented, Rejected — not a workflow definition; no points,
badges or leaderboard. One 👍 vote per person, never on one's own idea: the primary key (idea_id, user_id) is the unique constraint, a trigger refuses self-votes, and a second trigger keeps `ideas.vote_count` exact for any writer. RLS on `idea_votes` lets active users see votes and add or remove only their own (no grants to API roles; ADR-015). Lists sort by newest, most voted or most commented through indexes on the counters; administrators see a top-voted panel on the Ideas page. (3) "Projects" here are
innovation initiatives owned by THE THINK TANK, not ERP projects; converting publishes
`innovation.IdeaConvertedToProject`, so ERP can react when it exists. (4) Files: `platform/storage` over a private
Supabase Storage bucket (`techvault-documents`, created by the migration, no storage policies) reached only with
`SUPABASE_SECRET_KEY`. Browsers upload straight to storage through a one-time signed URL; before an item is saved the
server reads the object's size and first 4 KB and accepts it only if its bytes match its extension; downloads and
previews are authorised against the owning item, audited, and served through links that expire in 1–5 minutes. When
ECM is built, these files migrate into it (§29). (5) Permissions: members read, submit, vote, comment, add knowledge,
download and ask; one `administer` permission per area; a seeded `think-tank-admin` role; members' permissions are added
to the employee and sales roles. (6) Search is Postgres full-text ('simple' configuration, so Arabic works) on expression
GIN indexes, with prefix matching; lists fetch ids through the index and rows by id, 20 per page. (7) Ask Think Tank
calls an `AnswerEngine`; V1's keyword engine returns ranked, permission-filtered sources with highlighted passages and
no generated answer, and the UI already renders an answer above the sources for the Phase 3 AI engine. _Consequences:_
simple to use and to maintain; file features need the secret key on the server; the knowledge library duplicates part of
ECM's future role until ECM absorbs it; no malware scanning yet. _Revisit when:_ ECM ships (move files and knowledge
documents into it), the workflow engine exists (if review needs routing), or Phase 3 connects AI.

**ADR-022 — ERP Phase 1: a finance foundation whose ledger invariants live in the database.** _Context:_ the owner
asked for ERP incrementally, starting with finance only: a chart of accounts, accounting periods, cost centres and a
double-entry journal that is authorised, audited, immutable once posted and corrected only by reversal. No workflow
engine exists yet (Phase 4), and the permission catalogue requires every key's last segment to equal its action.
_Decision:_ (1) `modules/erp`, with finance as the internal sub-domain `services/finance/`, and schema `erp`: `accounts`
(a tree of headings and postable accounts; normal balance defaults from the type), `cost_centres` (a tree),
`fiscal_periods` (OPEN/CLOSED, no fiscal-year shape assumed), `journal_entries` (DRAFT → POSTED → REVERSED),
`journal_lines` and `journal_sequences`. (2) Money is BIGINT minor units, EGP only; amounts people type are parsed
from text without floats (at most 11 integer digits, 500 lines per entry), and services refuse any figure outside
JavaScript's safe-integer range rather than round it. (3) The database enforces the ledger for every writer, the owner
connection included: CHECKs (a line is exactly one of debit or credit, never negative; lifecycle columns match the
status); a range exclusion constraint so periods never overlap; a guard trigger that creates entries as drafts, posts
only into the open period containing the entry date (locking that period FOR SHARE, so a close and a posting cannot
interleave), freezes a posted entry except for becoming REVERSED, never deletes one, and freezes the lines of any
non-draft; and a DEFERRED constraint trigger that at commit requires at least two lines, debits equal to credits and
above zero, a matching stored total, active postable accounts and active cost centres at the moment of posting, and a
posted reversal for every reversed entry. Tree triggers keep accounts and cost centres acyclic and type-consistent,
and fix the type of an account used in journal entries. (4) Services mirror the rules for precise messages. Posting
locks the entry, re-validates everything, takes a gap-free `JE-YYYY-NNNNNN` from a per-year counter row inside the
transaction — numbers are assigned at posting, so deleted drafts leave no gaps — and writes the audit record and
`erp.JournalEntryPosted` in the same transaction. Reversal creates and posts an equal and opposite entry, marks the
original REVERSED and publishes `erp.JournalEntryReversed`. Closing refuses while drafts are dated in the period and
publishes `erp.PeriodClosed`; reopening needs its own permission and a reason and is audited at CRITICAL. (5)
Permissions keep `module.resource.action`: four IAM actions — POST, REVERSE, CLOSE, REOPEN — were added to
`iam.PermissionAction` (migration `20260914191000_finance_permission_actions`), so `erp.journal.post`,
`erp.journal.reverse`, `erp.period.close` and `erp.period.reopen` are distinct grants and the catalogue invariant holds;
the evaluator is unchanged. Seeded roles: `finance-admin` (everything) and `accountant` (no period create, close or
reopen, no account deactivation). (6) No `crm_account_id`, and no receivables, payables or reporting tables, until a
phase needs them. _Consequences:_ a service bug cannot write an unbalanced, edited or deleted ledger — integration tests
prove it by writing straight at the tables; the triggers and the Prisma schema must change together; posting has no
maker–checker until the workflow engine exists (§29 #26); the ledger is single-currency. _Revisit when:_ the workflow
engine arrives (route posting approval through it), receivables or payables need foreign currency, or reporting needs
balances (from rollups, §6.7).

**ADR-023 — ERP Phase 2: accounts receivable on the Phase 1 ledger, with CRM as the only customer record.** _Context:_
the owner asked for customer invoicing through to cash — CRM customer → invoice → approval → posting → receipt →
allocation → balance → aging — reusing the Phase 1 ledger, duplicating no CRM customer data, and with no second
workflow engine (Phase 4 does not exist). _Decision:_ (1) Ten `erp` tables: `ar_settings` (one row), `number_series`
and `number_series_counters`, `tax_rates`, `payment_methods`, `ar_customer_profiles`, `ar_invoices`,
`ar_invoice_lines`, `ar_receipts`, `ar_receipt_allocations`. There is no customer table: documents and the optional
billing profile (payment terms, credit limit, receivable account, notes) store only `crm_account_id`. Names are read at
display time through CRM's reference contract (`getAccountReferences` / `searchAccountReferences` in
`modules/crm/contracts/service.ts`), which returns only id, name and whether the company still exists and checks no CRM
permission — holding an AR permission is what entitles the reader to the customer's name. A company deleted in CRM keeps
its receivables history, shown as no longer in CRM; new documents refuse it. (2) Totals belong to the server. A line is
quantity (`numeric(18,4)`, an integer scaled by 10⁴ in code) × unit price, rounded half away from zero, less a discount,
plus tax at the line's rate in basis points, which the line keeps; invoice totals are sums of lines. Totals, statuses and
numbers sent by a browser are ignored, and CHECKs recompute every line figure in SQL, so a writer that bypasses the
services cannot store a wrong amount either. EGP only; discounts net against revenue; tax rates are rows credited to a
liability account, none seeded. (3) Lifecycle: invoice DRAFT → PENDING_APPROVAL → APPROVED → POSTED → PARTIALLY_PAID →
PAID, or CANCELLED; receipt DRAFT → POSTED, or CANCELLED. Approval is a status plus a permission, not a workflow:
`ar_settings` says whether invoices need approval, above what threshold, and whether a creator may approve their own
(off by default). An invoice the rule does not catch is marked approval-skipped at submission; a rejection returns it
to draft with a reason. (4) Posting reuses the ledger through the module-private `services/finance/ledger.ts`. An
invoice posts Dr receivable (total), Cr revenue per account and cost centre (net), Cr tax accounts; a receipt posts Dr
the deposit account, Cr receivable. Document, number, journal entry, audit record and outbox events commit in one
transaction, and the Phase 1 guard still refuses a closed period. Numbers (`INV-2026-000001`, `RCT-2026-000001`) come
from a configurable series at posting, so abandoned drafts leave no gaps. (5) `paid_minor`, `outstanding_minor`, the
payment status and a receipt's `allocated_minor` are cached columns maintained only by the allocation trigger, which
locks the receipt and invoice rows and refuses to exceed either; deferred checks at commit require invoice totals to
equal the sum of the lines, paid to equal the sum of allocations, and a document's journal entry to match it. Concurrent
allocations to one invoice therefore serialise and cannot over-allocate. (6) Corrections are voids, never edits: a
posted invoice or receipt with nothing allocated is cancelled by reversing its journal entry (`void_journal_entry_id`);
allocations must be removed first. Credit notes are deferred. A journal entry raised by a document (`source_type` set)
cannot be reversed from the journal screens, and closing a period is also refused while unposted invoices or draft
receipts are dated in it. (7) Balances are derived, never stored per customer: balance = posted invoices − posted
receipts; aging buckets each open invoice's outstanding amount by days past due (`ar_settings.aging_bucket_days`,
default 30/60/90/120) and shows unapplied receipts as a credit; the subledger equals the ledger balance of the
receivable accounts, proven by an integration test. (8) Permissions: `erp.ar_invoice.{read,create,update,approve,post,
cancel}`, `erp.ar_receipt.{read,create,update,post,allocate,cancel}`, `erp.ar_customer.{read,update}`,
`erp.ar_aging.read`, `erp.ar_settings.administer`. IAM gains the actions CANCEL and ALLOCATE in their own migration,
because a new enum value cannot be used in the transaction that adds it. `finance-admin` holds all of them;
`accountant` has no approve, cancel, customer-terms or settings rights. (9) Events carry ids and amounts only:
`erp.ARInvoiceApproved`, `ARInvoicePosted`, `ARInvoiceCancelled`, `ARReceiptPosted`, `ARReceiptAllocated`,
`ARReceiptUnallocated`, `ARReceiptCancelled`; they replace §6.2's planned `InvoiceIssued` and `PaymentCompleted`.
_Consequences:_ a service bug cannot over-allocate, store a mispriced line, or leave a document out of step with its
ledger entry; the SQL and the Prisma schema must change together; the credit limit is shown, not enforced; invoices
carry no billing-name, address or tax-registration snapshot, so they are not e-invoices; customer lists and aging
aggregate transactional tables live. _Revisit when:_ credit notes, foreign currency or Egyptian e-invoicing are
required; the workflow engine exists (route approval through it); or AR lists pass ~200 ms (rollups, §6.7).

**ADR-024 — CRM deletion: administrators only, soft, taking what belongs to the record.** _Context:_ the owner asked that
an administrator can delete any CRM record. The five `crm.*.delete` permissions had existed since the CRM shipped, held by
`platform-admin` and by the Sales role, but no delete operation existed, and §6.1 said activities are never deleted. ERP
invoices reference `crm_account_id`. Activities logged on a contact or an opportunity are filed under its company
automatically, and conversion copies a lead's history onto the company, contact and opportunity it became. _Decision:_
(1) Only administrators delete: `CRM_DELETE_PERMISSIONS` are removed from `CRM_SALES_PERMISSIONS`, so `platform-admin`
alone holds them. (2) Deletion is soft — `deleted_at` and `updated_by` are set, every CRM read already filters them, and
there is no restore screen and no permanent delete. Company names and contact emails become reusable through the
existing live-row unique indexes; ERP keeps working because the reference contract reports a deleted company as no longer
existing. (3) Each delete is one transaction in `services/deletion-service.ts`. A company takes its live contacts and
opportunities and their activities, keeping any activity also attached to a record that stays (in practice a converted
lead). A lead takes the activities attached to nothing else that stays, so the history it passed to a company remains
there. A contact or an opportunity takes every activity logged on it, stage history included, because the
automatically filled company must not keep them; only a converted lead's history stays, with the lead. The CRM's status
and stage entries cannot be deleted one by one. (4) Each service checks that the caller may read the record (otherwise
404) and then holds the delete permission for the record's scope target (otherwise 403); it marks the record with a
conditional update, so a second simultaneous delete finds nothing; and it writes one WARNING audit record listing
everything deleted with it plus one event (`crm.LeadDeleted`, `crm.CustomerDeleted`, `crm.ContactDeleted`,
`crm.OpportunityDeleted`, `crm.ActivityDeleted`, ids only). (5) Reads never link to a deleted record: activity chips, a
converted lead's links and an opportunity's primary contact skip them; opportunity–contact join rows are kept. (6) The
confirmation shows counts from `getDeletionImpact`, computed with the same rule the delete uses. No migration.
_Consequences:_ an accidental delete can only be undone by a database fix; salespeople can no longer delete anything;
deleting a contact also removes a deal's calls or notes that named that contact; deleted rows stay in the database.
_Revisit when:_ the owner wants a restore screen, bulk delete, or permanent deletion for data-protection requests.

**ADR-025 — ERP requires organisation-wide grants.** _Context:_ the ERP audit of 2026-09-15 found that ERP services
called `requirePermission` with no target, because ledger records carry no org unit or owner, and `evaluate()` treats "no
target" as "could do this to anything", so any scope passes. User administration can grant roles scoped to an org unit,
the user's own unit or own records, so an "accountant for one branch" would have posted, reversed and approved for the
whole organisation. _Decision:_ the owner chose organisation-wide finance access only. `platform/authz` gains
`evaluateGlobal` (pure) and `requireGlobalPermission`, `canGlobally` and `canAllGlobally`, which pass only an active GLOBAL
ALLOW; any applicable DENY, of any scope, still wins, and a refusal is logged and audited as `OUT_OF_SCOPE` like any other
denial. Every ERP service, the ERP layout and every ERP page use them. The evaluator's targetless behaviour is unchanged,
because navigation relies on it. _Consequences:_ a scoped finance grant authorises nothing in ERP and must be re-granted
globally; the sidebar can still show the ERP section to such a user, whose ERP pages then return not-found (§29 #39).
_Revisit when:_ finance must be split by org unit or legal entity — ledger records would then need a unit to scope by.

**ADR-026 — Ledger reports read the posted journal directly, as pure arithmetic on per-account sums.** _Context:_ the
ERP audit found no trial balance, profit and loss or balance sheet, so the books could not be reviewed from the app; the
owner asked to finish finance and receivables before payables. No fiscal year or year-end close exists (§29 #40).
_Decision:_ (1) `services/finance/report-service.ts` runs one grouped statement per report over `journal_lines` joined to
entries in POSTED or REVERSED status (a reversed entry and its reversal both stay in the ledger and cancel out; drafts are
excluded), returning opening (before `from`) and period debits and credits per account. Because AR invoices and receipts
post through the same ledger engine, these are the complete books. (2) The rules live in `domain/reports.ts` as bigint
arithmetic: the trial balance puts each closing balance on its side and flags any imbalance; statements sign amounts by
account TYPE (assets and expenses debit-positive), so a contra account reduces its section. (3) The balance sheet shows
revenue less expenses to date as "profit or loss not yet closed" until year-end close exists, which keeps it balancing;
the profit and loss defaults to the calendar year to date, a display default only. (4) Reading needs `erp.account.read`
and `erp.journal.read`, organisation-wide (ADR-025) — no new permission, so no re-seed. (5) One page,
`/erp/finance/reports`, with the three views as URL state. Rows are one per account with postings, capped at 5,000 with a
clear error rather than a truncated total. _Consequences:_ no migration; figures are live, so their cost grows with posted
lines (§29 #41). _Revisit when:_ a report query passes ~200 ms (rollups, §6.7), or the fiscal year and year-end close are
decided.

**ADR-027 — Finance settings: separation of posting, opening balance journals, a calendar fiscal year.** _Context:_ the
ERP audit's open decisions. The owner chose a setting that blocks posting your own journal by default, credit notes
against one posted invoice (built later), the calendar year as the fiscal year, and opening balance journals for
balances brought over from a previous system. _Decision:_ (1) Migration `20260915100000_erp_finance_settings` adds
`erp.finance_settings` (one row, CHECK `id = 1`, deny-by-default RLS): `allow_self_posting` (default false) and the
retained earnings and opening balance accounts (equity, checked by the service, `ON DELETE RESTRICT`). It also adds
`journal_entries.kind` — `STANDARD` (existing rows), `OPENING_BALANCE`, `YEAR_END_CLOSE` — with an index on
`(kind, entry_date)`; `YEAR_END_CLOSE` exists now so year-end close needs no second enum migration, and a posted entry's
kind is already frozen by `journal_entries_guard`. (2) `postJournal` refuses, inside the posting transaction, when the
actor created or last edited the draft, unless settings allow it; with no settings row it is not allowed. Documents
keep their own rules (AR approval, ADR-023). The journal page says why posting is unavailable; switching self-posting on
is audited at WARNING. (3) An opening balance journal is an ordinary journal of kind `OPENING_BALANCE`: the same posting
rules, period and reversal, listed and filtered as its own type, and the form adds the balancing line to the
configured opening balance account. People can never enter `YEAR_END_CLOSE`. (4) `erp.finance_settings.administer`
(finance-admin, not accountant) guards `/erp/finance/settings`. The starter chart gains 3200 Retained Earnings and 3900
Opening Balance Equity, and the seed creates the settings row pointing at them — create only. (5) The fiscal year is the
calendar year, which year-end close and the profit and loss default use. _Consequences:_ a one-person finance team must
switch self-posting on (audited) before posting its own journals; after deploying, run the seed (new permission,
settings row, two accounts); the ERP E2E journey needs self-posting allowed. _Revisit when:_ the workflow engine exists
(route journal approval through it), or a fiscal year other than the calendar year is needed.

---

## 28. Current Implementation Status

**Snapshot date: 2026-09-13 — Phase 1 verified end to end against a live database; the CRM module
built and verified the same day.
Keep this section honest and current — it is what the next session trusts.**

### Verification state — what was actually run

| Gate                                                   | Result                                                                                                                                         |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run verify` (typecheck → lint → test)             | ✅ 0 type errors, 0 lint errors, **127 tests passing**                                                                                         |
| `npm run build`                                        | ✅ succeeds, 27 routes (16 of them CRM)                                                                                                        |
| Integration suite, local PostgreSQL (default)          | ✅ **54 tests passing** (35 platform + 19 CRM), self-cleaning (skipped unless `TEST_DATABASE_URL` is set)                                      |
| Integration suite against **live Supabase**            | ✅ **35 tests passing** in ~55s (same suite, `TEST_DATABASE_URL` pointed at the pooler)                                                        |
| Playwright e2e vs **running app + live Supabase Auth** | ✅ **7 tests passing**                                                                                                                         |
| `prisma migrate deploy`                                | ✅ 5 migrations applied (schema, uuid defaults, unique indexes, RLS, CRM module)                                                               |
| `npm run db:seed`                                      | ✅ 47 permissions (22 CRM), 5 system roles (adds `sales`), root org unit, 3 security policies, 7 pipeline stages                               |
| `/api/health/ready`                                    | ✅ `{"status":"ready","checks":{"database":"ok"}}`                                                                                             |
| Anonymous access to `/dashboard`, `/admin/users`       | ✅ 307 → `/login?next=…`                                                                                                                       |
| Failed sign-in against live Supabase                   | ✅ uniform "Those credentials are not valid."; attempt recorded in `iam.login_history` with IP and user agent, **no credential in the record** |
| RLS + append-only trigger, both environments           | ✅ confirmed by direct query: RLS on all 20 tables, 0 policies, both triggers present, app reads/writes unaffected                             |

### Database — provisioned and verified

Supabase project `yobzdfdqonzjbeuvnqox`, eu-west-1, PostgreSQL 17.6, reached through the
session pooler (§23). Schemas `iam` (16 tables), `platform` (4 tables) and `crm` (7 tables). RLS enabled
deny-by-default on all 20 tables; `platform.audit_log` additionally rejects UPDATE/DELETE
via trigger (ADR-015). Mirrored on the local integration-test database, PostgreSQL 18.1.

| Migration                                  | What it does                                                                                       |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `20260912163132_init`                      | The full `iam` + `platform` schema                                                                 |
| `20260912163714_uuid_db_defaults`          | Database-level `gen_random_uuid()` defaults (ADR-013)                                              |
| `20260912164500_unique_unscoped_grants`    | Partial unique indexes closing the NULL-in-unique hole (ADR-014)                                   |
| `20260913071500_rls_and_append_only_audit` | Deny-by-default RLS on all 20 tables + append-only trigger (ADR-015)                               |
| `20260913171405_crm_module`                | The `crm` schema: 7 tables, CHECK invariants, live-row partial unique indexes, deny-by-default RLS |

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
| UI primitives             | `Button`, `TextInput`, `Panel`, `Badge`, `EmptyState`, `ErrorState`, `PageHeader`, `StatCard`, `DataTable` (DB-side pagination, URL-state sorting, mobile column hiding). Styled to the September 2026 Lovable redesign: Archivo via `next/font`, 16px root, zero radius, 2px neutral rules (`.panel`, `.rule-*`), `.label-caps` captions, ink for primary actions and the active nav item, brand red only for the TV mark, the Messenger launcher, header links, focus and danger; tokens (oklch) in `app/globals.css`; light and dark themes with a cookie-backed toggle read on the server (no inline script). Shell: grouped sidebar with icons (a drawer below `lg`), header with breadcrumbs, theme and user menu. The design's global search and notification bell are deliberately not built until those features exist (§17.6); pages beyond the Dashboard inherit the tokens and primitives but have not been individually redesigned or walked through signed in |
| Admin screens             | Users (full administration: add, edit, roles, unit, activate/deactivate, password reset, soft delete, details — ADR-019), Roles, Permissions, Organisation units, Audit trail                                                                                                                                                                                                                                                                                                                                                    |
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

### 🟡 CRM module — built ahead of the phase order, at the owner's request

Phase 5 was requested before Phases 2–4. It stands on the Phase 1 platform (authz, audit, outbox
writer) and needs nothing from Phases 2–4 to work; what it gives up by going first is listed under
"Missing" and in §29. Design decisions are in ADR-016.

| Area        | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data model  | ✅ `crm` schema, 7 tables: accounts, contacts, leads, opportunity_stages, opportunities, opportunity_contacts, activities. Money is `Int` minor units with an explicit `EGP`/`USD` currency. CHECKs: closing details (WON needs `won_at`; LOST needs `lost_at` and a reason), partner required for indirect deals, scores and probabilities in range, every activity linked to at least one record. Partial unique indexes on live company name (case-insensitive) and live contact email. RLS deny-by-default, API roles revoked.                                                                                                                       |
| Services    | ✅ Leads (wizard create, status, bulk status/owner, conversion that reuses an existing company by name and contact by email), companies, contacts, opportunities (board with per-stage counts and per-currency totals, moves with Won/Lost details), unified activities (call/email/meeting/task/note plus system status and stage rows), search, dashboard. Every write: permission → Zod → one transaction with audit entry, outbox event and timeline row. Reads are scope-filtered; an out-of-scope record is a 404.                                                                                                                                 |
| Deletion    | ✅ Administrators (holders of `crm.*.delete`, i.e. `platform-admin`; Sales no longer holds them) soft-delete leads, companies, contacts, opportunities, and calls, emails, meetings, tasks and notes, from the record pages and the activity feeds, after a confirmation that shows server counts. A company takes its contacts, opportunities and their activities; a contact or opportunity takes every activity logged on it; a converted lead's history stays with the lead; status and stage entries go only with their record. One transaction, a WARNING audit record and a `crm.*Deleted` event per delete; reads never link to deleted records (ADR-024). 11 integration and 5 unit tests. |
| UI          | ✅ `/crm` dashboard; leads table (status tabs, search, filters, sort, pagination, bulk selection); 4-step lead wizard; lead detail (status progression, timeline, edit slide-over); conversion confirmation screen; pipeline board (native drag and drop with drop-target feedback, optimistic move with rollback, Won/Lost modals, keyboard "Move to" menu, one-stage-at-a-time layout on phones) plus a table view and filters (owner, stage, currency, channel, amount, close date, industry, lead source); opportunity detail with stage tracker; companies and contacts with related records; activities, tasks and notes feeds; global CRM search. |
| Tests       | ✅ 19 CRM integration tests (create → convert → dedupe → move → won/lost, board totals, EGP/USD kept apart, OWN scope, database invariants) and 19 unit tests (pure pipeline rules, schemas).                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Data        | ✅ Migration applied to the local test database and to Supabase; `npm run db:seed` adds the `sales` role, CRM permissions and the 7 stages; `npm run db:seed:crm` loaded demo data into Supabase (8 companies, 15 contacts, 15 leads, 12 opportunities, 46 activities); on 2026-09-14 the owner had all CRM records removed (verified 0 rows in every CRM data table; the 7 stages, users, roles and audit log kept). Do not rerun `db:seed:crm` against Supabase without asking.                                                                                                                                                                        |
| **Missing** | Browser walk-through of the full workflow against Supabase: **pending** (needs a signed-in session). No Playwright CRM spec. Dashboard figures query transactional tables (§6.7 wants BI rollups). Events are written but never delivered (no dispatcher, §29 #1). No ECM document links. No Arabic strings.                                                                                                                                                                                                                                                                                                                                             |

### 🟡 Messaging module — built 2026-09-14, at the owner's request

Design decisions are in ADR-020. Migration `20260914105751_messaging_module` is applied to the local test database and,
with the owner's approval on 2026-09-14, to Supabase, followed by `npm run db:seed` (51 permissions; messaging granted to
platform-admin, sales and employee). Verified by direct query on Supabase: RLS on all 5 tables with 9 policies, 5 triggers,
the two `realtime.messages` policies for `authenticated` only, and no table privilege for `anon` or `authenticated`.
Order matters on any other database — migrate, then seed; the seed grants the permission that switches the feature on.
The code is **not yet committed or deployed**, so production does not show Messages.

| Area        | State |
| ----------- | ----- |
| Data model  | ✅ `messaging` schema with 5 tables; CHECKs on message shape and length; unique direct key; participation trigger; fail-closed document-access trigger; immutable attachments; participant-only RLS; Realtime policies on `realtime.messages` (Supabase only, guarded). `prisma migrate diff` reports no drift. |
| Services    | ✅ Server-side people search (20 results), race-safe direct conversations, inbox with unread counts in one statement, keyset pages of 50, idempotent send, delivered/read watermarks, throttled last seen. Permission first and participation on every call. |
| UI          | ✅ Floating Messenger in the platform layout (the earlier full-page `/messages` screen was replaced at the owner's request): launcher with unread badge; panel with chats and server-side people search; multiple chat windows (1 on tablets, 2–3 on wider screens), minimise to chat heads with unread badges, close, restore; one full-screen chat on phones; state survives navigation and reloads (sessionStorage). Bubbles, day separators, unread divider, optimistic send with retry, sent/delivered/read marks, typing indicator, Active now / Active 5m ago, earlier messages on scroll, emoji palette, drafts kept per chat; a new message elsewhere opens a chat head and a toast. The panel and windows are a lazily loaded chunk; the Realtime client loads after idle. |
| Tests       | ✅ 20 integration tests (both permission directions, participation 404s, dedupe including concurrent first contact, pagination, concurrent send order, idempotent retry, receipts, deactivation, triggers from the owner connection, the ECM seam with a stand-in function, RLS as a non-owning role) and 17 unit tests. |
| **Missing** | Document sharing: the paperclip, document picker, document cards and viewer link (§29 #17). Browser walk-through against Supabase (§29 #18). No Playwright spec. No message edit or delete UI (the columns exist). |

### 🟡 THE THINK TANK (Innovation) — Phase 1 built 2026-09-14, at the owner's request

Design decisions are in ADR-021. Migration `20260914123231_innovation_module` is applied to the **local test database
only**. It is not applied to Supabase and the seed has not been re-run there (owner review, §8.5); order matters —
migrate, then seed, since the seed grants the permissions that show the module.

| Area        | State |
| ----------- | ----- |
| Data model  | ✅ `innovation` schema, 8 tables; CHECK invariants; case-insensitive unique category names; self-vote trigger; full-text expression indexes; deny-by-default RLS; private storage bucket (Supabase only). `prisma migrate diff` reports no drift. |
| Services    | ✅ Ideas (submit, list/search/filter/sort, vote, comment, administer, convert to project), knowledge (add with verified file upload, search, administer), projects (team, documents, lessons learned), categories, overview (3 indexed statements), Ask Think Tank keyword engine, audited file downloads. |
| UI          | ✅ Navigation section; overview with question box, four cards, recent activity and trending ideas; ideas list and detail; knowledge library with category chips, detail with inline PDF/image preview; projects list and detail; Ask Think Tank chat screen; category administration. |
| Voting      | 🟡 👍 vote with immediate count, most voted and most commented sorts, top-voted panel for administrators, vote-count trigger and RLS on votes. Migrations `20260914142651_idea_voting` and `20260914150000_idea_votes_trigger_definer` are applied to the local test database only; the second fixes the self-vote trigger, which refused votes from any non-owner role. |
| Tests       | ✅ 20 integration tests (storage faked; includes votes by a non-owning database role) and 12 unit tests (file signatures, search queries). |
| **Missing** | Not applied to Supabase; `SUPABASE_SECRET_KEY` not set, so uploads and downloads are switched off until it is (§29 #21). Browser walk-through not done. Phase 2 (advanced search, relationships, notifications) and Phase 3 (AI) not started, as agreed. |

### 🟡 ERP — Phase 1 "finance foundation", built 2026-09-14 at the owner's request

Design decisions are in ADR-022. Migrations `20260914190000_erp_finance_foundation` and
`20260914191000_finance_permission_actions` are applied to the local test database and, with the owner's approval on
2026-09-14, to Supabase, followed by `npm run db:seed` (83 permissions, 18 of them ERP; roles `finance-admin` and
`accountant`; the 13-account starter chart). Verified on Supabase by direct query: RLS on all 6 `erp` tables, the 6
triggers (the balance check deferrable), 19 CHECK constraints and the period exclusion constraint, the four new
`iam.PermissionAction` values, no privileges for `anon` or `authenticated`, 0 periods and 0 journal entries.

| Area        | State |
| ----------- | ----- |
| Data model  | ✅ `erp` schema, 6 tables: accounts, cost_centres, fiscal_periods, journal_entries, journal_lines, journal_sequences. Ledger invariants enforced in the database (ADR-022). `prisma migrate diff` reports no drift. |
| Finance settings | ✅ Separation of posting — nobody posts a manual journal they created or last edited unless finance settings allow it, and with no settings saved it is not allowed — plus opening balance journals with a one-step balancing line, and finance settings at `/erp/finance/settings` (ADR-027). 2 unit tests and 4 integration tests. Migration `20260915100000_erp_finance_settings` is applied to the local test database only; Supabase awaits the owner's schema review. |
| Reports     | ✅ Trial balance (with optional opening balances), profit and loss and balance sheet at `/erp/finance/reports`, read from posted and reversed journal entries (ADR-026). 8 unit tests on the pure rules and 2 integration tests (a reversal netting to zero and a draft left out; totals, opening balances, net profit and a balancing sheet; refusals and dates in the wrong order). Not yet walked through signed in. |
| Authorisation | ✅ Every ERP service, page and the ERP layout require an organisation-wide grant (ADR-025): a finance or AR role scoped to an org unit or to own records authorises nothing. Found by the 2026-09-15 ERP audit, fixed the same day; 7 unit tests on `evaluateGlobal` and 2 integration tests (journals and the finance overview for all three scopes; AR approval and lists), plus refusals for journal update and customer credit terms. |
| Services    | ✅ Chart of accounts (tree listing in code order, create, edit, activate/deactivate, totals, paginated activity), cost centres (tree, create, edit), periods (create without overlap, close — refused while drafts are dated inside — and reopen with a reason), journal (drafts create/edit/delete; post with server re-validation and a gap-free number; reverse with an equal and opposite posted entry), finance overview. Every write: permission → Zod → one transaction with audit record and, where others may react, an outbox event. |
| UI          | ✅ ERP Finance navigation; dashboard; chart of accounts with search, type and status filters; account detail with totals and dated activity; journal list with search and status filter; line-entry form with running totals and a balanced/out-of-balance indicator; journal detail with post, reverse and delete-draft confirmations; periods with close and reopen; cost centres. Arabic names shown right-to-left, amounts accept Arabic digits. |
| Tests       | ✅ 32 unit tests (amount parsing, balancing and posting rules, reversal, schemas, roles) and 23 integration tests (every rejection case, immutability through the services and straight at the tables, reversal, rollback leaves no number, audit or event, simultaneous postings, allowed/refused for post, reverse, close and reopen). `npm run verify` 203 passing; full integration suite 144 passing; build succeeds. |
| **Missing** | The signed-in browser journey has not been run: `tests/e2e/erp-finance.spec.ts` skips without `E2E_EMAIL`/`E2E_PASSWORD` (§29 #27). No accounting period exists on Supabase yet, so nothing can be posted until a finance administrator creates one. No maker–checker (§29 #26). Payables, procurement, inventory, assets, projects, budgeting and reporting are deferred to later ERP phases, as agreed; receivables are ERP Phase 2, below. |

### 🟡 ERP — Phase 2 accounts receivable, built 2026-09-14 at the owner's request

Design decisions are in ADR-023. Migrations `20260914200000_ar_permission_actions` and
`20260914200100_erp_accounts_receivable` are applied to the local test database and, with the owner's approval on
2026-09-14, to Supabase. Verified on Supabase by direct query: both migrations finished; `iam.PermissionAction` has
CANCEL and ALLOCATE; RLS on all 10 new tables with no policies; the 8 triggers (4 deferred checks, including
`journal_entries_source_check`); 40 CHECK constraints on the AR tables; no privileges for `anon` or `authenticated` on
`erp`. The code was then deployed to production (`a3d7f87`) and `npm run db:seed` run on Supabase: 99 permissions (16
AR); `finance-admin` and `platform-admin` hold all 16 and `accountant` 11 (not invoice approve or cancel, receipt cancel,
customer update or AR settings); AR settings with receivable account 1200, approval required and self-approval off; the
INV and RCT series; 5 payment methods; 0 tax rates — each verified by direct query. Production smoke test:
`/api/health/ready` 200 with `database: ok`, and the AR pages redirect anonymous visitors to sign-in. On any database:
migrate, deploy the code, then seed — permission rows using the new actions cannot be loaded by a Prisma client
generated before them.

| Area        | State |
| ----------- | ----- |
| Data model  | ✅ 10 `erp` tables (ADR-023): settings, number series and counters, tax rates, payment methods, customer billing profiles, invoices and lines, receipts and allocations. Pricing CHECKs, guard triggers, the allocation trigger and deferred reconciliation checks; deny-by-default RLS. `prisma migrate diff` reports no drift. |
| Services    | ✅ Invoices (drafts priced by the server, submit, approve with the self-approval and threshold rules, reject, post into a balanced linked journal, cancel or void by reversal, delete draft), receipts (drafts, post, allocate to one or more open invoices, unallocate, void), customers (search through the CRM contract, balance list, account with statement, aging and recent documents, billing profile), aging report, AR settings, tax rates, payment methods, numbering. Every write: permission → Zod → one transaction with audit record and outbox event. Journal reversal refuses document-raised entries; period close refuses unposted AR documents. |
| UI          | ✅ Invoices (list with status and overdue filters and sortable number, date, due, total and outstanding; line-entry form; detail with lines, totals, payments, approval trail and actions), Receipts (list, form, detail with allocation dialog and unallocate), Customers (balance list; account page with balance, overdue, unapplied, credit limit, billing profile, aging, statement by date range, recent invoices and receipts), AR aging (as-of date, customer search, totals), AR settings (rules and defaults, aging buckets, tax rates, payment methods, numbering). The finance dashboard shows receivables outstanding and overdue; a document's journal entry links back to it and hides Reverse. |
| Tests       | ✅ 21 unit tests (quantities, rounding, line pricing, tax rates, approval rules, payment status, aging buckets, numbering, schemas, roles) and 20 integration tests (browser totals ignored, validation, self-approval and threshold, rejection, balanced linked journal, closed period and double posting leave nothing behind, posted immutability in services and straight at the tables, sourced-journal reversal refused, voids, partial, full and multi-invoice allocation, 100,000 − 40,000 = 60,000, over-allocation, duplicate and cross-customer refusals, simultaneous allocations, unallocate then void, aging and statement, subledger equals ledger, period close with unposted invoices, allowed/refused for approve, post, receipt post and allocate). `npm run verify` 224 passing; full integration suite 164 passing; build succeeds (64 routes). |
| **Missing** | The signed-in browser journey `tests/e2e/erp-ar.spec.ts` has not been run (§29 #32). No tax rate exists until a finance administrator adds one, and no period exists (§29 #25). With the default settings one person cannot take their own invoice through approval (§29 #36). Credit notes, foreign currency, invoice PDF and e-mail, and e-invoicing are deferred (§29 #30, #33). |

### 📋 Not started

ECM, HRIS and BI, and ERP beyond finance and receivables. The ECM, HRIS and BI navigation entries and permission keys are declared
but uncatalogued, so they correctly do not render.

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

| #   | Item                                                        | Why it matters                                                                                                                                                                                                                                    | Mitigation                                                                                                                                       | Severity  |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| 1   | **Event dispatcher missing**                                | Events are written but never delivered, so cross-module reactions silently do not happen                                                                                                                                                          | Phase 2                                                                                                                                          | 🟠 High   |
| 2   | **No CSP**                                                  | Other security headers are set; CSP needs a nonce-based policy in `proxy.ts` because Next injects inline bootstrap scripts                                                                                                                        | Implement with the nonce; never `unsafe-inline`                                                                                                  | 🟠 High   |
| 3   | **Database password was shared in a chat transcript**       | The original was rotated on 2026-09-13 (old value verified rejected, new value verified by Prisma and `/api/health/ready`), but the replacement was also typed into the same transcript                                                           | Rotate once more to a value that never appears in chat; update only `.env.local`                                                                 | 🟡 Medium |
| 4   | **RLS does not restrict the app's own connection**          | The app connects as the table owner, which bypasses RLS by design (`FORCE ROW LEVEL SECURITY` is not set); the real barrier is Supabase's schema-exposure setting plus the revoked API grants (ADR-015), not RLS itself                           | Build a dedicated, unprivileged application role if a second, non-owner consumer of this schema ever exists                                      | 🟡 Medium |
| 5   | **Scoped DENY grants are not expressible as a list filter** | `scopeFilterFor` applies global denials but cannot express a scope-limited DENY as positive SQL, so a list may include a row the caller may not act on                                                                                            | Documented in `evaluate.ts`: re-check any row a list acts on with `requirePermission` and a target                                               | 🟡 Medium |
| 6   | **Org-unit `path` is maintained by the service layer**      | A bug in re-parenting would silently widen or narrow access platform-wide, since scope resolution is a prefix match on this column                                                                                                                | Write the re-parent operation with tests before exposing org-unit editing; consider a trigger or integrity job                                   | 🟡 Medium |
| 7   | **Pinned below the latest TypeScript and ESLint**           | TS 7 and ESLint 10 break linting here (ADR-011); an innocent `npm update` breaks the lint run                                                                                                                                                     | Constraints documented in §3 and ADR-011                                                                                                         | 🟡 Medium |
| 8   | **i18n/RTL groundwork only**                                | Strings are hardcoded English; layout is RTL-ready but the text is not                                                                                                                                                                            | Externalise strings when Arabic is scheduled (ADR-009)                                                                                           | 🟡 Medium |
| 9   | **`react-hook-form` installed but unused**                  | Phase 1 forms use `useActionState`. An unused dependency is small but real surface                                                                                                                                                                | The CRM forms validate with the shared Zod schemas through plain component state and do not use it either; remove it unless a form outgrows that | 🟢 Low    |
| 10  | **CRM dashboard reads transactional tables**                | §6.7 says dashboards read BI rollups; `getCrmDashboard` groups leads and opportunities live on page load                                                                                                                                          | Fine at demo volume; move to a rollup with BI (Phase 9) or when a dashboard query passes ~200 ms                                                 | 🟡 Medium |
| 11  | **No CRM Playwright spec**                                  | The workflow is covered by integration tests and a manual browser run, not an automated browser test                                                                                                                                              | Add `tests/e2e/crm.spec.ts`: wizard → convert → move → closed won                                                                                | 🟡 Medium |
| 12  | **CRM pickers load capped option lists**                    | Company and contact selects load at most 200 / 300 options; a larger CRM needs type-ahead search                                                                                                                                                  | Replace with a search-as-you-type picker before the data grows                                                                                   | 🟢 Low    |
| 13  | **Display time zone is fixed to Africa/Cairo**              | CRM timestamps render in one zone until users carry a preference                                                                                                                                                                                  | Read the zone from the user's profile once it is stored                                                                                          | 🟢 Low    |
| 14  | **Every opportunity needs a company**                       | Required by the written spec and the schema (`account_id NOT NULL`); a deal with no company yet cannot be recorded                                                                                                                                | Owner to confirm; relaxing it is a migration plus form changes                                                                                   | 🟢 Low    |
| 15  | **User administration needs configuration to be complete**  | Creating, re-addressing and deleting sign-in accounts need `SUPABASE_SECRET_KEY` on the server; invitation and reset links need `<APP_URL>/auth/set-password` in Supabase's redirect allow list; Supabase's built-in email sender is rate-limited | Owner adds the key and redirect URLs; configure custom SMTP in Supabase before inviting many users                                               | 🟡 Medium |
| 16  | **No browser test of the user administration screens**      | The services are covered by 20 integration tests, but the dialogs and menus have not been exercised in a signed-in browser                                                                                                                        | Add a Playwright spec that signs in as an administrator and walks add → edit → roles → deactivate → delete                                       | 🟢 Low    |
| 17  | **Document sharing in chat waits for ECM**                  | Attachments have their schema, RLS and triggers, but no document store exists, so the picker, cards and viewer link are not built and attaching fails closed (ADR-020) | Build ECM core (Phase 3) with `ecm.user_can_read_document(uuid, uuid)`, then add the chat picker and cards | 🟡 Medium |
| 18  | **Messaging not yet exercised in a browser against Supabase** | Services, triggers and RLS are covered by integration tests on local Postgres; Realtime delivery, presence and typing need the migration applied to Supabase and two signed-in users | Owner applies the migration, then the seed, then walks the browser scenarios | 🟡 Medium |
| 19  | **Presence is visible to every active account**             | Realtime policies cannot evaluate the permission model, so any active account may join `messaging:presence` and learn which user ids are online (no names, no content) | Acceptable for one organisation; scope presence per org unit if that changes | 🟢 Low    |
| 20  | **Realtime connection quotas**                              | Every signed-in user with Messages holds one Realtime socket, and Supabase plans cap concurrent connections | Check the plan limit against headcount before rollout | 🟢 Low    |
| 21  | **Think Tank files need `SUPABASE_SECRET_KEY`**             | Without the key on the server, uploads, previews and downloads are switched off (the UI says so) | Add the key to `.env.local` and Vercel | 🟡 Medium |
| 22  | **No malware scanning of uploads**                          | Uploads are checked for type by content and size, but not scanned (§12.2 step 5) | Add a scanning step before a file becomes READY | 🟡 Medium |
| 23  | **Abandoned uploads are never cleaned up**                  | A PENDING file whose form was never saved stays in storage and in `innovation.files` | A scheduled job (Phase 2) removing PENDING files older than a day | 🟢 Low    |
| 24  | **Think Tank files live outside ECM**                       | The platform's single document store is meant to be ECM (§6.3); the knowledge library holds files until it exists | Migrate files and knowledge documents into ECM when Phase 3 ships | 🟢 Low    |
| 25  | **No accounting period in production yet**                  | ERP is migrated and seeded on Supabase, but no period exists, so no journal entry can be posted; and only `platform-admin` holds the finance permissions until someone is given `finance-admin` or `accountant` | A finance administrator creates the first periods in the UI and the right people are granted the finance roles | 🟢 Low    |
| 26  | **Journal maker–checker is a setting, not a routed approval** | Since ADR-027 nobody posts a manual journal they created or last edited unless finance settings allow it, but a finance administrator can switch that on and there is no approval step or queue | Route journal approval through the workflow engine when Phase 4 lands | 🟢 Low    |
| 27  | **Signed-in ERP browser journey not run**                   | `tests/e2e/erp-finance.spec.ts` needs `E2E_EMAIL`/`E2E_PASSWORD` for a finance administrator on a non-production database with the starter chart and an open period containing today; without them it skips | Owner provides a test account and database, then runs `npm run test:e2e` | 🟡 Medium |
| 28  | **Finance pickers load capped lists**                       | The journal form loads at most 1,000 postable accounts and 500 cost centres | Replace with a type-ahead picker before the chart grows past that | 🟢 Low    |
| 29  | **Single-currency ledger**                                  | ERP records EGP only. (The trial balance, profit and loss and balance sheet shipped on 2026-09-15, ADR-026; opening balances and year-end close are #40) | Add currency and rate when foreign-currency receivables or payables are required | 🟢 Low    |
| 30  | **No credit notes**                                         | A paid or part-paid invoice can only be corrected by removing its allocations and voiding it; partial credits and returns cannot be recorded (ADR-023) | A credit note document posting Dr revenue and tax, Cr receivable, allocatable like a receipt | 🟡 Medium |
| 31  | **Credit limit shown, not enforced**                        | The customer page flags a balance over the limit, but creating and posting invoices do not refuse it | A configurable block or approval rule when the owner wants one | 🟢 Low    |
| 32  | **Signed-in AR browser journey not run**                    | `tests/e2e/erp-ar.spec.ts` needs `E2E_EMAIL`/`E2E_PASSWORD` for a finance administrator on a non-production database with a CRM company, the starter chart, an open period containing today and settings that let one person through approval; without them it skips | Owner provides a test account and database, then runs `npm run test:e2e` | 🟡 Medium |
| 33  | **Invoices are not e-invoices**                             | No billing name, address or tax-registration snapshot (the name shown is CRM's current one), no PDF or e-mail, no Egyptian Tax Authority submission | Snapshot billing details at posting; e-invoicing through `platform/integrations` (§15) when required | 🟡 Medium |
| 34  | **Aging as of a past date is approximate**                  | An as-of date leaves out documents dated after it and moves the days-past-due cut-off, but allocations (which carry no date) and voids made after it still count | Date allocations, or snapshot aging nightly into a rollup | 🟢 Low    |
| 35  | **AR lists aggregate transactional tables live**            | The Customers list and aging group invoices and receipts on each request (§6.7 wants rollups) | Move to rollups with BI, or when a query passes ~200 ms | 🟢 Low    |
| 36  | **Default approval needs two people**                       | AR settings start with approval required and self-approval off, so a finance administrator working alone cannot post their own invoice | Grant approval to a second person, or change AR settings (threshold, self-approval, or no approval) | 🟢 Low    |
| 37  | **No restore for deleted CRM records**                      | Deletion is soft, but there is no screen to view or restore deleted records; undoing an accidental delete needs a database fix (ADR-024) | A "Deleted records" admin page with restore, if mistakes happen | 🟢 Low    |
| 38  | **No bulk delete in the CRM**                               | Administrators delete one record at a time | Add delete to the leads bulk-action bar and the other lists when volume demands it | 🟢 Low    |
| 40  | **No year-end close yet**                                   | The fiscal year (calendar) and opening balance journals are decided and built (ADR-027), but nothing yet closes a year into retained earnings, so the balance sheet shows profit or loss "not yet closed" | Build year-end close into the retained earnings account named in finance settings | 🟠 High   |
| 41  | **Ledger reports aggregate journal lines live**             | Each report sums every posted line up to its end date on request (ADR-026) | Move to rollups with BI, or when a report query passes ~200 ms | 🟢 Low    |
| 39  | **Sidebar can show ERP to a user with only scoped finance grants** | Navigation evaluates without a target, so any scope shows the section; the ERP layout then returns not-found (ADR-025). Nothing is exposed | Let a navigation section require global grants | 🟢 Low    |

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
