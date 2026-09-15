# CRM Administrator Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let platform administrators soft-delete any CRM record — lead, company, contact, opportunity or activity — with what belongs only to it deleted in the same transaction, and nobody else able to delete.

**Architecture:** A new module-private `modules/crm/services/deletion-service.ts` holds one delete function per record type plus a read-only `getDeletionImpact` for the confirmation. All share one predicate that picks the activities going with a deletion (linked to a deleted record and to nothing that stays). Reads stop linking to deleted records by filtering `deletedAt` in `repositories/selects.ts`. Server Actions wrap the services; a client `delete-record.tsx` renders the confirmation dialogs. No migration: `deleted_at` columns and live-row filters already exist.

**Tech Stack:** Next.js 16 App Router (Server Components, Server Actions), React 19, TypeScript 5.9, Prisma 7 (`@prisma/adapter-pg`), Zod 4, Vitest 5, Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-09-15-crm-admin-delete-design.md`

**Amendment (2026-09-15, during Task 2):** `logActivity` files every contact or opportunity activity under its company, so
the owner refined the cascade: deleting a contact or opportunity takes every activity logged on it, except a converted
lead's history (the service's `KeptBy` parameter). The service, the integration tests and ADR-024 in the repository
supersede the snippets below where they differ.

**House rules that apply to every task:** read CLAUDE.md §25 first; commit **only when the owner has said to** (the commit steps below are gated); integration tests run only against the local `TEST_DATABASE_URL`, never Supabase; never commit `design/Form response pending.zip`.

---

## File map

| File | Change | Responsibility |
| ---- | ------ | -------------- |
| `modules/crm/contracts/permissions.ts` | Modify | `CRM_DELETE_PERMISSIONS`; Sales loses the delete keys |
| `modules/crm/contracts/events.ts` | Modify | Five `*Deleted` event names |
| `modules/crm/contracts/types.ts` | Modify | `DeletionImpact` DTO |
| `modules/crm/contracts/schemas.ts` | Modify | `deletionTargetSchema` |
| `modules/crm/services/deletion-service.ts` | Create | Delete services, cascade rules, impact preview |
| `modules/crm/contracts/service.ts` | Modify | Export the deletion services |
| `modules/crm/repositories/selects.ts` | Modify | Stop linking to deleted records |
| `modules/crm/ui/format.ts` | Modify | `describeAlsoDeleted` confirmation sentence |
| `modules/crm/ui/links.ts` | Modify | `recordListHref` |
| `modules/crm/ui/actions.ts` | Modify | Six Server Actions |
| `modules/crm/ui/delete-record.tsx` | Create | `DeleteRecordButton`, `DeleteActivityButton` |
| `modules/crm/ui/activity-timeline.tsx` | Modify | `canDeleteActivities` prop and button |
| `modules/crm/ui/activity-list.tsx` | Modify | Pass `canDeleteActivities` through |
| `app/(platform)/crm/{accounts,contacts,leads,opportunities}/[id]/page.tsx` | Modify | Delete button; activity delete |
| `app/(platform)/crm/{activities,tasks,notes}/page.tsx` | Modify | Activity delete |
| `tests/unit/crm-deletion.test.ts` | Create | Permissions, text, schema |
| `tests/integration/crm-deletion.test.ts` | Create | Services against real Postgres |
| `CLAUDE.md` | Modify | §6.1 rule, ADR-024, §28, §29 |

---

### Task 1: Keep delete away from Sales, and add the deletion contracts

**Files:**
- Create: `tests/unit/crm-deletion.test.ts`
- Modify: `modules/crm/contracts/permissions.ts` (end of file), `modules/crm/contracts/events.ts`, `modules/crm/contracts/types.ts` (after `ActivityDto`), `modules/crm/contracts/schemas.ts` (after `activitySchema`), `modules/crm/ui/format.ts` (end of file)

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/crm-deletion.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  CRM_DELETE_PERMISSIONS,
  CRM_PERMISSIONS,
  CRM_PERMISSION_DEFINITIONS,
  CRM_SALES_PERMISSIONS,
} from "@/modules/crm/contracts/permissions";
import { deletionTargetSchema } from "@/modules/crm/contracts/schemas";
import { describeAlsoDeleted } from "@/modules/crm/ui/format";

/** Deleting CRM records is for administrators only (ADR-024). */

describe("CRM delete permissions", () => {
  it("names the five delete permissions", () => {
    expect(CRM_DELETE_PERMISSIONS).toEqual([
      CRM_PERMISSIONS.LEAD_DELETE,
      CRM_PERMISSIONS.ACCOUNT_DELETE,
      CRM_PERMISSIONS.CONTACT_DELETE,
      CRM_PERMISSIONS.OPPORTUNITY_DELETE,
      CRM_PERMISSIONS.ACTIVITY_DELETE,
    ]);
  });

  it("keeps every delete permission away from the Sales role", () => {
    for (const key of CRM_DELETE_PERMISSIONS) {
      expect(CRM_SALES_PERMISSIONS, key).not.toContain(key);
    }
    expect(CRM_SALES_PERMISSIONS).toContain(CRM_PERMISSIONS.LEAD_UPDATE);
    expect(CRM_SALES_PERMISSIONS).toContain(CRM_PERMISSIONS.ACTIVITY_CREATE);
  });

  it("catalogues them, so platform-admin — which holds the whole catalogue — has them", () => {
    const catalogued = CRM_PERMISSION_DEFINITIONS.map((definition) => definition.key);
    for (const key of CRM_DELETE_PERMISSIONS) expect(catalogued, key).toContain(key);
  });
});

describe("deletion confirmation text", () => {
  it("lists what goes with the record", () => {
    expect(describeAlsoDeleted({ contacts: 3, opportunities: 2, activities: 41 })).toBe(
      "This also deletes 3 contacts, 2 opportunities and 41 activities.",
    );
    expect(describeAlsoDeleted({ contacts: 1, opportunities: 0, activities: 1 })).toBe(
      "This also deletes 1 contact and 1 activity.",
    );
    expect(describeAlsoDeleted({ contacts: 0, opportunities: 1, activities: 0 })).toBe(
      "This also deletes 1 opportunity.",
    );
    expect(describeAlsoDeleted({ contacts: 0, opportunities: 0, activities: 0 })).toBe(
      "Nothing else is deleted with it.",
    );
  });
});

describe("deletion target", () => {
  it("accepts the four record kinds and nothing else", () => {
    for (const kind of ["lead", "account", "contact", "opportunity"]) {
      expect(deletionTargetSchema.safeParse({ kind, id: "x" }).success, kind).toBe(true);
    }
    expect(deletionTargetSchema.safeParse({ kind: "stage", id: "x" }).success).toBe(false);
    expect(deletionTargetSchema.safeParse({ kind: "lead" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/unit/crm-deletion.test.ts`
Expected: FAIL — `CRM_DELETE_PERMISSIONS`, `deletionTargetSchema` and `describeAlsoDeleted` are not exported.

- [ ] **Step 3: Restrict the Sales role**

In `modules/crm/contracts/permissions.ts`, replace the last block:

```ts
/** Everything a salesperson needs day to day — no pipeline configuration. */
export const CRM_SALES_PERMISSIONS: readonly string[] = Object.values(
  CRM_PERMISSIONS,
).filter((key) => key !== CRM_PERMISSIONS.PIPELINE_ADMINISTER);
```

with:

```ts
/**
 * The CRM's delete permissions. Deleting is administration, not day-to-day sales
 * work (ADR-024): only `platform-admin`, which holds the whole catalogue, has them.
 */
export const CRM_DELETE_PERMISSIONS: readonly string[] = [
  CRM_PERMISSIONS.LEAD_DELETE,
  CRM_PERMISSIONS.ACCOUNT_DELETE,
  CRM_PERMISSIONS.CONTACT_DELETE,
  CRM_PERMISSIONS.OPPORTUNITY_DELETE,
  CRM_PERMISSIONS.ACTIVITY_DELETE,
];

/** Everything a salesperson needs day to day — no pipeline configuration, no deleting. */
export const CRM_SALES_PERMISSIONS: readonly string[] = Object.values(
  CRM_PERMISSIONS,
).filter(
  (key) =>
    key !== CRM_PERMISSIONS.PIPELINE_ADMINISTER && !CRM_DELETE_PERMISSIONS.includes(key),
);
```

- [ ] **Step 4: Add the event names**

In `modules/crm/contracts/events.ts`, replace:

```ts
  ACTIVITY_LOGGED: "crm.ActivityLogged",
} as const;
```

with:

```ts
  ACTIVITY_LOGGED: "crm.ActivityLogged",
  LEAD_DELETED: "crm.LeadDeleted",
  CUSTOMER_DELETED: "crm.CustomerDeleted",
  CONTACT_DELETED: "crm.ContactDeleted",
  OPPORTUNITY_DELETED: "crm.OpportunityDeleted",
  ACTIVITY_DELETED: "crm.ActivityDeleted",
} as const;
```

- [ ] **Step 5: Add the DTO**

In `modules/crm/contracts/types.ts`, directly after the closing `};` of `export type ActivityDto = { … };`, add:

```ts

/** What deleting a record takes with it, shown before an administrator confirms. */
export type DeletionImpact = {
  kind: RecordKind;
  id: string;
  label: string;
  contacts: number;
  opportunities: number;
  activities: number;
};
```

