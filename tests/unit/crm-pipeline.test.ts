import { describe, expect, it } from "vitest";
import {
  activitySchema,
  createLeadSchema,
  moveOpportunitySchema,
  opportunitySchema,
} from "@/modules/crm/contracts/schemas";
import {
  DEFAULT_STAGES,
  conversionRate,
  planStageMove,
  startOfUtcMonth,
  summariseOpen,
  totalsByCurrency,
  weightedMinor,
} from "@/modules/crm/domain/pipeline";

/**
 * CRM pipeline rules — pure, so every branch is checked without a database.
 */

const NOW = new Date("2026-09-13T15:00:00.000Z");
const OPEN = { kind: "OPEN" as const, defaultProbability: 60 };
const WON = { kind: "WON" as const, defaultProbability: 100 };
const LOST = { kind: "LOST" as const, defaultProbability: 0 };

describe("planStageMove", () => {
  it("opens the deal at the stage's default probability and clears closing details", () => {
    expect(planStageMove(OPEN, null, NOW)).toEqual({
      ok: true,
      plan: {
        status: "OPEN",
        probability: 60,
        wonAt: null,
        lostAt: null,
        lostReason: null,
        closeNotes: null,
      },
    });
  });

  it("refuses to win a deal without its final value and close date", () => {
    const outcome = planStageMove(WON, null, NOW);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("CLOSE_DETAILS_REQUIRED");
      expect(outcome.message).toMatch(/final value/);
    }
  });

  it("refuses to lose a deal without a reason", () => {
    const outcome = planStageMove(LOST, null, NOW);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toMatch(/why/);
  });

  it("refuses details that do not match the destination", () => {
    const outcome = planStageMove(
      WON,
      { kind: "LOST", lostReason: "PRICE", notes: null },
      NOW,
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("CLOSE_DETAILS_MISMATCH");
  });

  it("wins with the final amount, the actual close date and full probability", () => {
    const closeDate = new Date("2026-09-10T00:00:00.000Z");
    expect(
      planStageMove(
        WON,
        {
          kind: "WON",
          actualCloseDate: closeDate,
          finalAmountMinor: 4_250_000,
          notes: "Signed",
        },
        NOW,
      ),
    ).toEqual({
      ok: true,
      plan: {
        status: "WON",
        probability: 100,
        amountMinor: 4_250_000,
        closeDate,
        wonAt: NOW,
        lostAt: null,
        lostReason: null,
        closeNotes: "Signed",
      },
    });
  });

  it("loses with the reason and zero probability, leaving the amount untouched", () => {
    const outcome = planStageMove(
      LOST,
      { kind: "LOST", lostReason: "COMPETITOR", notes: null },
      NOW,
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.plan.status).toBe("LOST");
      expect(outcome.plan.probability).toBe(0);
      expect(outcome.plan.lostReason).toBe("COMPETITOR");
      expect(outcome.plan.lostAt).toEqual(NOW);
      expect(outcome.plan.amountMinor).toBeUndefined();
    }
  });
});

