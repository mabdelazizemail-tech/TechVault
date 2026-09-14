import { describe, expect, it } from "vitest";
import {
  ERP_ACCOUNTANT_PERMISSIONS,
  ERP_FINANCE_ADMIN_PERMISSIONS,
  ERP_PERMISSIONS,
  ERP_PERMISSION_DEFINITIONS,
} from "@/modules/erp/contracts/permissions";
import {
  accountCreateSchema,
  journalDraftSchema,
  periodCreateSchema,
} from "@/modules/erp/contracts/schemas";
import { DEFAULT_CHART } from "@/modules/erp/domain/chart";
import {
  formatJournalNumber,
  formatMinorAmount,
  isIsoDate,
  parseAmountText,
  postingProblems,
  reversedLines,
  summarizeLines,
  type PostingLine,
} from "@/modules/erp/domain/journal";

/**
 * The accounting rules of the ERP journal, without a database (CLAUDE.md §20:
 * money maths and double-entry posting are mandatory coverage).
 */

const account = (
  overrides: Partial<{ code: string; isActive: boolean; isPostable: boolean }> = {},
) => ({
  code: "1110",
  isActive: true,
  isPostable: true,
  ...overrides,
});

const line = (
  debitMinor: bigint,
  creditMinor: bigint,
  overrides: Partial<PostingLine> = {},
): PostingLine => ({
  debitMinor,
  creditMinor,
  account: account(),
  costCentre: null,
  ...overrides,
});

const september: {
  name: string;
  status: "OPEN" | "CLOSED";
  startDate: string;
  endDate: string;
} = {
  name: "September 2026",
  status: "OPEN",
  startDate: "2026-09-01",
  endDate: "2026-09-30",
};

const balanced = [
  line(5_000_000n, 0n),
  line(0n, 5_000_000n, { account: account({ code: "1120" }) }),
];

describe("parseAmountText — exact, never through a float", () => {
  it("parses grouped major units into minor units", () => {
    expect(parseAmountText("50,000.00")).toEqual({ ok: true, minor: 5_000_000n });
    expect(parseAmountText("12.5")).toEqual({ ok: true, minor: 1250n });
    expect(parseAmountText("0.05")).toEqual({ ok: true, minor: 5n });
    expect(parseAmountText("  1 250 ")).toEqual({ ok: true, minor: 125_000n });
  });

  it("treats a blank amount as zero", () => {
    expect(parseAmountText("")).toEqual({ ok: true, minor: 0n });
  });

  it("accepts Arabic-Indic digits and the Arabic decimal separator", () => {
    expect(parseAmountText("٥٠٠٫٢٥")).toEqual({ ok: true, minor: 50_025n });
  });

  it("rejects negative amounts", () => {
    expect(parseAmountText("-10")).toEqual({
      ok: false,
      message: "Amounts cannot be negative.",
    });
  });

  it("rejects more than two decimal places, including a drifted float", () => {
    expect(parseAmountText("1.234").ok).toBe(false);
    expect(parseAmountText(String(0.1 + 0.2)).ok).toBe(false);
  });

  it("rejects text that is not an amount and amounts that are too large", () => {
    expect(parseAmountText("ten").ok).toBe(false);
    expect(parseAmountText("1e5").ok).toBe(false);
    expect(parseAmountText("123456789012").ok).toBe(false);
    expect(parseAmountText("99999999999.99")).toEqual({
      ok: true,
      minor: 9_999_999_999_999n,
    });
  });
});

describe("formatMinorAmount", () => {
  it("formats minor units exactly, with grouping", () => {
    expect(formatMinorAmount(5_000_000)).toBe("50,000.00");
    expect(formatMinorAmount(5n)).toBe("0.05");
    expect(formatMinorAmount(-150)).toBe("-1.50");
  });
});

describe("summarizeLines", () => {
  it("reports a balanced entry", () => {
    expect(summarizeLines(balanced)).toEqual({
      debitMinor: 5_000_000n,
      creditMinor: 5_000_000n,
      differenceMinor: 0n,
      isBalanced: true,
    });
  });

  it("does not call an all-zero entry balanced", () => {
    expect(summarizeLines([line(0n, 0n), line(0n, 0n)]).isBalanced).toBe(false);
  });
});