- [ ] **Step 6: Add the schema**

In `modules/crm/contracts/schemas.ts`, directly before the line `/* Lists` section divider comment that follows `activitySchema` (the block starting `/* ------…` above `export const listParamsSchema`), add:

```ts
/** A CRM record an administrator is about to delete. */
export const deletionTargetSchema = z.object({
  kind: z.enum(["lead", "account", "contact", "opportunity"]),
  id: z.string(),
});

```

- [ ] **Step 7: Add the confirmation sentence**

At the end of `modules/crm/ui/format.ts`, add:

```ts

function counted(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The confirmation sentence for what a deletion takes with it. */
export function describeAlsoDeleted(impact: {
  contacts: number;
  opportunities: number;
  activities: number;
}): string {
  const parts = [
    impact.contacts > 0 ? counted(impact.contacts, "contact", "contacts") : null,
    impact.opportunities > 0
      ? counted(impact.opportunities, "opportunity", "opportunities")
      : null,
    impact.activities > 0 ? counted(impact.activities, "activity", "activities") : null,
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) return "Nothing else is deleted with it.";
  const list =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `This also deletes ${list}.`;
}
```

- [ ] **Step 8: Run the test and watch it pass**

Run: `npx vitest run tests/unit/crm-deletion.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 9: Make sure the existing CRM suite still passes with the narrower Sales role**

Run: `npx dotenv -e .env.local -- vitest run tests/integration/crm.test.ts`
Expected: PASS (26 tests) — no existing CRM behaviour used a delete permission.

- [ ] **Step 10: Commit (only with the owner's go-ahead)**

```bash
git add modules/crm/contracts/permissions.ts modules/crm/contracts/events.ts modules/crm/contracts/types.ts modules/crm/contracts/schemas.ts modules/crm/ui/format.ts tests/unit/crm-deletion.test.ts
git commit -m "feat(crm): delete permissions for administrators only, and the deletion contracts"
```

---

### Task 2: The deletion services

**Files:**
- Create: `modules/crm/services/deletion-service.ts`
- Modify: `modules/crm/contracts/service.ts`
- Create: `tests/integration/crm-deletion.test.ts`

- [ ] **Step 1: Write the failing integration tests**

Create `tests/integration/crm-deletion.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { BusinessRuleError, ForbiddenError, NotFoundError } from "@/lib/errors";
import {
  CRM_PERMISSIONS,
  CRM_SALES_PERMISSIONS,
} from "@/modules/crm/contracts/permissions";
import {
  convertLead,
  createAccount,
  createContact,
  createLead,
  deleteAccount,
  deleteActivity,
  deleteContact,
  deleteLead,
  deleteOpportunity,
  getAccount,
  getAccountReferences,
  getContact,
  getDeletionImpact,
  getLead,
  getOpportunity,
  listLeads,
  listTimeline,
  logActivity,
  searchCrm,
} from "@/modules/crm/contracts/service";
import {
  createRole,
  createUser,
  grantRole,
  hasTestDatabase,
  resetDatabase,
  seedPermissions,
  seedStages,
  teardownDatabase,
  testPrisma,
} from "./helpers/db";

/**
 * Administrator deletion of CRM records against a real database (ADR-024): soft
 * delete, what goes with each record, what stays, who may delete, and that deleted
 * records disappear from every read.
 */
