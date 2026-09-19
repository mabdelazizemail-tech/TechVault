import { applyRate, sumMinor } from "@/lib/money";
import {
  CRM_CURRENCIES,
  type CrmCurrency,
  type LostReason,
  type MoneyTotal,
  type OpportunityStatus,
  type StageDto,
  type StageKind,
} from "../contracts/types";

/**
 * Pipeline rules — pure functions, no I/O, so every rule is unit-testable.
 *
 * Services call these to decide WHAT a stage move does; the service then persists
 * the result inside a transaction with its audit record and event.
 */

/**
 * The default pipeline, seeded into `crm.opportunity_stages`. Seeding creates
 * missing stages only: once a stage exists it is configuration and belongs to the
 * administrator (§6.1 — stages are data, not code).
 */
export const DEFAULT_STAGES = [
  { key: "lead", name: "Lead", position: 1, kind: "OPEN", defaultProbability: 10 },
  {
    key: "qualified",
    name: "Qualified",
    position: 2,
    kind: "OPEN",
    defaultProbability: 20,
  },
  {
    key: "discovery",
    name: "Discovery",
    position: 3,
    kind: "OPEN",
    defaultProbability: 40,
  },
  {
    key: "proposal",
    name: "Proposal",
    position: 4,
    kind: "OPEN",
    defaultProbability: 60,
  },
  {
    key: "negotiation",
    name: "Negotiation",
    position: 5,
    kind: "OPEN",
    defaultProbability: 80,
  },
  {
    key: "closed_won",
    name: "Closed Won",
    position: 6,
    kind: "WON",
    defaultProbability: 100,
  },
  {
    key: "closed_lost",
    name: "Closed Lost",
    position: 7,
    kind: "LOST",
    defaultProbability: 0,
  },
] as const satisfies readonly {
  key: string;
  name: string;
  position: number;
  kind: StageKind;
  defaultProbability: number;
}[];

/** The stage a freshly converted lead's opportunity starts in. */
export const CONVERSION_STAGE_KEY = "qualified";

/** How long a closed deal stays visible on the board. */
export const CLOSED_VISIBLE_DAYS = 30;

export type CloseDetails =
  | {
      kind: "WON";
      actualCloseDate: Date;
      finalAmountMinor: number;
      notes: string | null;
    }
  | {
      kind: "LOST";
      lostReason: LostReason;
      notes: string | null;
    };

/** The fields a stage move writes. Absent optional fields are left unchanged. */
export type StageMovePlan = {
  status: OpportunityStatus;
  probability: number;
  amountMinor?: number;
  closeDate?: Date;
  wonAt: Date | null;
  lostAt: Date | null;
  lostReason: LostReason | null;
  closeNotes: string | null;
};

export type StageMoveOutcome =
  | { ok: true; plan: StageMovePlan }
  | {
      ok: false;
      reason: "CLOSE_DETAILS_REQUIRED" | "CLOSE_DETAILS_MISMATCH";
      message: string;
    };

/**
 * Decides what moving an opportunity into `target` means.
 *
 * - Into an OPEN stage: the deal is (re)opened, takes the stage's default
 *   probability, and any previous win/loss details are cleared.
 * - Into WON: requires the final amount and actual close date.
 * - Into LOST: requires a lost reason.
 *
 * A win or loss without its details is refused rather than defaulted: the reason a
 * deal was lost is exactly the data a sales team needs later.
 */