describe("pipeline figures", () => {
  it("weights an amount by probability, rounding to a whole minor unit", () => {
    expect(weightedMinor(4_500_000, 85)).toBe(3_825_000);
    expect(weightedMinor(333, 33)).toBe(110);
  });

  it("never adds EGP to USD — every currency gets its own total", () => {
    expect(
      totalsByCurrency([
        { currency: "USD", amountMinor: 3_500_000 },
        { currency: "EGP", amountMinor: 1_000_000_000 },
        { currency: "EGP", amountMinor: 20_000_000 },
      ]),
    ).toEqual([
      { currency: "EGP", amountMinor: 1_020_000_000 },
      { currency: "USD", amountMinor: 3_500_000 },
    ]);
  });

  it("omits currencies with nothing in them", () => {
    expect(totalsByCurrency([])).toEqual([]);
    expect(totalsByCurrency([{ currency: "USD", amountMinor: 100 }])).toEqual([
      { currency: "USD", amountMinor: 100 },
    ]);
  });

  it("summarises open and weighted value per currency without floating-point drift", () => {
    expect(
      summariseOpen([
        { currency: "USD", amountMinor: 4_500_000, probability: 85 },
        { currency: "EGP", amountMinor: 12_500_000, probability: 20 },
        { currency: "USD", amountMinor: 10, probability: 10 },
      ]),
    ).toEqual({
      open: [
        { currency: "EGP", amountMinor: 12_500_000 },
        { currency: "USD", amountMinor: 4_500_010 },
      ],
      weighted: [
        { currency: "EGP", amountMinor: 2_500_000 },
        { currency: "USD", amountMinor: 3_825_001 },
      ],
    });
  });

  it("reports conversion as a percentage to one decimal, or null with no leads", () => {
    expect(conversionRate(0, 0)).toBeNull();
    expect(conversionRate(2, 15)).toBe(13.3);
    expect(conversionRate(15, 15)).toBe(100);
  });

  it("finds the start of the UTC month", () => {
    expect(startOfUtcMonth(NOW).toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("ships a pipeline with exactly one won and one lost stage, in order", () => {
    expect(DEFAULT_STAGES.filter((stage) => stage.kind === "WON")).toHaveLength(1);
    expect(DEFAULT_STAGES.filter((stage) => stage.kind === "LOST")).toHaveLength(1);
    const positions = DEFAULT_STAGES.map((stage) => stage.position);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });
});

describe("CRM input schemas", () => {
  const wizard = {
    info: {
      firstName: " John ",
      lastName: "Smith",
      company: "Acme Corporation",
      jobTitle: "CEO",
      email: "John@Acme.com",
      phone: "",
      website: "acme.com",
      source: "REFERRAL",
      industry: "",
      companySize: "",
      country: "United States",
      city: "",
    },
    qualification: {
      interest: "Enterprise plan",
      budget: "50000",
      budgetCurrency: "",
      timeline: "WITHIN_3_MONTHS",
      decisionMaker: "YES",
      currentSolution: "",
      painPoint: "",
      score: "82",
      status: "QUALIFIED",
    },
    ownerId: "",
    opportunity: null,
  };

  it("normalises the wizard's form values", () => {
    const parsed = createLeadSchema.parse(wizard);
    expect(parsed.info.firstName).toBe("John");
    expect(parsed.info.email).toBe("john@acme.com");
    expect(parsed.info.website).toBe("https://acme.com");
    expect(parsed.info.phone).toBeNull();
    expect(parsed.info.companySize).toBeNull();
    expect(parsed.qualification.budget).toBe(50000);
    expect(parsed.qualification.budgetCurrency).toBe("EGP");
    expect(parsed.qualification.score).toBe(82);
    expect(parsed.ownerId).toBeNull();
  });

  it("rejects a lead without a source or a company", () => {
    const result = createLeadSchema.safeParse({
      ...wizard,
      info: { ...wizard.info, company: " ", source: "" },
    });
    expect(result.success).toBe(false);
    const paths = result.error?.issues.map((issue) => issue.path.join(".")) ?? [];
    expect(paths).toEqual(expect.arrayContaining(["info.company", "info.source"]));
  });

  it("rejects an out-of-range score, a negative budget and an unknown currency", () => {
    const withQualification = (overrides: Record<string, string>) =>
      createLeadSchema.safeParse({
        ...wizard,
        qualification: { ...wizard.qualification, ...overrides },
      }).success;
    expect(withQualification({ score: "140" })).toBe(false);
    expect(withQualification({ budget: "-5" })).toBe(false);
    expect(withQualification({ budgetCurrency: "GBP" })).toBe(false);
  });

  it("requires a channel partner for an indirect deal", () => {
    const deal = {
      name: "Branch archive scanning",
      accountId: "8e4c1a52-2b3d-4b0e-9c1f-2f8d7b6a5e41",
      stageId: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
      amount: "15000000",
      currency: "EGP",
      closeDate: "2026-10-30",
      probability: "60",
      channel: "INDIRECT",
      partnerName: "",
    };
    const refused = opportunitySchema.safeParse(deal);
    expect(refused.success).toBe(false);
    expect(refused.error?.issues[0]?.path).toEqual(["partnerName"]);
    expect(
      opportunitySchema.safeParse({ ...deal, partnerName: "Nova Channel Partners" })
        .success,
    ).toBe(true);
    expect(opportunitySchema.safeParse({ ...deal, channel: "DIRECT" }).success).toBe(
      true,
    );
  });

  it("requires closing details to be well-formed when present", () => {
    const base = {
      opportunityId: "8e4c1a52-2b3d-4b0e-9c1f-2f8d7b6a5e41",
      stageId: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
    };
    expect(moveOpportunitySchema.safeParse({ ...base, close: null }).success).toBe(true);
    expect(
      moveOpportunitySchema.safeParse({
        ...base,
        close: { kind: "LOST", lostReason: "BORED", notes: "" },
      }).success,
    ).toBe(false);
    expect(
      moveOpportunitySchema.safeParse({
        ...base,
        close: {
          kind: "WON",
          actualCloseDate: "2026-09-10",
          finalAmount: "45000",
          notes: "",
        },
      }).success,
    ).toBe(true);
  });

  it("refuses an activity that is not linked to any record", () => {
    expect(
      activitySchema.safeParse({ type: "CALL", subject: "Intro call" }).success,
    ).toBe(false);
  });
});
