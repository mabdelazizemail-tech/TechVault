/**
 * The accounting rules of the journal, as pure functions (CLAUDE.md §20: money maths
 * and double entry are unit-tested without a database).
 *
 * All arithmetic is on `bigint` minor units. An amount typed by a person is parsed
 * from its text, digit by digit — never through a float, where "0.1 + 0.2" is a
 * ledger that does not balance.
 *
 * The same rules are enforced again by the database (triggers and CHECKs in the ERP
 * migration); these give people precise, early messages.
 */

/** Integer digits allowed in one amount: up to 99,999,999,999.99. With at most 500
 * lines an entry's total stays far inside JavaScript's safe-integer range. */
const MAX_INTEGER_DIGITS = 11;

export const MAX_JOURNAL_LINES = 500;

export type AmountParse = { ok: true; minor: bigint } | { ok: false; message: string };

const ARABIC_INDIC_DIGITS = /[\u0660-\u0669]/g;
const EXTENDED_ARABIC_DIGITS = /[\u06F0-\u06F9]/g;

/**
 * "50,000.00" → 5000000n. Blank is zero. Accepts Arabic-Indic digits and the Arabic
 * decimal separator, so an amount can be typed on an Arabic keyboard.
 */
export function parseAmountText(raw: string): AmountParse {
  const text = raw
    .replace(ARABIC_INDIC_DIGITS, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(EXTENDED_ARABIC_DIGITS, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/\u066B/g, ".")
    .replace(/[\s,\u066C\u00A0]/g, "");

  if (text === "") return { ok: true, minor: 0n };
  if (text.startsWith("-")) return { ok: false, message: "Amounts cannot be negative." };

  const match = /^(\d+)(?:\.(\d*))?$/.exec(text);
  if (match === null) {
    return { ok: false, message: "Enter an amount such as 1250.50." };
  }
  const fraction = match[2] ?? "";
  if (fraction.length > 2) {
    return { ok: false, message: "Use at most two decimal places." };
  }
  const whole = (match[1] ?? "0").replace(/^0+(?=\d)/, "");
  if (whole.length > MAX_INTEGER_DIGITS) {
    return { ok: false, message: "This amount is too large." };
  }
  return { ok: true, minor: BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0")) };
}

/** 5000000 → "50,000.00". Display only, and exact: no float is involved. */
export function formatMinorAmount(minor: bigint | number): string {
  const value = typeof minor === "bigint" ? minor : BigInt(minor);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = (absolute / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = (absolute % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

export type AmountLine = { debitMinor: bigint; creditMinor: bigint };

export type BalanceSummary = {
  debitMinor: bigint;
  creditMinor: bigint;
  /** Debits minus credits. Zero when balanced. */
  differenceMinor: bigint;
  /** Debits equal credits and the total is above zero. */
  isBalanced: boolean;
};

export function summarizeLines(lines: readonly AmountLine[]): BalanceSummary {
  let debitMinor = 0n;
  let creditMinor = 0n;
  for (const line of lines) {
    debitMinor += line.debitMinor;
    creditMinor += line.creditMinor;
  }
  return {
    debitMinor,
    creditMinor,
    differenceMinor: debitMinor - creditMinor,
    isBalanced: debitMinor === creditMinor && debitMinor > 0n,
  };
}

export type PostingLine = AmountLine & {
  /** Null when the account no longer exists. */
  account: { code: string; isActive: boolean; isPostable: boolean } | null;
  costCentre: { code: string; isActive: boolean } | null;
};

export type PostingPeriod = {
  name: string;
  status: "OPEN" | "CLOSED";
  startDate: string;
  endDate: string;
} | null;

/**
 * Everything that stops an entry from being posted, as messages a person can act
 * on. An empty list means it may be posted.
 */
export function postingProblems(input: {
  entryDate: string;
  lines: readonly PostingLine[];
  period: PostingPeriod;
}): string[] {
  const problems: string[] = [];
  const { lines, period, entryDate } = input;

  if (lines.length === 0) {
    problems.push("A journal entry needs lines before it can be posted.");
  } else if (lines.length < 2) {
    problems.push("A journal entry needs at least two lines.");
  }
  if (lines.length > MAX_JOURNAL_LINES) {
    problems.push(`A journal entry can have at most ${MAX_JOURNAL_LINES} lines.`);
  }

  lines.forEach((line, index) => {
    const label = `Line ${index + 1}`;
    if (line.debitMinor < 0n || line.creditMinor < 0n) {
      problems.push(`${label}: amounts cannot be negative.`);
    } else if (line.debitMinor > 0n && line.creditMinor > 0n) {
      problems.push(`${label} is both a debit and a credit.`);
    } else if (line.debitMinor === 0n && line.creditMinor === 0n) {
      problems.push(`${label} has no amount.`);
    }
    if (line.account === null) {
      problems.push(`${label}: the account no longer exists.`);
    } else if (!line.account.isActive) {
      problems.push(`${label}: account ${line.account.code} is inactive.`);
    } else if (!line.account.isPostable) {
      problems.push(
        `${label}: account ${line.account.code} is a heading and cannot take postings.`,
      );
    }
    if (line.costCentre !== null && !line.costCentre.isActive) {
      problems.push(`${label}: cost centre ${line.costCentre.code} is inactive.`);
    }
  });

  if (lines.length > 0) {
    const summary = summarizeLines(lines);
    if (summary.differenceMinor !== 0n) {
      const difference =
        summary.differenceMinor < 0n ? -summary.differenceMinor : summary.differenceMinor;
      problems.push(
        `The entry does not balance: debits and credits differ by ${formatMinorAmount(difference)}.`,
      );
    } else if (summary.debitMinor === 0n) {
      problems.push("The entry total cannot be zero.");
    }
  }

  if (period === null) {
    problems.push(
      `There is no accounting period for ${entryDate}. Create the period before posting.`,
    );
  } else if (period.status !== "OPEN") {
    problems.push(`The accounting period ${period.name} is closed.`);
  } else if (entryDate < period.startDate || entryDate > period.endDate) {
    problems.push(`The entry date is outside the accounting period ${period.name}.`);
  }

  return problems;
}

/** The equal and opposite lines of a reversal: every debit becomes a credit. */
export function reversedLines<T extends AmountLine>(lines: readonly T[]): T[] {
  return lines.map((line) => ({
    ...line,
    debitMinor: line.creditMinor,
    creditMinor: line.debitMinor,
  }));
}

/** JE-2026-000001. */
export function formatJournalNumber(year: number, sequence: number): string {
  return `JE-${year}-${String(sequence).padStart(6, "0")}`;
}

export function yearOfIsoDate(isoDate: string): number {
  return Number(isoDate.slice(0, 4));
}

/** True for a real calendar date written "YYYY-MM-DD" (2026-02-30 is not). */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