export function planStageMove(
  target: Pick<StageDto, "kind" | "defaultProbability">,
  close: CloseDetails | null,
  now: Date,
): StageMoveOutcome {
  if (target.kind === "OPEN") {
    return {
      ok: true,
      plan: {
        status: "OPEN",
        probability: target.defaultProbability,
        wonAt: null,
        lostAt: null,
        lostReason: null,
        closeNotes: null,
      },
    };
  }

  if (close === null) {
    return {
      ok: false,
      reason: "CLOSE_DETAILS_REQUIRED",
      message:
        target.kind === "WON"
          ? "Confirm the final value and close date to mark this deal as won."
          : "Choose why this deal was lost.",
    };
  }

  if (close.kind !== target.kind) {
    return {
      ok: false,
      reason: "CLOSE_DETAILS_MISMATCH",
      message: "The closing details do not match the destination stage.",
    };
  }

  if (close.kind === "WON") {
    return {
      ok: true,
      plan: {
        status: "WON",
        probability: 100,
        amountMinor: close.finalAmountMinor,
        closeDate: close.actualCloseDate,
        wonAt: now,
        lostAt: null,
        lostReason: null,
        closeNotes: close.notes,
      },
    };
  }

  return {
    ok: true,
    plan: {
      status: "LOST",
      probability: 0,
      wonAt: null,
      lostAt: now,
      lostReason: close.lostReason,
      closeNotes: close.notes,
    },
  };
}

/** Amount × probability, rounded to a whole minor unit. */
export function weightedMinor(amountMinor: number, probability: number): number {
  return applyRate(amountMinor, probability / 100);
}

/**
 * Sums amounts PER CURRENCY, in the canonical currency order, omitting currencies
 * with nothing in them. There is deliberately no single grand total.
 */
export function totalsByCurrency(
  rows: readonly { currency: CrmCurrency; amountMinor: number }[],
): MoneyTotal[] {
  const buckets = new Map<CrmCurrency, number[]>();
  for (const row of rows) {
    const bucket = buckets.get(row.currency) ?? [];
    bucket.push(row.amountMinor);
    buckets.set(row.currency, bucket);
  }
  return CRM_CURRENCIES.filter((code) => buckets.has(code)).map((code) => ({
    currency: code,
    amountMinor: sumMinor(buckets.get(code) ?? []),
  }));
}

/** Total and probability-weighted value of open opportunities, per currency. */
export function summariseOpen(
  opportunities: readonly {
    currency: CrmCurrency;
    amountMinor: number;
    probability: number;
  }[],
): { open: MoneyTotal[]; weighted: MoneyTotal[] } {
  return {
    open: totalsByCurrency(opportunities),
    weighted: totalsByCurrency(
      opportunities.map((opportunity) => ({
        currency: opportunity.currency,
        amountMinor: weightedMinor(opportunity.amountMinor, opportunity.probability),
      })),
    ),
  };
}

/** Converts `groupBy(... currency) _sum` rows into per-currency totals. */
export function totalsFromGroups(
  groups: readonly { currency: CrmCurrency; _sum: { amountMinor: number | null } }[],
): MoneyTotal[] {
  return totalsByCurrency(
    groups.map((group) => ({
      currency: group.currency,
      amountMinor: group._sum.amountMinor ?? 0,
    })),
  );
}

/**
 * Probability-weighted value per currency from open deals grouped by amount and
 * probability. Identical deals round identically, so weighting one and multiplying
 * by the count gives the same figure as `summariseOpen`, deal by deal.
 */
export function weightedFromGroups(
  groups: readonly {
    currency: CrmCurrency;
    amountMinor: number;
    probability: number;
    _count: { _all: number };
  }[],
): MoneyTotal[] {
  return totalsByCurrency(
    groups.map((group) => ({
      currency: group.currency,
      amountMinor:
        weightedMinor(group.amountMinor, group.probability) * group._count._all,
    })),
  );
}

/** Converted leads as a percentage of all leads, to one decimal; null with no leads. */
export function conversionRate(converted: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((converted / total) * 1000) / 10;
}

/** Midnight UTC on the first day of `now`'s month. */
export function startOfUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** `now` minus the closed-deal visibility window. */
export function closedVisibleSince(now: Date): Date {
  return new Date(now.getTime() - CLOSED_VISIBLE_DAYS * 24 * 60 * 60 * 1000);
}
