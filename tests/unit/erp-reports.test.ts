import { describe, expect, it } from "vitest";
import { ledgerReportParamsSchema } from "@/modules/erp/contracts/schemas";
import type { AccountType } from "@/modules/erp/contracts/types";
import {
  buildBalanceSheet,
  buildClosingLines,
  buildProfitAndLoss,
  buildTrialBalance,
  signedForType,
  type LedgerBalance,
} from "@/modules/erp/domain/reports";

/** Ledger reports as pure arithmetic on posted totals (ADR-026). */

function balance(
  code: string,
  type: AccountType,
  debitMinor: bigint,
  creditMinor: bigint,
  opening: [bigint, bigint] = [0n, 0n],
): LedgerBalance {
  return {
    accountId: `account-${code}`,
    code,
    name: code,
    nameAr: null,
    type,
    openingDebitMinor: opening[0],
    openingCreditMinor: opening[1],
    debitMinor,
    creditMinor,
  };
}

describe("signedForType", () => {
  it("reads assets and expenses debit-positive, the rest credit-positive", () => {
    expect(signedForType("ASSET", 300n, 100n)).toBe(200n);
    expect(signedForType("EXPENSE", 300n, 100n)).toBe(200n);
    expect(signedForType("LIABILITY", 100n, 300n)).toBe(200n);
    expect(signedForType("EQUITY", 100n, 300n)).toBe(200n);
    expect(signedForType("REVENUE", 100n, 300n)).toBe(200n);
  });
});

describe("trial balance", () => {
  it("puts each closing balance on its own side, in code order, and balances", () => {
    const result = buildTrialBalance([
      balance("3100", "EQUITY", 0n, 10_000n),
      balance("1120", "ASSET", 10_000n, 4_000n),
      balance("5100", "EXPENSE", 4_000n, 0n),
    ]);
    expect(
      result.lines.map((line) => [
        line.balance.code,
        line.closingDebitMinor,
        line.closingCreditMinor,
      ]),
    ).toEqual([
      ["1120", 6_000n, 0n],
      ["3100", 0n, 10_000n],
      ["5100", 4_000n, 0n],
    ]);
    expect(result.totals).toMatchObject({
      debitMinor: 14_000n,
      creditMinor: 14_000n,
      closingDebitMinor: 10_000n,
      closingCreditMinor: 10_000n,
    });
    expect(result.isBalanced).toBe(true);
  });

  it("carries the opening balance into the closing balance and leaves out accounts with neither", () => {
    const result = buildTrialBalance([
      balance("1120", "ASSET", 500n, 0n, [2_000n, 0n]),
      balance("3100", "EQUITY", 0n, 500n, [0n, 2_000n]),
      balance("1110", "ASSET", 0n, 0n, [300n, 300n]),
    ]);
    expect(result.lines.map((line) => line.balance.code)).toEqual(["1120", "3100"]);
    expect(result.lines[0]).toMatchObject({
      openingMinor: 2_000n,
      closingDebitMinor: 2_500n,
    });
    expect(result.lines[1]).toMatchObject({
      openingMinor: -2_000n,
      closingCreditMinor: 2_500n,
    });
    expect(result.totals).toMatchObject({
      openingDebitMinor: 2_000n,
      openingCreditMinor: 2_000n,
    });
    expect(result.isBalanced).toBe(true);
  });

  it("reports an imbalance rather than hiding it", () => {
    expect(buildTrialBalance([balance("1120", "ASSET", 100n, 0n)]).isBalanced).toBe(
      false,
    );
  });
});