describe("postingProblems — what stops an entry from being posted", () => {
  const problems = (
    lines: PostingLine[],
    period: typeof september | null = september,
    entryDate = "2026-09-14",
  ) => postingProblems({ entryDate, lines, period });

  it("accepts a balanced entry in an open period", () => {
    expect(problems(balanced)).toEqual([]);
  });

  it("rejects an unbalanced entry", () => {
    const result = problems([line(5_000_000n, 0n), line(0n, 4_000_000n)]);
    expect(result.join(" ")).toMatch(/does not balance.*10,000\.00/);
  });

  it("rejects a zero-value entry", () => {
    const result = problems([line(0n, 0n), line(0n, 0n)]);
    expect(result).toContain("Line 1 has no amount.");
    expect(result).toContain("The entry total cannot be zero.");
  });

  it("rejects negative amounts", () => {
    expect(problems([line(-100n, 0n), line(0n, -100n)]).join(" ")).toMatch(
      /amounts cannot be negative/,
    );
  });

  it("rejects a line that is both a debit and a credit", () => {
    expect(problems([line(100n, 100n), line(0n, 0n)])).toContain(
      "Line 1 is both a debit and a credit.",
    );
  });

  it("rejects an entry with no lines, or only one line", () => {
    expect(problems([])).toContain(
      "A journal entry needs lines before it can be posted.",
    );
    expect(problems([line(100n, 0n)])).toContain(
      "A journal entry needs at least two lines.",
    );
  });

  it("rejects posting to an inactive account or a heading", () => {
    expect(
      problems([
        line(100n, 0n, { account: account({ isActive: false }) }),
        line(0n, 100n),
      ]),
    ).toContain("Line 1: account 1110 is inactive.");
    expect(
      problems([
        line(100n, 0n),
        line(0n, 100n, { account: account({ code: "1000", isPostable: false }) }),
      ]),
    ).toContain("Line 2: account 1000 is a heading and cannot take postings.");
  });

  it("rejects an inactive cost centre", () => {
    expect(
      problems([
        line(100n, 0n, { costCentre: { code: "CC1", isActive: false } }),
        line(0n, 100n),
      ]),
    ).toContain("Line 1: cost centre CC1 is inactive.");
  });

  it("rejects a closed period", () => {
    expect(problems(balanced, { ...september, status: "CLOSED" })).toContain(
      "The accounting period September 2026 is closed.",
    );
  });

  it("rejects a date with no period — a future or invalid date", () => {
    expect(problems(balanced, null, "2031-01-15").join(" ")).toMatch(
      /no accounting period for 2031-01-15/,
    );
  });

  it("rejects a date outside the period", () => {
    expect(problems(balanced, september, "2026-10-01").join(" ")).toMatch(
      /outside the accounting period/,
    );
  });
});

describe("reversal", () => {
  it("swaps every debit and credit, so the reversal balances and cancels the original", () => {
    const original = [line(5_000_000n, 0n), line(0n, 3_000_000n), line(0n, 2_000_000n)];
    const reversal = reversedLines(original);
    expect(reversal.map((entry) => [entry.debitMinor, entry.creditMinor])).toEqual([
      [0n, 5_000_000n],
      [3_000_000n, 0n],
      [2_000_000n, 0n],
    ]);
    expect(summarizeLines(reversal).isBalanced).toBe(true);
    const net = summarizeLines([...original, ...reversal]);
    expect(net.debitMinor - net.creditMinor).toBe(0n);
  });
});

describe("journal numbers and dates", () => {
  it("formats gap-free yearly numbers", () => {
    expect(formatJournalNumber(2026, 1)).toBe("JE-2026-000001");
    expect(formatJournalNumber(2026, 123456)).toBe("JE-2026-123456");
  });

  it("recognises real calendar dates only", () => {
    expect(isIsoDate("2026-09-14")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("14/09/2026")).toBe(false);
  });
});

