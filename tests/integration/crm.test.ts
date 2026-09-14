import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  BusinessRuleError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import {
  CRM_PERMISSIONS,
  CRM_SALES_PERMISSIONS,
} from "@/modules/crm/contracts/permissions";
import {
  convertLead,
  createLead,
  getLead,
  getPipeline,
  listLeads,
  listTimeline,
  logActivity,
  moveOpportunity,
  searchCrm,
  getCrmDashboard,
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
 * The CRM workflow against a real database:
 *
 *   capture lead → qualify → convert → opportunity → drag through the pipeline
 *   → closed won / lost
 *
 * plus the rules around it: permissions in both directions, no duplicate
 * customers on conversion, closing details required, and every change leaving a
 * timeline entry, an audit record and an event.
 */
describe.skipIf(!hasTestDatabase)("CRM workflow (integration)", () => {
  let rep: { id: string };
  let ownRep: { id: string };
  let outsider: { id: string };
  let stages: Map<string, string>;

  afterAll(async () => {
    await teardownDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedPermissions();
    await seedStages();

    const sales = await createRole("sales", CRM_SALES_PERMISSIONS);
    rep = await createUser({ email: "rep@example.com" });
    ownRep = await createUser({ email: "own-rep@example.com" });
    outsider = await createUser({ email: "outsider@example.com" });
    await grantRole(rep.id, sales.id);
    await grantRole(ownRep.id, sales.id, { scopeType: "OWN" });

    const rows = await testPrisma().crmOpportunityStage.findMany({
      select: { id: true, key: true },
    });
    stages = new Map(rows.map((row) => [row.key, row.id]));
  });

  const wizard = (overrides: Record<string, unknown> = {}) => ({
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
    ...overrides,
  });

  const stageId = (key: string) => {
    const id = stages.get(key);
    if (id === undefined) throw new Error(`stage ${key} missing`);
    return id;
  };

  describe("capturing a lead", () => {
    it("is refused to a user without CRM permissions", async () => {
      await expect(createLead({ id: outsider.id }, wizard())).rejects.toThrow(
        ForbiddenError,
      );
    });

    it("stores the lead, its first timeline entry, an audit record and an event", async () => {
      const result = await createLead({ id: rep.id }, wizard());

      const lead = await getLead({ id: rep.id }, result.leadId);
      expect(lead.name).toBe("John Smith");
      expect(lead.status).toBe("QUALIFIED");
      expect(lead.score).toBe(82);
      expect(lead.budgetMinor).toBe(5_000_000);
      expect(lead.owner?.id).toBe(rep.id);
      expect(result.opportunityId).toBeNull();

      const timeline = await listTimeline(
        { id: rep.id },
        { kind: "lead", id: result.leadId },
      );
      expect(timeline.map((entry) => entry.type)).toEqual(["STATUS_CHANGE"]);

      expect(
        await testPrisma().auditLog.count({
          where: { action: "crm.lead.created", entityId: result.leadId },
        }),
      ).toBe(1);
      expect(
        await testPrisma().eventOutbox.count({ where: { name: "crm.LeadCreated" } }),
      ).toBe(1);
    });
  });

  describe("converting a lead", () => {
    it("creates the company, contact and opportunity, and carries the history over", async () => {
      const { leadId } = await createLead({ id: rep.id }, wizard());
      await logActivity(
        { id: rep.id },
        { type: "CALL", subject: "Discovery call", leadId },
      );

      const result = await convertLead(
        { id: rep.id },
        {
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
        },
      );

      expect(result.opportunityId).not.toBeNull();
      const lead = await getLead({ id: rep.id }, leadId);
      expect(lead.status).toBe("CONVERTED");
      expect(lead.convertedAccount?.label).toBe("Acme Corporation");

      const opportunity = await testPrisma().crmOpportunity.findUniqueOrThrow({
        where: { id: result.opportunityId ?? "" },
        select: {
          stageId: true,
          amountMinor: true,
          contacts: { select: { contactId: true, isPrimary: true } },
        },
      });
      expect(opportunity.stageId).toBe(stageId("qualified"));
      expect(opportunity.amountMinor).toBe(4_500_000);
      expect(opportunity.contacts).toEqual([
        { contactId: result.contactId, isPrimary: true },
      ]);

      // The call logged against the lead now also appears on the company timeline.
      const accountTimeline = await listTimeline(
        { id: rep.id },
        { kind: "account", id: result.accountId },
      );
      expect(accountTimeline.map((entry) => entry.subject)).toContain("Discovery call");
    });

    it("refuses to convert the same lead twice", async () => {
      const { leadId } = await createLead({ id: rep.id }, wizard());
      const conversion = {
        leadId,
        accountMode: "new",
        contactMode: "new",
        createOpportunity: false,
        opportunity: null,
      };
      await convertLead({ id: rep.id }, conversion);
      await expect(convertLead({ id: rep.id }, conversion)).rejects.toThrow(
        BusinessRuleError,
      );
    });

    it("reuses an existing company and contact instead of duplicating them", async () => {
      const first = await createLead({ id: rep.id }, wizard());
      const firstResult = await convertLead(
        { id: rep.id },
        {
          leadId: first.leadId,
          accountMode: "new",
          contactMode: "new",
          createOpportunity: false,
          opportunity: null,
        },
      );

      // Same person, same company, different capitalisation.
      const second = await createLead(
        { id: rep.id },
        wizard({
          info: {
            firstName: "John",
            lastName: "Smith",
            company: "ACME corporation",
            email: "JOHN@acme.com",
            source: "EVENT",
          },
        }),
      );
      const secondResult = await convertLead(
        { id: rep.id },
        {
          leadId: second.leadId,
          accountMode: "new",
          contactMode: "new",
          createOpportunity: false,
          opportunity: null,
        },
      );

      expect(secondResult.accountId).toBe(firstResult.accountId);
      expect(secondResult.contactId).toBe(firstResult.contactId);
      expect(await testPrisma().crmAccount.count()).toBe(1);
      expect(await testPrisma().crmContact.count()).toBe(1);
    });

    it("converts in one step from the wizard's Save & Create Opportunity", async () => {
      const result = await createLead(
        { id: rep.id },
        wizard({
          opportunity: {
            name: "Acme Enterprise Deal",
            amount: "45000",
            closeDate: "2026-10-30",
            probability: "20",
          },
        }),
      );
      expect(result.opportunityId).not.toBeNull();
      expect((await getLead({ id: rep.id }, result.leadId)).status).toBe("CONVERTED");
    });
  });

  describe("moving an opportunity through the pipeline", () => {
    async function newDeal(): Promise<string> {
      const result = await createLead(
        { id: rep.id },
        wizard({
          opportunity: {
            name: "Acme Enterprise Deal",
            amount: "45000",
            closeDate: "2026-10-30",
            probability: "20",
            stageId: stageId("lead"),
          },
        }),
      );
      return result.opportunityId ?? "";
    }

    it("persists every stage change with the stage's probability and a timeline entry", async () => {
      const opportunityId = await newDeal();

      for (const key of ["qualified", "discovery", "proposal", "negotiation"]) {
        const card = await moveOpportunity(
          { id: rep.id },
          { opportunityId, stageId: stageId(key), close: null },
        );
        expect(card.stage.id).toBe(stageId(key));
      }

      const stored = await testPrisma().crmOpportunity.findUniqueOrThrow({
        where: { id: opportunityId },
        select: { stageId: true, probability: true, status: true },
      });
      expect(stored).toEqual({
        stageId: stageId("negotiation"),
        probability: 80,
        status: "OPEN",
      });

      const stageChanges = await testPrisma().crmActivity.count({
        where: { opportunityId, type: "STAGE_CHANGE" },
      });
      // One for creation, four for the moves.
      expect(stageChanges).toBe(5);
      expect(
        await testPrisma().auditLog.count({
          where: { action: "crm.opportunity.stage_changed" },
        }),
      ).toBe(4);
    });

    it("requires the final value to close won, then records the win", async () => {
      const opportunityId = await newDeal();

      await expect(
        moveOpportunity(
          { id: rep.id },
          { opportunityId, stageId: stageId("closed_won"), close: null },
        ),
      ).rejects.toThrow(ValidationError);

      await moveOpportunity(
        { id: rep.id },
        {
          opportunityId,
          stageId: stageId("closed_won"),
          close: {
            kind: "WON",
            actualCloseDate: "2026-09-12",
            finalAmount: "47500",
            notes: "Signed",
          },
        },
      );

      const stored = await testPrisma().crmOpportunity.findUniqueOrThrow({
        where: { id: opportunityId },
        select: {
          status: true,
          amountMinor: true,
          probability: true,
          wonAt: true,
          closeDate: true,
        },
      });
      expect(stored.status).toBe("WON");
      expect(stored.amountMinor).toBe(4_750_000);
      expect(stored.probability).toBe(100);
      expect(stored.wonAt).not.toBeNull();
      expect(stored.closeDate.toISOString()).toBe("2026-09-12T00:00:00.000Z");
      expect(
        await testPrisma().eventOutbox.count({ where: { name: "crm.OpportunityWon" } }),
      ).toBe(1);
    });

    it("requires a reason to close lost, and reopening clears it", async () => {
      const opportunityId = await newDeal();

      await moveOpportunity(
        { id: rep.id },
        {
          opportunityId,
          stageId: stageId("closed_lost"),
          close: { kind: "LOST", lostReason: "COMPETITOR", notes: "" },
        },
      );
      let stored = await testPrisma().crmOpportunity.findUniqueOrThrow({
        where: { id: opportunityId },
        select: { status: true, lostReason: true },
      });
      expect(stored).toEqual({ status: "LOST", lostReason: "COMPETITOR" });

      await moveOpportunity(
        { id: rep.id },
        { opportunityId, stageId: stageId("proposal"), close: null },
      );
      stored = await testPrisma().crmOpportunity.findUniqueOrThrow({
        where: { id: opportunityId },
        select: { status: true, lostReason: true },
      });
      expect(stored).toEqual({ status: "OPEN", lostReason: null });
    });

    it("totals the board: pipeline, weighted value, and this month's wins", async () => {
      const a = await newDeal(); // $45,000 in Lead
      await moveOpportunity(
        { id: rep.id },
        { opportunityId: a, stageId: stageId("proposal"), close: null },
      );

      const board = await getPipeline({ id: rep.id });
      expect(board.summary.open).toEqual([{ currency: "EGP", amountMinor: 4_500_000 }]);
      // 60% at Proposal.
      expect(board.summary.weighted).toEqual([
        { currency: "EGP", amountMinor: 2_700_000 },
      ]);
      const proposal = board.columns.find((column) => column.stage.key === "proposal");
      expect(proposal?.count).toBe(1);
      expect(proposal?.cards[0]?.name).toBe("Acme Enterprise Deal");
    });

    it("keeps EGP and USD pipeline separate instead of adding them together", async () => {
      await newDeal(); // EGP 45,000
      await createLead(
        { id: rep.id },
        wizard({
          info: {
            firstName: "Sara",
            lastName: "Lee",
            company: "Globex",
            email: "sara@globex.example",
            source: "EVENT",
          },
          opportunity: {
            name: "Globex Records Scanning",
            amount: "35000",
            currency: "USD",
            closeDate: "2026-11-15",
            probability: "20",
            stageId: stageId("lead"),
          },
        }),
      );

      const board = await getPipeline({ id: rep.id });
      expect(board.summary.open).toEqual([
        { currency: "EGP", amountMinor: 4_500_000 },
        { currency: "USD", amountMinor: 3_500_000 },
      ]);
      const leadColumn = board.columns.find((column) => column.stage.key === "lead");
      expect(leadColumn?.count).toBe(2);
      expect(leadColumn?.totals).toHaveLength(2);
    });
  });

  describe("scope", () => {
    it("hides other people's records from an OWN-scoped salesperson", async () => {
      const { leadId, opportunityId } = await createLead(
        { id: rep.id },
        wizard({
          opportunity: {
            name: "Rep's deal",
            amount: "1000",
            closeDate: "2026-12-01",
            probability: "20",
          },
        }),
      );

      expect((await listLeads({ id: ownRep.id })).total).toBe(0);
      await expect(getLead({ id: ownRep.id }, leadId)).rejects.toThrow(NotFoundError);
      await expect(
        moveOpportunity(
          { id: ownRep.id },
          {
            opportunityId: opportunityId ?? "",
            stageId: stageId("proposal"),
            close: null,
          },
        ),
      ).rejects.toThrow(NotFoundError);

      const results = await searchCrm({ id: ownRep.id }, "Acme");
      expect(results.leads).toHaveLength(0);
      expect(results.opportunities).toHaveLength(0);

      const dashboard = await getCrmDashboard({ id: ownRep.id });
      expect(dashboard.totalLeads).toBe(0);
      expect(dashboard.pipeline).toEqual([]);
    });

    it("refuses an activity on a record the actor cannot see", async () => {
      const { leadId } = await createLead({ id: rep.id }, wizard());
      await expect(
        logActivity({ id: ownRep.id }, { type: "NOTE", subject: "Sneaky", leadId }),
      ).rejects.toThrow(NotFoundError);
      expect(await testPrisma().crmActivity.count({ where: { subject: "Sneaky" } })).toBe(
        0,
      );
    });

    it("denies an outsider the dashboard entirely", async () => {
      await expect(getCrmDashboard({ id: outsider.id })).rejects.toThrow(ForbiddenError);
    });
  });

  describe("database invariants", () => {
    it("refuses a second live company with the same name in any case", async () => {
      await testPrisma().crmAccount.create({ data: { name: "Globex" } });
      await expect(
        testPrisma().crmAccount.create({ data: { name: "GLOBEX" } }),
      ).rejects.toThrow();
    });

    it("refuses an activity linked to no record", async () => {
      await expect(
        testPrisma().crmActivity.create({ data: { type: "NOTE", subject: "Orphan" } }),
      ).rejects.toThrow();
    });

    it("refuses a lost deal without a reason", async () => {
      const account = await testPrisma().crmAccount.create({ data: { name: "Initech" } });
      await expect(
        testPrisma().crmOpportunity.create({
          data: {
            name: "No reason",
            accountId: account.id,
            stageId: stageId("closed_lost"),
            status: "LOST",
            lostAt: new Date(),
            amountMinor: 100,
            closeDate: new Date("2026-09-01T00:00:00.000Z"),
          },
        }),
      ).rejects.toThrow();
    });

    it("keeps scores within 0–100", async () => {
      await expect(
        testPrisma().crmLead.create({
          data: {
            firstName: "A",
            lastName: "B",
            company: "C",
            source: "OTHER",
            score: 101,
          },
        }),
      ).rejects.toThrow();
    });
  });

  it("uses CRM permission constants that exist in the seeded catalogue", async () => {
    const count = await testPrisma().permission.count({
      where: { key: { in: Object.values(CRM_PERMISSIONS) } },
    });
    expect(count).toBe(Object.values(CRM_PERMISSIONS).length);
  });
});
