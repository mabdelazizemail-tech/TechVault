import type { AccountType } from "../contracts/types";

/**
 * Ledger reports (ADR-026): the trial balance, profit and loss, and balance sheet as
 * pure functions of per-account posted totals. The service sums posted journal lines
 * in SQL; everything here is arithmetic on those sums in bigint minor units, so the
 * rules are unit-testable and no float ever touches a figure.
 */

/** Posted totals for one account: before the report's start date, and within its dates. */
export type LedgerBalance = {
  accountId: string;
  code: string;
  name: string;
  nameAr: string | null;
  type: AccountType;
  openingDebitMinor: bigint;
  openingCreditMinor: bigint;
  debitMinor: bigint;
  creditMinor: bigint;
};

/**
 * An amount in the sign a statement reads it: assets and expenses debit-positive,
 * liabilities, equity and revenue credit-positive. A contra account (accumulated
 * depreciation, sales discounts) therefore shows negative and reduces its section.
 */
export function signedForType(
  type: AccountType,
  debitMinor: bigint,
  creditMinor: bigint,
): bigint {
  return type === "ASSET" || type === "EXPENSE"
    ? debitMinor - creditMinor
    : creditMinor - debitMinor;
}

function byCode(a: { code: string }, b: { code: string }): number {
  if (a.code === b.code) return 0;
  return a.code < b.code ? -1 : 1;
}

export type TrialBalanceLine = {
  balance: LedgerBalance;
  /** Balance before the start date; positive is a debit balance. */
  openingMinor: bigint;
  closingDebitMinor: bigint;
  closingCreditMinor: bigint;
};

export type TrialBalanceResult = {
  lines: TrialBalanceLine[];
  totals: {
    openingDebitMinor: bigint;
    openingCreditMinor: bigint;
    debitMinor: bigint;
    creditMinor: bigint;
    closingDebitMinor: bigint;
    closingCreditMinor: bigint;
  };
  /** False only if the ledger itself is out of balance — which the database forbids. */
  isBalanced: boolean;
};

/** Every account with a balance or movement, its closing balance on its own side. */
export function buildTrialBalance(
  balances: readonly LedgerBalance[],
): TrialBalanceResult {
  const totals = {
    openingDebitMinor: 0n,
    openingCreditMinor: 0n,
    debitMinor: 0n,
    creditMinor: 0n,
    closingDebitMinor: 0n,
    closingCreditMinor: 0n,
  };
  const lines: TrialBalanceLine[] = [];

  for (const balance of [...balances].sort(byCode)) {
    const openingMinor = balance.openingDebitMinor - balance.openingCreditMinor;
    if (openingMinor === 0n && balance.debitMinor === 0n && balance.creditMinor === 0n) {
      continue;
    }
    const closing = openingMinor + balance.debitMinor - balance.creditMinor;
    const line: TrialBalanceLine = {
      balance,
      openingMinor,
      closingDebitMinor: closing > 0n ? closing : 0n,
      closingCreditMinor: closing < 0n ? -closing : 0n,
    };
    lines.push(line);

    if (openingMinor > 0n) totals.openingDebitMinor += openingMinor;
    else totals.openingCreditMinor -= openingMinor;
    totals.debitMinor += balance.debitMinor;
    totals.creditMinor += balance.creditMinor;
    totals.closingDebitMinor += line.closingDebitMinor;
    totals.closingCreditMinor += line.closingCreditMinor;
  }

  return {
    lines,
    totals,
    isBalanced:
      totals.openingDebitMinor === totals.openingCreditMinor &&
      totals.debitMinor === totals.creditMinor &&
      totals.closingDebitMinor === totals.closingCreditMinor,
  };
}

export type StatementSectionResult = {
  type: AccountType;
  lines: { balance: LedgerBalance; amountMinor: bigint }[];
  totalMinor: bigint;
};

function section(
  balances: readonly LedgerBalance[],
  type: AccountType,
  basis: "movement" | "cumulative",
): StatementSectionResult {
  const lines = balances
    .filter((balance) => balance.type === type)
    .map((balance) => ({
      balance,
      amountMinor:
        basis === "movement"
          ? signedForType(type, balance.debitMinor, balance.creditMinor)
          : signedForType(
              type,
              balance.openingDebitMinor + balance.debitMinor,
              balance.openingCreditMinor + balance.creditMinor,
            ),
    }))
    .filter((line) => line.amountMinor !== 0n)
    .sort((a, b) => byCode(a.balance, b.balance));
  return {
    type,
    lines,
    totalMinor: lines.reduce((sum, line) => sum + line.amountMinor, 0n),
  };
}

/** Revenue less expenses posted within the report's dates. */
export function buildProfitAndLoss(balances: readonly LedgerBalance[]): {
  revenue: StatementSectionResult;
  expenses: StatementSectionResult;
  netIncomeMinor: bigint;
} {
  const revenue = section(balances, "REVENUE", "movement");
  const expenses = section(balances, "EXPENSE", "movement");
  return { revenue, expenses, netIncomeMinor: revenue.totalMinor - expenses.totalMinor };
}

/**
 * Balances at a date. There is no year-end close yet (§29), so revenue and expenses are
 * never moved into equity; their cumulative difference is shown as its own line, which
 * is what keeps assets equal to liabilities plus equity.
 */
export function buildBalanceSheet(balances: readonly LedgerBalance[]): {
  assets: StatementSectionResult;
  liabilities: StatementSectionResult;
  equity: StatementSectionResult;
  unclosedProfitMinor: bigint;
  liabilitiesAndEquityMinor: bigint;
  isBalanced: boolean;
} {
  const assets = section(balances, "ASSET", "cumulative");
  const liabilities = section(balances, "LIABILITY", "cumulative");
  const equity = section(balances, "EQUITY", "cumulative");
  const unclosedProfitMinor =
    section(balances, "REVENUE", "cumulative").totalMinor -
    section(balances, "EXPENSE", "cumulative").totalMinor;
  const liabilitiesAndEquityMinor =
    liabilities.totalMinor + equity.totalMinor + unclosedProfitMinor;
  return {
    assets,
    liabilities,
    equity,
    unclosedProfitMinor,
    liabilitiesAndEquityMinor,
    isBalanced: assets.totalMinor === liabilitiesAndEquityMinor,
  };
}