describe("profit and loss", () => {
  it("nets revenue against expenses, a contra revenue account reducing revenue", () => {
    const result = buildProfitAndLoss([
      balance("4100", "REVENUE", 0n, 30_000n),
      balance("4900", "REVENUE", 2_000n, 0n),
      balance("5100", "EXPENSE", 12_000n, 0n),
      balance("1120", "ASSET", 30_000n, 12_000n),
    ]);
    expect(
      result.revenue.lines.map((line) => [line.balance.code, line.amountMinor]),
    ).toEqual([
      ["4100", 30_000n],
      ["4900", -2_000n],
    ]);
    expect([
      result.revenue.totalMinor,
      result.expenses.totalMinor,
      result.netIncomeMinor,
    ]).toEqual([28_000n, 12_000n, 16_000n]);
  });

  it("uses the movement within the dates, never the opening balance", () => {
    const result = buildProfitAndLoss([
      balance("4100", "REVENUE", 0n, 1_000n, [0n, 50_000n]),
    ]);
    expect(result.netIncomeMinor).toBe(1_000n);
  });
});

describe("balance sheet", () => {
  it("balances assets against liabilities, equity and the profit not yet closed", () => {
    const result = buildBalanceSheet([
      balance("1120", "ASSET", 130_000n, 12_000n),
      balance("1110", "ASSET", 0n, 50_000n),
      balance("1500", "ASSET", 50_000n, 0n),
      balance("2100", "LIABILITY", 7_000n, 7_000n),
      balance("3100", "EQUITY", 0n, 100_000n),
      balance("4100", "REVENUE", 0n, 30_000n),
      balance("5100", "EXPENSE", 12_000n, 0n),
    ]);
    expect(result.assets.totalMinor).toBe(118_000n);
    expect(result.liabilities.lines).toHaveLength(0);
    expect(result.equity.totalMinor).toBe(100_000n);
    expect(result.unclosedProfitMinor).toBe(18_000n);
    expect(result.liabilitiesAndEquityMinor).toBe(118_000n);
    expect(result.isBalanced).toBe(true);
  });
});

describe("year-end closing lines (ADR-028)", () => {
  it("zeroes revenue and expenses and credits the profit to retained earnings", () => {
    const result = buildClosingLines(
      [
        balance("5100", "EXPENSE", 20_000n, 0n),
        balance("4100", "REVENUE", 0n, 50_000n),
        balance("1120", "ASSET", 50_000n, 20_000n),
      ],
      "account-3200",
    );
    expect(result.lines).toEqual([
      { accountId: "account-4100", debitMinor: 50_000n, creditMinor: 0n },
      { accountId: "account-5100", debitMinor: 0n, creditMinor: 20_000n },
      { accountId: "account-3200", debitMinor: 0n, creditMinor: 30_000n },
    ]);
    expect([result.netIncomeMinor, result.accountCount]).toEqual([30_000n, 2]);
  });

  it("debits a loss to retained earnings and closes only the year's movement", () => {
    const result = buildClosingLines(
      [
        balance("4100", "REVENUE", 0n, 10_000n, [0n, 90_000n]),
        balance("5100", "EXPENSE", 25_000n, 0n),
      ],
      "account-3200",
    );
    expect(result.lines.at(-1)).toEqual({
      accountId: "account-3200",
      debitMinor: 15_000n,
      creditMinor: 0n,
    });
    expect(result.netIncomeMinor).toBe(-15_000n);
  });

  it("writes nothing when revenue and expenses did not move", () => {
    expect(
      buildClosingLines(
        [balance("1120", "ASSET", 5n, 0n), balance("4100", "REVENUE", 7n, 7n)],
        "account-3200",
      ),
    ).toEqual({ lines: [], netIncomeMinor: 0n, accountCount: 0 });
  });

  it("always balances", () => {
    const { lines } = buildClosingLines(
      [
        balance("4100", "REVENUE", 3n, 11n),
        balance("4200", "REVENUE", 0n, 4n),
        balance("5100", "EXPENSE", 9n, 2n),
      ],
      "account-3200",
    );
    const debit = lines.reduce((sum, line) => sum + line.debitMinor, 0n);
    const credit = lines.reduce((sum, line) => sum + line.creditMinor, 0n);
    expect(debit).toBe(credit);
  });
});

describe("report dates", () => {
  it("ignores a malformed date instead of failing the page", () => {
    expect(
      ledgerReportParamsSchema.parse({ from: "not-a-date", to: "2026-09-30" }),
    ).toEqual({
      from: undefined,
      to: "2026-09-30",
    });
  });
});
