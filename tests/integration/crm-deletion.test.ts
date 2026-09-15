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

  /** Converts a lead into a company, a contact and an opportunity. */
  const convert = async (leadId: string) => {
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

  const convertedDeal = async () => {
    const { leadId } = await createLead(as(admin), wizard());
    return convert(leadId);
  };

  const deletedAt = async (
    model: "account" | "contact" | "opportunity" | "activity",
    id: string,
  ): Promise<Date | null> => {
    const prisma = testPrisma();
    const select = { deletedAt: true } as const;
    const row =
      model === "account"
        ? await prisma.crmAccount.findUniqueOrThrow({ where: { id }, select })
        : model === "contact"
          ? await prisma.crmContact.findUniqueOrThrow({ where: { id }, select })
          : model === "opportunity"
            ? await prisma.crmOpportunity.findUniqueOrThrow({ where: { id }, select })
            : await prisma.crmActivity.findUniqueOrThrow({ where: { id }, select });
    return row.deletedAt;
  };

  const deletedActivityCount = () =>
    testPrisma().crmActivity.count({ where: { deletedAt: { not: null } } });

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
      expect(await deletedActivityCount()).toBe(impact.activities);

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

    it("takes a contact's activities, even though they are filed on the company, but leaves a lead's history with the lead", async () => {
      const { leadId } = await createLead(as(admin), wizard());
      // Logged before conversion, so conversion copies it onto the contact too.
      const history = await logActivity(as(admin), {
        type: "CALL",
        subject: "Discovery call",
        leadId,
      });
      const deal = await convert(leadId);
      const note = await logActivity(as(admin), {
        type: "NOTE",
        subject: "Contact note",
        contactId: deal.contactId,
      });

      const impact = await getDeletionImpact(as(admin), {
        kind: "contact",
        id: deal.contactId,
      });
      await deleteContact(as(admin), deal.contactId);

      expect(await deletedAt("activity", note.id)).not.toBeNull();
      expect(await deletedAt("activity", history.id)).toBeNull();
      expect(await deletedActivityCount()).toBe(impact.activities);

      // The lead's call stays, without a link to the deleted contact.
      const timeline = await listTimeline(as(admin), { kind: "lead", id: leadId });
      const call = timeline.find((entry) => entry.id === history.id);
      expect(call).toBeDefined();
      expect(call?.related.map((ref) => ref.kind)).not.toContain("contact");

      const opportunity = await getOpportunity(as(admin), deal.opportunityId);
      expect(opportunity.primaryContact).toBeNull();
      expect(opportunity.primaryContactDetail).toBeNull();
    });

    it("deletes an opportunity with its activities and drops it from its company and contact", async () => {
      const deal = await convertedDeal();
      const note = await logActivity(as(admin), {
        type: "NOTE",
        subject: "Deal note",
        opportunityId: deal.opportunityId,
      });

      await deleteOpportunity(as(admin), deal.opportunityId);

      await expect(getOpportunity(as(admin), deal.opportunityId)).rejects.toThrow(
        NotFoundError,
      );
      expect(await deletedAt("activity", note.id)).not.toBeNull();
      // Everything logged on the deal went, its stage history included, except what a lead keeps.
      expect(
        await testPrisma().crmActivity.count({
          where: { opportunityId: deal.opportunityId, leadId: null, deletedAt: null },
        }),
      ).toBe(0);
      expect((await getAccount(as(admin), deal.accountId)).opportunities).toHaveLength(0);
      expect((await getContact(as(admin), deal.contactId)).opportunities).toHaveLength(0);
    });

    it("stops a converted lead linking to what was deleted", async () => {
      const deal = await convertedDeal();
      await deleteAccount(as(admin), deal.accountId);
      const lead = await getLead(as(admin), deal.leadId);
      expect([
        lead.convertedAccount,
        lead.convertedContact,
        lead.convertedOpportunity,
      ]).toEqual([null, null, null]);
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
      expect(await prisma.crmAccount.count({ where: { deletedAt: { not: null } } })).toBe(
        0,
      );
      expect(await deletedActivityCount()).toBe(0);
      expect(
        await prisma.auditLog.count({ where: { action: { endsWith: ".deleted" } } }),
      ).toBe(0);
    });
  });
});