describe.skipIf(!hasTestDatabase)("CRM deletion (integration)", () => {
  let admin: { id: string };
  let rep: { id: string };
  let outsider: { id: string };
  const as = (user: { id: string }) => ({ id: user.id });

  afterAll(async () => {
    await teardownDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedPermissions();
    await seedStages();

    // The CRM part of platform-admin: every CRM permission, deletes included.
    const adminRole = await createRole("crm-admin", Object.values(CRM_PERMISSIONS));
    const salesRole = await createRole("sales", CRM_SALES_PERMISSIONS);
    admin = await createUser({ email: "admin@example.com" });
    rep = await createUser({ email: "rep@example.com" });
    outsider = await createUser({ email: "outsider@example.com" });
    await grantRole(admin.id, adminRole.id);
    await grantRole(rep.id, salesRole.id);
  });

  const wizard = () => ({
    info: {
      firstName: "John",
      lastName: "Smith",
      company: "Acme Corporation",
      jobTitle: "CEO",
      email: "john@acme.com",
      source: "REFERRAL",
      country: "United States",
    },
    qualification: {
      interest: "Enterprise plan",
      budget: "50000",
      timeline: "WITHIN_3_MONTHS",
      decisionMaker: "YES",
      score: "82",
      status: "QUALIFIED",
    },
    opportunity: null,
  });

  /** A lead converted into a company, a contact and an opportunity. */
  const convertedDeal = async () => {
    const { leadId } = await createLead(as(admin), wizard());
    const result = await convertLead(as(admin), {
      leadId,
      accountMode: "new",
      contactMode: "new",
      createOpportunity: true,
      opportunity: {
        name: "Acme Enterprise Deal",
        amount: "45000",
        closeDate: "2026-10-30",
        probability: "20",
      },
    });
    return {
      leadId,
      accountId: result.accountId,
      contactId: result.contactId,
      opportunityId: result.opportunityId ?? "",
    };
  };

  const deletedAt = async (model: "account" | "contact" | "opportunity" | "activity", id: string) => {
    const prisma = testPrisma();
    const row =
      model === "account"
        ? await prisma.crmAccount.findUniqueOrThrow({ where: { id }, select: { deletedAt: true } })
        : model === "contact"
          ? await prisma.crmContact.findUniqueOrThrow({ where: { id }, select: { deletedAt: true } })
          : model === "opportunity"
            ? await prisma.crmOpportunity.findUniqueOrThrow({ where: { id }, select: { deletedAt: true } })
            : await prisma.crmActivity.findUniqueOrThrow({ where: { id }, select: { deletedAt: true } });
    return row.deletedAt;
  };

  describe("a company", () => {
    it("goes with its contacts, opportunities and activities, as the confirmation said", async () => {
      const deal = await convertedDeal();
      const note = await logActivity(as(admin), {
        type: "NOTE",
        subject: "Company note",
        accountId: deal.accountId,
      });

      const impact = await getDeletionImpact(as(admin), {
        kind: "account",
        id: deal.accountId,
      });
      expect(impact).toMatchObject({
        kind: "account",
        id: deal.accountId,
        label: "Acme Corporation",
        contacts: 1,
        opportunities: 1,
      });

      await deleteAccount(as(admin), deal.accountId);

      expect(await deletedAt("account", deal.accountId)).not.toBeNull();
      expect(await deletedAt("contact", deal.contactId)).not.toBeNull();
      expect(await deletedAt("opportunity", deal.opportunityId)).not.toBeNull();
      expect(await deletedAt("activity", note.id)).not.toBeNull();
      expect(
        await testPrisma().crmActivity.count({ where: { deletedAt: { not: null } } }),
      ).toBe(impact.activities);

      // The lead the company came from stays.
      expect((await getLead(as(admin), deal.leadId)).status).toBe("CONVERTED");

      const audit = await testPrisma().auditLog.findFirstOrThrow({
        where: { action: "crm.account.deleted", entityId: deal.accountId },
      });
      expect(audit.severity).toBe("WARNING");
      expect(audit.changes).toMatchObject({
        contactIds: [deal.contactId],
        opportunityIds: [deal.opportunityId],
      });
      const event = await testPrisma().eventOutbox.findFirstOrThrow({
        where: { name: "crm.CustomerDeleted" },
      });
      expect(event.payload).toEqual({
        accountId: deal.accountId,
        contactIds: [deal.contactId],
        opportunityIds: [deal.opportunityId],
      });
    });

    it("disappears from detail pages and search, and frees its name and its contacts' emails", async () => {
      const account = await createAccount(as(admin), { name: "Globex" });
      const contact = await createContact(as(admin), {
        firstName: "Hank",
        lastName: "Scorpio",
        email: "hank@globex.com",
        accountId: account.id,
      });

      await deleteAccount(as(admin), account.id);

      await expect(getAccount(as(admin), account.id)).rejects.toThrow(NotFoundError);
      await expect(getContact(as(admin), contact.id)).rejects.toThrow(NotFoundError);
      const results = await searchCrm(as(admin), "Globex");
      expect(results.accounts).toHaveLength(0);

      const again = await createAccount(as(admin), { name: "GLOBEX" });
      await createContact(as(admin), {
        firstName: "Hank",
        lastName: "Scorpio",
        email: "hank@globex.com",
        accountId: again.id,
      });
    });

    it("is reported to ERP as no longer in CRM", async () => {
      const account = await createAccount(as(admin), { name: "Initech" });
      await deleteAccount(as(admin), account.id);
      expect(await getAccountReferences([account.id])).toEqual([
        { id: account.id, name: "Initech", exists: false },
      ]);
    });

    it("cannot be deleted twice", async () => {
      const account = await createAccount(as(admin), { name: "Umbrella" });
      await deleteAccount(as(admin), account.id);
      await expect(deleteAccount(as(admin), account.id)).rejects.toThrow(NotFoundError);
      expect(
        await testPrisma().auditLog.count({ where: { action: "crm.account.deleted" } }),
      ).toBe(1);
    });
  });

  describe("a lead, contact or opportunity", () => {
    it("deletes a lead with its own activities", async () => {
      const { leadId } = await createLead(as(admin), wizard());
      const call = await logActivity(as(admin), {
        type: "CALL",
        subject: "Discovery call",
        leadId,
      });
      const before = await testPrisma().crmActivity.count({
        where: { leadId, deletedAt: null },
      });

      const impact = await getDeletionImpact(as(admin), { kind: "lead", id: leadId });
      expect(impact).toEqual({
        kind: "lead",
        id: leadId,
        label: "John Smith",
        contacts: 0,
        opportunities: 0,
        activities: before,
      });

      await deleteLead(as(admin), leadId);

      await expect(getLead(as(admin), leadId)).rejects.toThrow(NotFoundError);
      expect((await listLeads(as(admin))).total).toBe(0);
      expect(await deletedAt("activity", call.id)).not.toBeNull();
      expect(
        await testPrisma().eventOutbox.count({ where: { name: "crm.LeadDeleted" } }),
      ).toBe(1);
    });

    it("leaves the company, contact and opportunity a converted lead became", async () => {
      const deal = await convertedDeal();
      await deleteLead(as(admin), deal.leadId);
      expect((await getAccount(as(admin), deal.accountId)).name).toBe("Acme Corporation");
      expect((await getContact(as(admin), deal.contactId)).id).toBe(deal.contactId);
      expect((await getOpportunity(as(admin), deal.opportunityId)).id).toBe(
        deal.opportunityId,
      );
    });

    it("keeps an activity that is also on a record that stays, without a link to the deleted one", async () => {
      const deal = await convertedDeal();
      const shared = await logActivity(as(admin), {
        type: "CALL",
        subject: "Shared call",
        contactId: deal.contactId,
        accountId: deal.accountId,
      });
      const contactOnly = await logActivity(as(admin), {
        type: "NOTE",
        subject: "Contact only",
        contactId: deal.contactId,
      });

      await deleteContact(as(admin), deal.contactId);

      expect(await deletedAt("activity", shared.id)).toBeNull();
      expect(await deletedAt("activity", contactOnly.id)).not.toBeNull();
      const timeline = await listTimeline(as(admin), {
        kind: "account",
        id: deal.accountId,
      });
      const call = timeline.find((entry) => entry.id === shared.id);
      expect(call?.related.map((ref) => ref.kind)).toEqual(["account"]);

      const opportunity = await getOpportunity(as(admin), deal.opportunityId);
      expect(opportunity.primaryContact).toBeNull();
      expect(opportunity.primaryContactDetail).toBeNull();
    });

    it("deletes an opportunity and drops it from its company and contact", async () => {
      const deal = await convertedDeal();
      await deleteOpportunity(as(admin), deal.opportunityId);
      await expect(getOpportunity(as(admin), deal.opportunityId)).rejects.toThrow(
        NotFoundError,
      );
      expect((await getAccount(as(admin), deal.accountId)).opportunities).toHaveLength(0);
      expect((await getContact(as(admin), deal.contactId)).opportunities).toHaveLength(0);
    });

    it("stops a converted lead linking to what was deleted", async () => {
      const deal = await convertedDeal();
      await deleteAccount(as(admin), deal.accountId);
      const lead = await getLead(as(admin), deal.leadId);
      expect([lead.convertedAccount, lead.convertedContact, lead.convertedOpportunity]).toEqual([
        null,
        null,
        null,
      ]);
    });
  });

  describe("an activity", () => {
    it("deletes a single note, but never the CRM's own status and stage entries", async () => {
      const deal = await convertedDeal();
      const note = await logActivity(as(admin), {
        type: "NOTE",
        subject: "Wrong deal",
        opportunityId: deal.opportunityId,
      });

      await deleteActivity(as(admin), note.id);

      const timeline = await listTimeline(as(admin), {
        kind: "opportunity",
        id: deal.opportunityId,
      });
      expect(timeline.map((entry) => entry.id)).not.toContain(note.id);
      const system = timeline.find(
        (entry) => entry.type === "STATUS_CHANGE" || entry.type === "STAGE_CHANGE",
      );
      expect(system).toBeDefined();
      await expect(deleteActivity(as(admin), system?.id ?? "")).rejects.toThrow(
        BusinessRuleError,
      );

      const audit = await testPrisma().auditLog.findFirstOrThrow({
        where: { action: "crm.activity.deleted", entityId: note.id },
      });
      expect(audit.severity).toBe("WARNING");
      expect(
        await testPrisma().eventOutbox.count({ where: { name: "crm.ActivityDeleted" } }),
      ).toBe(1);
    });
  });

  describe("who may delete", () => {
    it("refuses a salesperson and an outsider every delete, and changes nothing", async () => {
      const deal = await convertedDeal();
      const note = await logActivity(as(admin), {
        type: "NOTE",
        subject: "Keep me",
        accountId: deal.accountId,
      });
      const attempts = (user: { id: string }) => [
        () => deleteLead(as(user), deal.leadId),
        () => deleteAccount(as(user), deal.accountId),
        () => deleteContact(as(user), deal.contactId),
        () => deleteOpportunity(as(user), deal.opportunityId),
        () => deleteActivity(as(user), note.id),
        () => getDeletionImpact(as(user), { kind: "account", id: deal.accountId }),
      ];

      // Sales can see the records, so it is told it may not delete them.
      for (const attempt of attempts(rep)) {
        await expect(attempt()).rejects.toThrow(ForbiddenError);
      }
      // An outsider cannot see them, so it is not even told they exist.
      for (const attempt of attempts(outsider)) {
        await expect(attempt()).rejects.toThrow(NotFoundError);
      }

      const prisma = testPrisma();
      expect(await prisma.crmAccount.count({ where: { deletedAt: { not: null } } })).toBe(0);
      expect(await prisma.crmActivity.count({ where: { deletedAt: { not: null } } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { action: { endsWith: ".deleted" } } })).toBe(0);
    });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx dotenv -e .env.local -- vitest run tests/integration/crm-deletion.test.ts`
Expected: FAIL — `deleteAccount`, `getDeletionImpact` and the other delete functions are not exported from `@/modules/crm/contracts/service`.

- [ ] **Step 3: Write the service**

Create `modules/crm/services/deletion-service.ts`:

```ts
import type { Prisma } from "@prisma/client";
import { BusinessRuleError, NotFoundError } from "@/lib/errors";
import { prisma, type PrismaTransaction } from "@/lib/prisma";
import { recordAudit } from "@/platform/audit/audit";
import { type Actor, requirePermission } from "@/platform/authz/authz";
import type { ScopeTarget } from "@/platform/authz/types";
import { publish } from "@/platform/events/publish";
import { CRM_EVENTS } from "../contracts/events";
import { CRM_PERMISSIONS } from "../contracts/permissions";
import { deletionTargetSchema } from "../contracts/schemas";
import { ACTIVITY_TYPE_LABELS, type DeletionImpact } from "../contracts/types";
import { personName, toScopeTarget, userRefSelect } from "../repositories/selects";
import { CRM_MODULE, assertCanRead, auditFields, isUuid, parseInput } from "./support";

/**
 * Administrator deletion of CRM records (ADR-024).
 *
 * Deletion is soft: `deleted_at` is set, and every CRM read already ignores such
 * rows. A record takes with it what exists only under it — a company its contacts
 * and opportunities — and the activities left attached to nothing that stays. One
 * transaction per delete, with one audit record and one event.
 */

type DeletionSet = {
  leadIds: string[];
  accountIds: string[];
  contactIds: string[];
  opportunityIds: string[];
};

function deletionSet(ids: Partial<DeletionSet>): DeletionSet {
  return {
    leadIds: ids.leadIds ?? [],
    accountIds: ids.accountIds ?? [],
    contactIds: ids.contactIds ?? [],
    opportunityIds: ids.opportunityIds ?? [],
  };
}

/**
 * Live activities that go with a deletion: linked to a record being deleted, and
 * linked to nothing that stays. A link stays unless it is empty, already deleted,
 * or part of this deletion — so a call logged on a contact and its company
 * survives the contact's deletion on the company's timeline.
 */
function activitiesGoingWith(set: DeletionSet): Prisma.CrmActivityWhereInput {
  return {
    deletedAt: null,
    OR: [
      { leadId: { in: set.leadIds } },
      { accountId: { in: set.accountIds } },
      { contactId: { in: set.contactIds } },
      { opportunityId: { in: set.opportunityIds } },
    ],
    AND: [
      {
        OR: [
          { leadId: null },
          { leadId: { in: set.leadIds } },
          { lead: { is: { deletedAt: { not: null } } } },
        ],
      },
      {
        OR: [
          { accountId: null },
          { accountId: { in: set.accountIds } },
          { account: { is: { deletedAt: { not: null } } } },
        ],
      },
      {
        OR: [
          { contactId: null },
          { contactId: { in: set.contactIds } },
          { contact: { is: { deletedAt: { not: null } } } },
        ],
      },
      {
        OR: [
          { opportunityId: null },
          { opportunityId: { in: set.opportunityIds } },
          { opportunity: { is: { deletedAt: { not: null } } } },
        ],
      },
    ],
  };
}

function counted(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/* -------------------------------------------------------------------------- */
/* Loading and authorising                                                    */
/* -------------------------------------------------------------------------- */

type Loaded = { id: string; label: string };

const ownerFields = { id: true, ownerId: true, owner: { select: userRefSelect } } as const;

/** A record the actor may not see is not found; one they may see but not delete is forbidden. */
async function authorise(
  actor: Actor,
  read: string,
  remove: string,
  target: ScopeTarget,
  entity: string,
): Promise<void> {
  await assertCanRead(actor, read, target, entity);
  await requirePermission(actor, remove, target);
}

async function loadLead(actor: Actor, leadId: string): Promise<Loaded> {
  if (!isUuid(leadId)) throw new NotFoundError("lead");
  const row = await prisma.crmLead.findFirst({
    where: { id: leadId, deletedAt: null },
    select: { ...ownerFields, firstName: true, lastName: true },
  });
  if (row === null) throw new NotFoundError("lead");
  await authorise(
    actor,
    CRM_PERMISSIONS.LEAD_READ,
    CRM_PERMISSIONS.LEAD_DELETE,
    toScopeTarget(row.ownerId, row.owner),
    "lead",
  );
  return { id: row.id, label: personName(row) };
}

async function loadAccount(actor: Actor, accountId: string): Promise<Loaded> {
  if (!isUuid(accountId)) throw new NotFoundError("company");
  const row = await prisma.crmAccount.findFirst({
    where: { id: accountId, deletedAt: null },
    select: { ...ownerFields, name: true },
  });
  if (row === null) throw new NotFoundError("company");
  await authorise(
    actor,
    CRM_PERMISSIONS.ACCOUNT_READ,
    CRM_PERMISSIONS.ACCOUNT_DELETE,
    toScopeTarget(row.ownerId, row.owner),
    "company",
  );
  return { id: row.id, label: row.name };
}

async function loadContact(actor: Actor, contactId: string): Promise<Loaded> {
  if (!isUuid(contactId)) throw new NotFoundError("contact");
  const row = await prisma.crmContact.findFirst({
    where: { id: contactId, deletedAt: null },
    select: { ...ownerFields, firstName: true, lastName: true },
  });
  if (row === null) throw new NotFoundError("contact");
  await authorise(
    actor,
    CRM_PERMISSIONS.CONTACT_READ,
    CRM_PERMISSIONS.CONTACT_DELETE,
    toScopeTarget(row.ownerId, row.owner),
    "contact",
  );
  return { id: row.id, label: personName(row) };
}

async function loadOpportunity(actor: Actor, opportunityId: string): Promise<Loaded> {
  if (!isUuid(opportunityId)) throw new NotFoundError("opportunity");
  const row = await prisma.crmOpportunity.findFirst({
    where: { id: opportunityId, deletedAt: null },
    select: { ...ownerFields, name: true },
  });
  if (row === null) throw new NotFoundError("opportunity");
  await authorise(
    actor,
    CRM_PERMISSIONS.OPPORTUNITY_READ,
    CRM_PERMISSIONS.OPPORTUNITY_DELETE,
    toScopeTarget(row.ownerId, row.owner),
    "opportunity",
  );
  return { id: row.id, label: row.name };
}

/** The live contacts and opportunities of a company. */
async function companyDependents(
  client: PrismaTransaction,
  accountId: string,
): Promise<{ contactIds: string[]; opportunityIds: string[] }> {
  const contacts = await client.crmContact.findMany({
    where: { accountId, deletedAt: null },
    select: { id: true },
  });
  const opportunities = await client.crmOpportunity.findMany({
    where: { accountId, deletedAt: null },
    select: { id: true },
  });
  return {
    contactIds: contacts.map((row) => row.id),
    opportunityIds: opportunities.map((row) => row.id),
  };
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                    */
/* -------------------------------------------------------------------------- */

type Stamp = { deletedAt: Date; updatedBy: string };

/**
 * Marks exactly one live row. Two simultaneous deletes of the same record queue on
 * the row lock; the second then matches nothing and reports it as not found.
 */
async function markOne(update: Promise<{ count: number }>, entity: string): Promise<void> {
  if ((await update).count !== 1) throw new NotFoundError(entity);
}

async function deleteActivitiesGoingWith(
  tx: PrismaTransaction,
  set: DeletionSet,
  stamp: Stamp,
): Promise<string[]> {
  const rows = await tx.crmActivity.findMany({
    where: activitiesGoingWith(set),
    select: { id: true },
  });
  const ids = rows.map((row) => row.id);
  if (ids.length > 0) {
    await tx.crmActivity.updateMany({ where: { id: { in: ids } }, data: stamp });
  }
  return ids;
}

async function recordDeletion(
  tx: PrismaTransaction,
  actor: Actor,
  entry: {
    action: string;
    entityType: string;
    entityId: string;
    summary: string;
    changes: Record<string, unknown>;
    event: string;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  await recordAudit(
    {
      ...auditFields(actor),
      action: entry.action,
      module: CRM_MODULE,
      entityType: entry.entityType,
      entityId: entry.entityId,
      summary: entry.summary,
      changes: entry.changes,
      severity: "WARNING",
    },
    tx,
  );
  await publish(tx, {
    name: entry.event,
    actorId: actor.id,
    correlationId: actor.correlationId ?? null,
    payload: entry.payload,
  });
}

/* -------------------------------------------------------------------------- */
/* Public operations                                                          */
/* -------------------------------------------------------------------------- */

export async function deleteLead(actor: Actor, leadId: string): Promise<void> {
  const lead = await loadLead(actor, leadId);
  await prisma.$transaction(async (tx) => {
    const stamp: Stamp = { deletedAt: new Date(), updatedBy: actor.id };
    await markOne(
      tx.crmLead.updateMany({ where: { id: lead.id, deletedAt: null }, data: stamp }),
      "lead",
    );
    const activityIds = await deleteActivitiesGoingWith(
      tx,
      deletionSet({ leadIds: [lead.id] }),
      stamp,
    );
    await recordDeletion(tx, actor, {
      action: "crm.lead.deleted",
      entityType: "CrmLead",
      entityId: lead.id,
      summary: `Deleted lead ${lead.label} and ${counted(activityIds.length, "activity", "activities")}`,
      changes: { activityIds },
      event: CRM_EVENTS.LEAD_DELETED,
      payload: { leadId: lead.id },
    });
  });
}

export async function deleteAccount(actor: Actor, accountId: string): Promise<void> {
  const account = await loadAccount(actor, accountId);
  await prisma.$transaction(async (tx) => {
    const stamp: Stamp = { deletedAt: new Date(), updatedBy: actor.id };
    await markOne(
      tx.crmAccount.updateMany({ where: { id: account.id, deletedAt: null }, data: stamp }),
      "company",
    );
    const { contactIds, opportunityIds } = await companyDependents(tx, account.id);
    const activityIds = await deleteActivitiesGoingWith(
      tx,
      deletionSet({ accountIds: [account.id], contactIds, opportunityIds }),
      stamp,
    );
    if (contactIds.length > 0) {
      await tx.crmContact.updateMany({ where: { id: { in: contactIds } }, data: stamp });
    }
    if (opportunityIds.length > 0) {
      await tx.crmOpportunity.updateMany({
        where: { id: { in: opportunityIds } },
        data: stamp,
      });
    }
    await recordDeletion(tx, actor, {
      action: "crm.account.deleted",
      entityType: "CrmAccount",
      entityId: account.id,
      summary:
        `Deleted company ${account.label} with ` +
        `${counted(contactIds.length, "contact", "contacts")}, ` +
        `${counted(opportunityIds.length, "opportunity", "opportunities")} and ` +
        `${counted(activityIds.length, "activity", "activities")}`,
      changes: { contactIds, opportunityIds, activityIds },
      event: CRM_EVENTS.CUSTOMER_DELETED,
      payload: { accountId: account.id, contactIds, opportunityIds },
    });
  });
}

export async function deleteContact(actor: Actor, contactId: string): Promise<void> {
  const contact = await loadContact(actor, contactId);
  await prisma.$transaction(async (tx) => {
    const stamp: Stamp = { deletedAt: new Date(), updatedBy: actor.id };
    await markOne(
      tx.crmContact.updateMany({ where: { id: contact.id, deletedAt: null }, data: stamp }),
      "contact",
    );
    const activityIds = await deleteActivitiesGoingWith(
      tx,
      deletionSet({ contactIds: [contact.id] }),
      stamp,
    );
    await recordDeletion(tx, actor, {
      action: "crm.contact.deleted",
      entityType: "CrmContact",
      entityId: contact.id,
      summary: `Deleted contact ${contact.label} and ${counted(activityIds.length, "activity", "activities")}`,
      changes: { activityIds },
      event: CRM_EVENTS.CONTACT_DELETED,
      payload: { contactId: contact.id },
    });
  });
}

export async function deleteOpportunity(actor: Actor, opportunityId: string): Promise<void> {
  const opportunity = await loadOpportunity(actor, opportunityId);
  await prisma.$transaction(async (tx) => {
    const stamp: Stamp = { deletedAt: new Date(), updatedBy: actor.id };
    await markOne(
      tx.crmOpportunity.updateMany({
        where: { id: opportunity.id, deletedAt: null },
        data: stamp,
      }),
      "opportunity",
    );
    const activityIds = await deleteActivitiesGoingWith(
      tx,
      deletionSet({ opportunityIds: [opportunity.id] }),
      stamp,
    );
    await recordDeletion(tx, actor, {
      action: "crm.opportunity.deleted",
      entityType: "CrmOpportunity",
      entityId: opportunity.id,
      summary: `Deleted opportunity ${opportunity.label} and ${counted(activityIds.length, "activity", "activities")}`,
      changes: { activityIds },
      event: CRM_EVENTS.OPPORTUNITY_DELETED,
      payload: { opportunityId: opportunity.id },
    });
  });
}

/**
 * Deletes one call, email, meeting, task or note. The CRM's own status and stage
 * entries are the history of their record and go only with it.
 */
export async function deleteActivity(actor: Actor, activityId: string): Promise<void> {
  if (!isUuid(activityId)) throw new NotFoundError("activity");
  const activity = await prisma.crmActivity.findFirst({
    where: { id: activityId, deletedAt: null },
    select: {
      id: true,
      type: true,
      subject: true,
      createdBy: true,
      creator: { select: userRefSelect },
    },
  });
  if (activity === null) throw new NotFoundError("activity");
  await authorise(
    actor,
    CRM_PERMISSIONS.ACTIVITY_READ,
    CRM_PERMISSIONS.ACTIVITY_DELETE,
    toScopeTarget(activity.createdBy, activity.creator),
    "activity",
  );
  if (activity.type === "STATUS_CHANGE" || activity.type === "STAGE_CHANGE") {
    throw new BusinessRuleError(
      "Status and stage changes are part of their record's history and are deleted only with the record.",
    );
  }

  await prisma.$transaction(async (tx) => {
    await markOne(
      tx.crmActivity.updateMany({
        where: { id: activity.id, deletedAt: null },
        data: { deletedAt: new Date(), updatedBy: actor.id },
      }),
      "activity",
    );
    await recordDeletion(tx, actor, {
      action: "crm.activity.deleted",
      entityType: "CrmActivity",
      entityId: activity.id,
      summary: `Deleted ${ACTIVITY_TYPE_LABELS[activity.type].toLowerCase()}: ${activity.subject}`,
      changes: { type: activity.type },
      event: CRM_EVENTS.ACTIVITY_DELETED,
      payload: { activityId: activity.id },
    });
  });
}

/** What deleting a record would take with it — the counts the confirmation shows. */
export async function getDeletionImpact(
  actor: Actor,
  rawTarget: unknown,
): Promise<DeletionImpact> {
  const target = parseInput(deletionTargetSchema, rawTarget);
  const countActivities = (set: DeletionSet) =>
    prisma.crmActivity.count({ where: activitiesGoingWith(set) });

  switch (target.kind) {
    case "lead": {
      const lead = await loadLead(actor, target.id);
      return {
        kind: "lead",
        ...lead,
        contacts: 0,
        opportunities: 0,
        activities: await countActivities(deletionSet({ leadIds: [lead.id] })),
      };
    }
    case "account": {
      const account = await loadAccount(actor, target.id);
      const { contactIds, opportunityIds } = await companyDependents(prisma, account.id);
      return {
        kind: "account",
        ...account,
        contacts: contactIds.length,
        opportunities: opportunityIds.length,
        activities: await countActivities(
          deletionSet({ accountIds: [account.id], contactIds, opportunityIds }),
        ),
      };
    }
    case "contact": {
      const contact = await loadContact(actor, target.id);
      return {
        kind: "contact",
        ...contact,
        contacts: 0,
        opportunities: 0,
        activities: await countActivities(deletionSet({ contactIds: [contact.id] })),
      };
    }
    case "opportunity": {
      const opportunity = await loadOpportunity(actor, target.id);
      return {
        kind: "opportunity",
        ...opportunity,
        contacts: 0,
        opportunities: 0,
        activities: await countActivities(
          deletionSet({ opportunityIds: [opportunity.id] }),
        ),
      };
    }
  }
}
```

- [ ] **Step 4: Export it**

In `modules/crm/contracts/service.ts`, directly after the `export { … } from "../services/activity-service";` block, add:

```ts

/** Administrator deletion (ADR-024): soft delete, cascading to what exists only under the record. */
export {
  deleteAccount,
  deleteActivity,
  deleteContact,
  deleteLead,
  deleteOpportunity,
  getDeletionImpact,
} from "../services/deletion-service";
```

- [ ] **Step 5: Run the tests**

Run: `npx dotenv -e .env.local -- vitest run tests/integration/crm-deletion.test.ts`
Expected: every test PASSES **except** the two that check reads — "keeps an activity that is also on a record that stays…" (the timeline still links the deleted contact, and the opportunity still shows it as primary contact) and "stops a converted lead linking to what was deleted". Those are fixed in Task 3. If anything else fails, fix the service before moving on.

- [ ] **Step 6: Typecheck and lint the new code**

Run: `npx tsc --noEmit && npx eslint modules/crm tests/integration/crm-deletion.test.ts tests/unit/crm-deletion.test.ts`
Expected: no output.

- [ ] **Step 7: Commit (only with the owner's go-ahead)**

```bash
git add modules/crm/services/deletion-service.ts modules/crm/contracts/service.ts tests/integration/crm-deletion.test.ts
git commit -m "feat(crm): soft-delete services for leads, companies, contacts, opportunities and activities"
```

---

### Task 3: Reads stop linking to deleted records

**Files:**
- Modify: `modules/crm/repositories/selects.ts` (lead detail select and mapper; opportunity list select; activity select and mapper)
- Test: `tests/integration/crm-deletion.test.ts` (already written in Task 2)

- [ ] **Step 1: Confirm the two read tests fail**

Run: `npx dotenv -e .env.local -- vitest run tests/integration/crm-deletion.test.ts -t "linking|stays"`
Expected: FAIL — `related` still contains `contact`, `primaryContact` is not null, and the converted links are not null.

- [ ] **Step 2: Lead detail — select `deletedAt` on the converted records**

In `modules/crm/repositories/selects.ts`, replace:

```ts
  convertedAccount: { select: { id: true, name: true } },
  convertedContact: { select: { id: true, firstName: true, lastName: true } },
  convertedOpportunity: { select: { id: true, name: true } },
} as const satisfies Prisma.CrmLeadSelect;
```

with:

```ts
  convertedAccount: { select: { id: true, name: true, deletedAt: true } },
  convertedContact: {
    select: { id: true, firstName: true, lastName: true, deletedAt: true },
  },
  convertedOpportunity: { select: { id: true, name: true, deletedAt: true } },
} as const satisfies Prisma.CrmLeadSelect;
```

- [ ] **Step 3: Lead detail — never link a deleted record**

In `toLeadDetail`, replace the three conditions:

```ts
      row.convertedAccount === null
```
```ts
      row.convertedContact === null
```
```ts
      row.convertedOpportunity === null
```

with, respectively:

```ts
      row.convertedAccount === null || row.convertedAccount.deletedAt !== null
```
```ts
      row.convertedContact === null || row.convertedContact.deletedAt !== null
```
```ts
      row.convertedOpportunity === null || row.convertedOpportunity.deletedAt !== null
```

- [ ] **Step 4: Opportunities — a deleted contact is no primary contact**

In `opportunityListSelect`, replace:

```ts
  contacts: {
    where: { isPrimary: true },
```

with:

```ts
  contacts: {
    where: { isPrimary: true, contact: { deletedAt: null } },
```

(`opportunityDetailSelect` spreads `opportunityListSelect`, so the detail page is covered too.)

- [ ] **Step 5: Activities — select `deletedAt` on linked records**

In `activitySelect`, replace:

```ts
  lead: { select: { id: true, firstName: true, lastName: true } },
  account: { select: { id: true, name: true } },
  contact: { select: { id: true, firstName: true, lastName: true } },
  opportunity: { select: { id: true, name: true } },
} as const satisfies Prisma.CrmActivitySelect;
```

with:

```ts
  lead: { select: { id: true, firstName: true, lastName: true, deletedAt: true } },
  account: { select: { id: true, name: true, deletedAt: true } },
  contact: { select: { id: true, firstName: true, lastName: true, deletedAt: true } },
  opportunity: { select: { id: true, name: true, deletedAt: true } },
} as const satisfies Prisma.CrmActivitySelect;
```

- [ ] **Step 6: Activities — skip deleted links**

In `toActivityDto`, replace the four conditions:

```ts
  if (row.lead !== null) {
```
```ts
  if (row.contact !== null) {
```
```ts
  if (row.account !== null) {
```
```ts
  if (row.opportunity !== null) {
```

with, respectively:

```ts
  if (row.lead !== null && row.lead.deletedAt === null) {
```
```ts
  if (row.contact !== null && row.contact.deletedAt === null) {
```
```ts
  if (row.account !== null && row.account.deletedAt === null) {
```
```ts
  if (row.opportunity !== null && row.opportunity.deletedAt === null) {
```

- [ ] **Step 7: Run the deletion and CRM suites**

Run: `npx dotenv -e .env.local -- vitest run tests/integration/crm-deletion.test.ts tests/integration/crm.test.ts`
Expected: PASS — all 11 deletion tests and all 26 CRM tests.

- [ ] **Step 8: Commit (only with the owner's go-ahead)**

```bash
git add modules/crm/repositories/selects.ts
git commit -m "fix(crm): never link to a deleted lead, company, contact or opportunity"
```

---

### Task 4: Server Actions

**Files:**
- Modify: `modules/crm/ui/links.ts`, `modules/crm/ui/actions.ts`

- [ ] **Step 1: Add the list path helper**

At the end of `modules/crm/ui/links.ts`, add:

```ts

/** The list page of a CRM record type — where a deleted record's page sends you. */
export function recordListHref(kind: RecordKind): string {
  return RECORD_PATH[kind];
}
```

- [ ] **Step 2: Import what the actions need**

In `modules/crm/ui/actions.ts`, replace:

```ts
import { revalidatePath } from "next/cache";
```

with:

```ts
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
```

and replace:

```ts
import {
  LEAD_STATUSES,
  type ActivityDto,
  type ConversionResult,
  type LeadStatus,
  type OpportunityListItem,
} from "../contracts/types";
```

with:

```ts
import {
  LEAD_STATUSES,
  type ActivityDto,
  type ConversionResult,
  type DeletionImpact,
  type LeadStatus,
  type OpportunityListItem,
} from "../contracts/types";
import { recordListHref } from "./links";
```

- [ ] **Step 3: Add the actions**

At the end of `modules/crm/ui/actions.ts`, add:

```ts

/* Deletion — administrators only; the services decide who may -------------- */

export async function getDeletionImpactAction(
  target: unknown,
): Promise<ActionResult<DeletionImpact>> {
  return run("crm.deletion.preview", (actor) => crm.getDeletionImpact(actor, target));
}

/*
 * Deleting a lead, company, contact or opportunity ends on that record type's list.
 * `redirect` throws to navigate, so it runs after `run`, outside its try block.
 */

export async function deleteLeadAction(leadId: string): Promise<ActionResult> {
  const result = await run("crm.lead.delete", async (actor) => {
    await crm.deleteLead(actor, leadId);
    return null;
  });
  if (result.ok) redirect(recordListHref("lead"));
  return result;
}

export async function deleteAccountAction(accountId: string): Promise<ActionResult> {
  const result = await run("crm.account.delete", async (actor) => {
    await crm.deleteAccount(actor, accountId);
    return null;
  });
  if (result.ok) redirect(recordListHref("account"));
  return result;
}

export async function deleteContactAction(contactId: string): Promise<ActionResult> {
  const result = await run("crm.contact.delete", async (actor) => {
    await crm.deleteContact(actor, contactId);
    return null;
  });
  if (result.ok) redirect(recordListHref("contact"));
  return result;
}

export async function deleteOpportunityAction(
  opportunityId: string,
): Promise<ActionResult> {
  const result = await run("crm.opportunity.delete", async (actor) => {
    await crm.deleteOpportunity(actor, opportunityId);
    return null;
  });
  if (result.ok) redirect(recordListHref("opportunity"));
  return result;
}

export async function deleteActivityAction(activityId: string): Promise<ActionResult> {
  return run("crm.activity.delete", async (actor) => {
    await crm.deleteActivity(actor, activityId);
    return null;
  });
}
```

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint modules/crm/ui`
Expected: no output.

- [ ] **Step 5: Commit (only with the owner's go-ahead)**

```bash
git add modules/crm/ui/links.ts modules/crm/ui/actions.ts
git commit -m "feat(crm): server actions for administrator deletion"
```

---

### Task 5: Confirmation dialogs

**Files:**
- Create: `modules/crm/ui/delete-record.tsx`
- Modify: `modules/crm/ui/activity-timeline.tsx`, `modules/crm/ui/activity-list.tsx`

- [ ] **Step 1: Create the dialogs**

Create `modules/crm/ui/delete-record.tsx`:

```tsx
"use client";

import { Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions } from "@/components/ui/dialog";
import {
  ACTIVITY_TYPE_LABELS,
  type ActivityDto,
  type DeletionImpact,
  type RecordKind,
} from "../contracts/types";
import {
  type ActionResult,
  deleteAccountAction,
  deleteActivityAction,
  deleteContactAction,
  deleteLeadAction,
  deleteOpportunityAction,
  getDeletionImpactAction,
} from "./actions";
import { describeAlsoDeleted } from "./format";

/**
 * Administrator deletion (ADR-024, §17.4): the confirmation names the record and
 * says what goes with it, using counts from the server. Shown only to holders of
 * the delete permission; the server checks again.
 */

const DELETE_ACTION: Record<RecordKind, (id: string) => Promise<ActionResult>> = {
  lead: deleteLeadAction,
  account: deleteAccountAction,
  contact: deleteContactAction,
  opportunity: deleteOpportunityAction,
};

const NOUN: Record<RecordKind, string> = {
  lead: "lead",
  account: "company",
  contact: "contact",
  opportunity: "opportunity",
};

const PERMANENCE =
  "It disappears from the CRM for everyone and cannot be restored from the app. The deletion is recorded in the audit trail.";

export function DeleteRecordButton({
  kind,
  id,
  name,
}: {
  kind: RecordKind;
  id: string;
  name: string;
}) {
  const [open, setOpen] = useState(false);
  const [impact, setImpact] = useState<DeletionImpact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, startLoading] = useTransition();
  const [isDeleting, startDeleting] = useTransition();

  function openDialog() {
    setImpact(null);
    setError(null);
    setOpen(true);
    startLoading(async () => {
      const result = await getDeletionImpactAction({ kind, id });
      if (result.ok) setImpact(result.data);
      else setError(result.message);
    });
  }

  function confirm() {
    setError(null);
    startDeleting(async () => {
      const result = await DELETE_ACTION[kind](id);
      // On success the server redirects to the list; only a refusal comes back.
      if (result !== undefined && !result.ok) setError(result.message);
    });
  }

  return (
    <>
      <Button
        variant="danger"
        icon={<Trash2 aria-hidden="true" size={15} />}
        onClick={openDialog}
      >
        Delete
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!isDeleting) setOpen(next);
        }}
        title={`Delete ${name}?`}
        description={`This ${NOUN[kind]}`}
      >
        <p className="text-foreground text-sm" aria-live="polite">
          {isLoading
            ? "Checking what goes with it…"
            : impact !== null
              ? describeAlsoDeleted(impact)
              : null}
        </p>
        <p className="text-foreground-muted mt-2 text-sm">{PERMANENCE}</p>
        {error !== null && (
          <p role="alert" className="text-danger mt-3 text-sm font-bold">
            {error}
          </p>
        )}
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={isDeleting}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={confirm}
            isPending={isDeleting}
            disabled={impact === null}
          >
            {isDeleting ? "Deleting…" : `Delete ${NOUN[kind]}`}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

export function DeleteActivityButton({ activity }: { activity: ActivityDto }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, startDeleting] = useTransition();
  const label = ACTIVITY_TYPE_LABELS[activity.type].toLowerCase();

  function confirm() {
    setError(null);
    startDeleting(async () => {
      const result = await deleteActivityAction(activity.id);
      if (result.ok) setOpen(false);
      else setError(result.message);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        aria-label={`Delete ${label}: ${activity.subject}`}
        title={`Delete ${label}`}
        className="text-foreground-subtle hover:bg-surface-hover hover:text-danger grid size-7 cursor-pointer place-items-center"
      >
        <Trash2 aria-hidden="true" size={13} />
      </button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!isDeleting) setOpen(next);
        }}
        title={`Delete this ${label}?`}
        description={activity.subject}
      >
        <p className="text-foreground-muted text-sm">
          It disappears from every timeline and feed and cannot be restored from the app.
          The deletion is recorded in the audit trail.
        </p>
        {error !== null && (
          <p role="alert" className="text-danger mt-3 text-sm font-bold">
            {error}
          </p>
        )}
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={isDeleting}>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirm} isPending={isDeleting}>
            {isDeleting ? "Deleting…" : `Delete ${label}`}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 2: Timeline — accept and use `canDeleteActivities`**

In `modules/crm/ui/activity-timeline.tsx`:

Replace:

```tsx
import { EditActivityButton } from "./edit-activity";
```

with:

```tsx
import { DeleteActivityButton } from "./delete-record";
import { EditActivityButton } from "./edit-activity";
```

Replace:

```tsx
export function ActivityTimeline({
  activities,
  currentRecordId,
  canUpdateActivities,
  emptyAction,
}: {
  activities: ActivityDto[];
  /** Hidden from the "related" chips, since the reader is already on it. */
  currentRecordId?: string;
  /** Holds `crm.activity.update`: may complete tasks and edit entries (re-checked on the server). */
  canUpdateActivities: boolean;
  emptyAction?: React.ReactNode;
}) {
```

with:

```tsx
export function ActivityTimeline({
  activities,
  currentRecordId,
  canUpdateActivities,
  canDeleteActivities = false,
  emptyAction,
}: {
  activities: ActivityDto[];
  /** Hidden from the "related" chips, since the reader is already on it. */
  currentRecordId?: string;
  /** Holds `crm.activity.update`: may complete tasks and edit entries (re-checked on the server). */
  canUpdateActivities: boolean;
  /** Holds `crm.activity.delete`: an administrator (re-checked on the server). */
  canDeleteActivities?: boolean;
  emptyAction?: React.ReactNode;
}) {
```

Replace:

```tsx
          currentRecordId={currentRecordId}
          canUpdateActivities={canUpdateActivities}
        />
```

with:

```tsx
          currentRecordId={currentRecordId}
          canUpdateActivities={canUpdateActivities}
          canDeleteActivities={canDeleteActivities}
        />
```

Replace:

```tsx
export function TimelineItem({
  activity,
  currentRecordId,
  canUpdateActivities,
}: {
  activity: ActivityDto;
  currentRecordId?: string;
  canUpdateActivities: boolean;
}) {
```

with:

```tsx
export function TimelineItem({
  activity,
  currentRecordId,
  canUpdateActivities,
  canDeleteActivities = false,
}: {
  activity: ActivityDto;
  currentRecordId?: string;
  canUpdateActivities: boolean;
  canDeleteActivities?: boolean;
}) {
```

Replace:

```tsx
            {canUpdateActivities && !isSystem && (
              <EditActivityButton activity={activity} />
            )}
```

with:

```tsx
            {canUpdateActivities && !isSystem && (
              <EditActivityButton activity={activity} />
            )}
            {canDeleteActivities && !isSystem && (
              <DeleteActivityButton activity={activity} />
            )}
```

- [ ] **Step 3: Feeds — pass it through**

In `modules/crm/ui/activity-list.tsx`, replace:

```tsx
  canUpdateActivities,
  emptyTitle,
  emptyDescription,
}: {
  result: Paginated<ActivityDto>;
  basePath: string;
  searchParams: Record<string, string | undefined>;
  canUpdateActivities: boolean;
```

with:

```tsx
  canUpdateActivities,
  canDeleteActivities = false,
  emptyTitle,
  emptyDescription,
}: {
  result: Paginated<ActivityDto>;
  basePath: string;
  searchParams: Record<string, string | undefined>;
  canUpdateActivities: boolean;
  canDeleteActivities?: boolean;
```

and replace:

```tsx
                canUpdateActivities={canUpdateActivities}
              />
```

with:

```tsx
                canUpdateActivities={canUpdateActivities}
                canDeleteActivities={canDeleteActivities}
              />
```

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint modules/crm/ui`
Expected: no output.

- [ ] **Step 5: Commit (only with the owner's go-ahead)**

```bash
git add modules/crm/ui/delete-record.tsx modules/crm/ui/activity-timeline.tsx modules/crm/ui/activity-list.tsx
git commit -m "feat(crm): delete confirmations for records and activities"
```

---

### Task 6: Put Delete on the pages

**Files:**
- Modify: `app/(platform)/crm/accounts/[id]/page.tsx`, `app/(platform)/crm/contacts/[id]/page.tsx`, `app/(platform)/crm/leads/[id]/page.tsx`, `app/(platform)/crm/opportunities/[id]/page.tsx`, `app/(platform)/crm/activities/page.tsx`, `app/(platform)/crm/tasks/page.tsx`, `app/(platform)/crm/notes/page.tsx`

- [ ] **Step 1: Company page**

In `app/(platform)/crm/accounts/[id]/page.tsx`:

Replace `import { DetailList } from "@/modules/crm/ui/detail-list";` with:

```tsx
import { DeleteRecordButton } from "@/modules/crm/ui/delete-record";
import { DetailList } from "@/modules/crm/ui/detail-list";
```

Replace:

```tsx
    CRM_PERMISSIONS.ACTIVITY_CREATE,
    CRM_PERMISSIONS.ACTIVITY_UPDATE,
  ]);
```

with:

```tsx
    CRM_PERMISSIONS.ACTIVITY_CREATE,
    CRM_PERMISSIONS.ACTIVITY_UPDATE,
    CRM_PERMISSIONS.ACCOUNT_DELETE,
    CRM_PERMISSIONS.ACTIVITY_DELETE,
  ]);
```

Replace:

```tsx
                New opportunity
              </ButtonLink>
            )}
          </>
        }
```

with:

```tsx
                New opportunity
              </ButtonLink>
            )}
            {rights[CRM_PERMISSIONS.ACCOUNT_DELETE] === true && (
              <DeleteRecordButton kind="account" id={account.id} name={account.name} />
            )}
          </>
        }
```

Replace:

```tsx
              currentRecordId={account.id}
              canUpdateActivities={rights[CRM_PERMISSIONS.ACTIVITY_UPDATE] === true}
```

with:

```tsx
              currentRecordId={account.id}
              canUpdateActivities={rights[CRM_PERMISSIONS.ACTIVITY_UPDATE] === true}
              canDeleteActivities={rights[CRM_PERMISSIONS.ACTIVITY_DELETE] === true}
```

- [ ] **Step 2: Contact page**

In `app/(platform)/crm/contacts/[id]/page.tsx`:

Replace `import { DetailList } from "@/modules/crm/ui/detail-list";` with:

```tsx
import { DeleteRecordButton } from "@/modules/crm/ui/delete-record";
import { DetailList } from "@/modules/crm/ui/detail-list";
```

Replace:

```tsx
    CRM_PERMISSIONS.ACTIVITY_CREATE,
    CRM_PERMISSIONS.ACTIVITY_UPDATE,
  ]);
```

with:

```tsx
    CRM_PERMISSIONS.ACTIVITY_CREATE,
    CRM_PERMISSIONS.ACTIVITY_UPDATE,
    CRM_PERMISSIONS.CONTACT_DELETE,
    CRM_PERMISSIONS.ACTIVITY_DELETE,
  ]);
```

Replace:

```tsx
                  New opportunity
                </ButtonLink>
              )}
          </>
```

with:

```tsx
                  New opportunity
                </ButtonLink>
              )}
            {rights[CRM_PERMISSIONS.CONTACT_DELETE] === true && (
              <DeleteRecordButton kind="contact" id={contact.id} name={contact.name} />
            )}
          </>
```

Replace:

```tsx
            currentRecordId={contact.id}
            canUpdateActivities={rights[CRM_PERMISSIONS.ACTIVITY_UPDATE] === true}
```

with:

```tsx
            currentRecordId={contact.id}
            canUpdateActivities={rights[CRM_PERMISSIONS.ACTIVITY_UPDATE] === true}
            canDeleteActivities={rights[CRM_PERMISSIONS.ACTIVITY_DELETE] === true}
```

- [ ] **Step 3: Lead page** (Delete is shown for converted leads too, and without update rights)

In `app/(platform)/crm/leads/[id]/page.tsx`:

Replace `import { DetailList } from "@/modules/crm/ui/detail-list";` with:

```tsx
import { DeleteRecordButton } from "@/modules/crm/ui/delete-record";
import { DetailList } from "@/modules/crm/ui/detail-list";
```

Replace:

```tsx
    CRM_PERMISSIONS.ACTIVITY_CREATE,
    CRM_PERMISSIONS.ACTIVITY_UPDATE,
  ]);
```

with:

```tsx
    CRM_PERMISSIONS.ACTIVITY_CREATE,
    CRM_PERMISSIONS.ACTIVITY_UPDATE,
    CRM_PERMISSIONS.LEAD_DELETE,
    CRM_PERMISSIONS.ACTIVITY_DELETE,
  ]);
```

Replace:

```tsx
        actions={
          canUpdate && !converted ? (
            <>
              <LeadEditButton lead={lead} />
              <ButtonLink
                href={`/crm/leads/${lead.id}/convert`}
                variant="primary"
                icon={<Sparkles aria-hidden="true" size={15} />}
              >
                Convert
              </ButtonLink>
            </>
          ) : undefined
        }
```

with:

```tsx
        actions={
          <>
            {canUpdate && !converted && (
              <>
                <LeadEditButton lead={lead} />
                <ButtonLink
                  href={`/crm/leads/${lead.id}/convert`}
                  variant="primary"
                  icon={<Sparkles aria-hidden="true" size={15} />}
                >
                  Convert
                </ButtonLink>
              </>
            )}
            {rights[CRM_PERMISSIONS.LEAD_DELETE] === true && (
              <DeleteRecordButton kind="lead" id={lead.id} name={lead.name} />
            )}
          </>
        }
```

Replace:

```tsx
            currentRecordId={lead.id}
            canUpdateActivities={rights[CRM_PERMISSIONS.ACTIVITY_UPDATE] === true}
```

with:

```tsx
            currentRecordId={lead.id}
            canUpdateActivities={rights[CRM_PERMISSIONS.ACTIVITY_UPDATE] === true}
            canDeleteActivities={rights[CRM_PERMISSIONS.ACTIVITY_DELETE] === true}
```

- [ ] **Step 4: Opportunity page**

In `app/(platform)/crm/opportunities/[id]/page.tsx`:

Replace `import { DetailList } from "@/modules/crm/ui/detail-list";` with:

```tsx
import { DeleteRecordButton } from "@/modules/crm/ui/delete-record";
import { DetailList } from "@/modules/crm/ui/detail-list";
```

Replace:

```tsx
    CRM_PERMISSIONS.ACTIVITY_CREATE,
    CRM_PERMISSIONS.ACTIVITY_UPDATE,
  ]);
```

with:

```tsx
    CRM_PERMISSIONS.ACTIVITY_CREATE,
    CRM_PERMISSIONS.ACTIVITY_UPDATE,
    CRM_PERMISSIONS.OPPORTUNITY_DELETE,
    CRM_PERMISSIONS.ACTIVITY_DELETE,
  ]);
```

Replace:

```tsx
        actions={
          canEdit ? (
            <EditOpportunityButton
              opportunity={opportunity}
              stages={stages}
              currentUserId={actor.id}
            />
          ) : undefined
        }
```

with:

```tsx
        actions={
          <>
            {canEdit && (
              <EditOpportunityButton
                opportunity={opportunity}
                stages={stages}
                currentUserId={actor.id}
              />
            )}
            {rights[CRM_PERMISSIONS.OPPORTUNITY_DELETE] === true && (
              <DeleteRecordButton
                kind="opportunity"
                id={opportunity.id}
                name={opportunity.name}
              />
            )}
          </>
        }
```

Replace:

```tsx
            currentRecordId={opportunity.id}
            canUpdateActivities={rights[CRM_PERMISSIONS.ACTIVITY_UPDATE] === true}
```

with:

```tsx
            currentRecordId={opportunity.id}
            canUpdateActivities={rights[CRM_PERMISSIONS.ACTIVITY_UPDATE] === true}
            canDeleteActivities={rights[CRM_PERMISSIONS.ACTIVITY_DELETE] === true}
```

- [ ] **Step 5: Activities and Tasks feeds**

In both `app/(platform)/crm/activities/page.tsx` and `app/(platform)/crm/tasks/page.tsx`, replace:

```tsx
    canAll(actor, [CRM_PERMISSIONS.ACTIVITY_UPDATE]),
```

with:

```tsx
    canAll(actor, [CRM_PERMISSIONS.ACTIVITY_UPDATE, CRM_PERMISSIONS.ACTIVITY_DELETE]),
```

and replace:

```tsx
        canUpdateActivities={rights[CRM_PERMISSIONS.ACTIVITY_UPDATE] === true}
```

with:

```tsx
        canUpdateActivities={rights[CRM_PERMISSIONS.ACTIVITY_UPDATE] === true}
        canDeleteActivities={rights[CRM_PERMISSIONS.ACTIVITY_DELETE] === true}
```

- [ ] **Step 6: Notes feed**

In `app/(platform)/crm/notes/page.tsx`, replace:

```tsx
    canAll(actor, [CRM_PERMISSIONS.ACTIVITY_CREATE, CRM_PERMISSIONS.ACTIVITY_UPDATE]),
```

with:

```tsx
    canAll(actor, [
      CRM_PERMISSIONS.ACTIVITY_CREATE,
      CRM_PERMISSIONS.ACTIVITY_UPDATE,
      CRM_PERMISSIONS.ACTIVITY_DELETE,
    ]),
```

and replace:

```tsx
        canUpdateActivities={rights[CRM_PERMISSIONS.ACTIVITY_UPDATE] === true}
```

with:

```tsx
        canUpdateActivities={rights[CRM_PERMISSIONS.ACTIVITY_UPDATE] === true}
        canDeleteActivities={rights[CRM_PERMISSIONS.ACTIVITY_DELETE] === true}
```

- [ ] **Step 7: Format, typecheck, lint, build**

Run:

```bash
find "app/(platform)/crm" -name "page.tsx" -print0 | xargs -0 npx prettier --write
npx prettier --write modules/crm tests/unit/crm-deletion.test.ts tests/integration/crm-deletion.test.ts
npm run verify
npm run build
```

Expected: `verify` reports 0 type errors, 0 lint errors and all unit tests passing (5 more than before); `build` succeeds with the same route count as before (no new routes).

- [ ] **Step 8: Commit (only with the owner's go-ahead)**

```bash
git add "app/(platform)/crm"
git commit -m "feat(crm): delete buttons for administrators on record pages and activity feeds"
```

---

### Task 7: Documentation

**Files:**
- Modify: `CLAUDE.md` (§6.1 bullet, ADR-024 after ADR-023, §28 CRM table, §29 table)

- [ ] **Step 1: §6.1 — the activity rule**

Replace:

```markdown
- Activities are never deleted to rewrite history. Calls, emails, meetings, notes and tasks may be corrected by
```

with:

```markdown
- Activities are never deleted to rewrite history by the people who work them: only an administrator holding
  `crm.activity.delete` may delete a call, email, meeting, note or task (a soft delete, audited — ADR-024), and the
  CRM's own status and stage entries go only with their record. Calls, emails, meetings, notes and tasks may be corrected by
```

- [ ] **Step 2: ADR-024**

Directly after the paragraph that ends `or AR lists pass ~200 ms (rollups, §6.7).` (the end of ADR-023), add a blank line and:

```markdown
**ADR-024 — CRM deletion: administrators only, soft, cascading to what exists only under the record.** _Context:_ the
owner asked that an administrator can delete any CRM record. The five `crm.*.delete` permissions had existed since the
CRM shipped, held by `platform-admin` and by the Sales role, but no delete operation existed; §6.1 said activities are
never deleted. ERP invoices reference `crm_account_id`. _Decision:_ (1) Only administrators delete: the delete keys are
removed from `CRM_SALES_PERMISSIONS` (`CRM_DELETE_PERMISSIONS`), so `platform-admin` alone holds them. (2) Deletion is
soft — `deleted_at` and `updated_by` are set, every CRM read already filters them, there is no restore screen and no
permanent delete; company names and contact emails become reusable through the existing live-row unique indexes, and
ERP keeps working because the reference contract reports a deleted company as no longer existing. (3) A record takes
with it what exists only under it, in one transaction (`services/deletion-service.ts`): a company its live contacts
and opportunities; any record the activities linked to it and to nothing that stays — an activity also attached to a
surviving record stays on that record's timeline. The CRM's status and stage entries cannot be deleted individually.
(4) Each service checks that the caller may read the record (else 404), then the delete permission with the record's
scope target (else 403); marks the record with a conditional update, so a second simultaneous delete finds nothing;
and writes one WARNING audit record listing everything deleted with it and one event (`crm.LeadDeleted`,
`crm.CustomerDeleted`, `crm.ContactDeleted`, `crm.OpportunityDeleted`, `crm.ActivityDeleted`, ids only). (5) Reads
never link to a deleted record: activity chips, a converted lead's links and an opportunity's primary contact skip
them; opportunity–contact join rows are kept. (6) The confirmation shows counts from `getDeletionImpact`, computed with
the same rule the delete uses. No migration. _Consequences:_ an accidental delete can only be undone by a database
fix; salespeople can no longer delete anything; deleted rows stay in the database. _Revisit when:_ the owner wants a
restore screen, bulk delete, or permanent deletion for data-protection requests.
```

- [ ] **Step 3: §28 — CRM status**

In the §28 CRM module table, directly before the row that starts `| UI          | ✅ \`/crm\` dashboard;`, add:

```markdown
| Deletion    | ✅ Administrators (holders of `crm.*.delete`, i.e. `platform-admin`; Sales no longer holds them) soft-delete leads, companies, contacts, opportunities, and calls, emails, meetings, tasks and notes, from the record pages and activity feeds, after a confirmation with server counts. A company takes its contacts and opportunities; activities go when attached to nothing that stays; status and stage entries go only with their record. One transaction, a WARNING audit record and a `crm.*Deleted` event per delete; reads never link to deleted records (ADR-024). 11 integration and 5 unit tests. |
```

- [ ] **Step 4: §29 — debt**

Directly after the row that starts `| 36  | **Default approval needs two people**`, add:

```markdown
| 37  | **No restore for deleted CRM records**                      | Deletion is soft, but there is no screen to view or restore deleted records; undoing an accidental delete needs a database fix (ADR-024) | A "Deleted records" admin page with restore, if mistakes happen | 🟢 Low    |
| 38  | **No bulk delete in the CRM**                               | Administrators delete one record at a time | Add delete to the leads bulk-action bar and the other lists when volume demands it | 🟢 Low    |
```

- [ ] **Step 5: Commit (only with the owner's go-ahead)**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-09-15-crm-admin-delete-design.md docs/superpowers/plans/2026-09-15-crm-admin-delete.md
git commit -m "docs(crm): ADR-024 administrator deletion; status and debt"
```

---

### Task 8: Full verification, then rollout when the owner asks

- [ ] **Step 1: Full gates**

Run:

```bash
npm run verify
npm run test:integration
npm run build
```

Expected: verify 0 type errors, 0 lint errors, all unit tests passing; the full local integration suite passing (11 more tests than before); build succeeds.

- [ ] **Step 2: Secret scan of what will be committed**

Run:

```bash
git add -A -- . ':!design/Form response pending.zip'
# Scan the staged diff with the secret patterns kept out of commits (deliberately not written here).
```

Expected: `clean`.

- [ ] **Step 3: Deploy (only when the owner asks)**

No migration. Push to `main`, wait for Vercel to report success on the commit:

```bash
git push origin main
gh api repos/mabdelazizemail-tech/TechVault/commits/$(git rev-parse HEAD)/status --jq '[.state, (.statuses[] | select(.context=="Vercel") | .state)] | join(" ")'
```

Expected (after a few minutes): `success success`.

- [ ] **Step 4: Seed, so Sales loses the delete permissions in production**

Run: `npm run db:seed`
Then verify by direct query (read-only) that the Sales role holds no CRM delete permission and `platform-admin` holds all five:

```sql
select r.key, count(*) from iam.role_permissions rp
join iam.roles r on r.id = rp.role_id
join iam.permissions p on p.id = rp.permission_id
where p.key like 'crm.%.delete'
group by r.key;
```

Expected: one row, `platform-admin | 5`.

- [ ] **Step 5: Smoke test**

Run:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://tech-vault-gamma.vercel.app/api/health/ready
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" https://tech-vault-gamma.vercel.app/crm/accounts
```

Expected: `200`, then `307 …/login?next=%2Fcrm%2Faccounts`.