describe("journalDraftSchema — server-side validation of a draft", () => {
  const accountId = "3f0c9a0e-8a57-4d8f-9e0b-6f4a2f6f9c11";
  const otherId = "8b1a2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
  const valid = {
    entryDate: "2026-09-14",
    description: "Office equipment purchase",
    lines: [
      { accountId, debit: "50,000" },
      { accountId: otherId, credit: "50000.00" },
    ],
  };

  it("accepts a valid draft and converts amounts to minor units", () => {
    const parsed = journalDraftSchema.parse(valid);
    expect(parsed.lines.map((entry) => [entry.debit, entry.credit])).toEqual([
      [5_000_000n, 0n],
      [0n, 5_000_000n],
    ]);
  });

  it("rejects a draft with only one line", () => {
    expect(
      journalDraftSchema.safeParse({ ...valid, lines: [valid.lines[0]] }).success,
    ).toBe(false);
  });

  it("rejects negative amounts, both sides on one line, and a line with no amount", () => {
    for (const bad of [
      { accountId, debit: "-5" },
      { accountId, debit: "5", credit: "5" },
      { accountId },
    ]) {
      expect(
        journalDraftSchema.safeParse({ ...valid, lines: [bad, valid.lines[1]] }).success,
      ).toBe(false);
    }
  });

  it("rejects a line without a real account id and an invalid date", () => {
    expect(
      journalDraftSchema.safeParse({
        ...valid,
        lines: [{ accountId: "cash", debit: "1" }, valid.lines[1]],
      }).success,
    ).toBe(false);
    expect(
      journalDraftSchema.safeParse({ ...valid, entryDate: "2026-13-01" }).success,
    ).toBe(false);
  });

  it("rejects a period that ends before it starts", () => {
    expect(
      periodCreateSchema.safeParse({
        name: "Bad",
        startDate: "2026-09-30",
        endDate: "2026-09-01",
      }).success,
    ).toBe(false);
  });

  it("rejects an account code with spaces", () => {
    expect(
      accountCreateSchema.safeParse({ code: "11 10", name: "Cash", type: "ASSET" })
        .success,
    ).toBe(false);
  });
});

describe("ERP permissions and roles", () => {
  it("gives every finance control its own action, matching its key", () => {
    const actions = Object.fromEntries(
      ERP_PERMISSION_DEFINITIONS.map((definition) => [definition.key, definition.action]),
    );
    expect(actions[ERP_PERMISSIONS.JOURNAL_POST]).toBe("POST");
    expect(actions[ERP_PERMISSIONS.JOURNAL_REVERSE]).toBe("REVERSE");
    expect(actions[ERP_PERMISSIONS.PERIOD_CLOSE]).toBe("CLOSE");
    expect(actions[ERP_PERMISSIONS.PERIOD_REOPEN]).toBe("REOPEN");
  });

  it("keeps period controls and account deactivation away from accountants", () => {
    for (const control of [
      ERP_PERMISSIONS.PERIOD_CREATE,
      ERP_PERMISSIONS.PERIOD_CLOSE,
      ERP_PERMISSIONS.PERIOD_REOPEN,
      ERP_PERMISSIONS.ACCOUNT_ADMINISTER,
    ]) {
      expect(ERP_ACCOUNTANT_PERMISSIONS).not.toContain(control);
      expect(ERP_FINANCE_ADMIN_PERMISSIONS).toContain(control);
    }
  });

  it("seeds a chart whose parents come before their children and share their type", () => {
    const seen = new Map<string, (typeof DEFAULT_CHART)[number]>();
    for (const entry of DEFAULT_CHART) {
      if (entry.parentCode !== null) {
        const parent = seen.get(entry.parentCode);
        expect(parent, `${entry.code} parent`).toBeDefined();
        expect(parent?.type).toBe(entry.type);
        expect(parent?.isPostable).toBe(false);
      }
      seen.set(entry.code, entry);
    }
  });
});
