/**
 * Money handling (CLAUDE.md ADR-006).
 *
 * Amounts are integers in the smallest currency unit — piastres for EGP, cents
 * for USD. Floating point is never used for money: `0.1 + 0.2 !== 0.3` is a
 * rounding error in a ledger, and ledgers must balance exactly.
 *
 * Name variables holding these values `...Minor` so the unit is visible at every
 * call site.
 */

export type CurrencyCode = "EGP" | "USD" | "EUR" | "SAR" | "AED";

/** Minor units per major unit, per currency. */
const MINOR_UNITS: Record<CurrencyCode, number> = {
  EGP: 100,
  USD: 100,
  EUR: 100,
  SAR: 100,
  AED: 100,
};

export const DEFAULT_CURRENCY: CurrencyCode = "EGP";

export class MoneyError extends Error {}

/** Converts a major-unit amount (e.g. 1234.56) to minor units (123456). */
export function toMinorUnits(
  major: number,
  currency: CurrencyCode = DEFAULT_CURRENCY,
): number {
  if (!Number.isFinite(major)) {
    throw new MoneyError(`Amount is not a finite number: ${String(major)}`);
  }
  const factor = MINOR_UNITS[currency];
  // Round rather than truncate, and do it once, at the boundary.
  const minor = Math.round(major * factor);
  if (!Number.isSafeInteger(minor)) {
    throw new MoneyError("Amount is too large to represent exactly.");
  }
  return minor;
}

/** Converts minor units back to a major-unit number. Display only — never for arithmetic. */
export function toMajorUnits(
  minor: number,
  currency: CurrencyCode = DEFAULT_CURRENCY,
): number {
  assertMinor(minor);
  return minor / MINOR_UNITS[currency];
}

function assertMinor(minor: number): void {
  if (!Number.isInteger(minor)) {
    throw new MoneyError(
      `Minor-unit amounts must be integers, received ${String(minor)}. ` +
        `A fractional value here means a float leaked into money arithmetic.`,
    );
  }
}

/** Sums minor-unit amounts. Safe because every operand is an integer. */
export function sumMinor(amounts: readonly number[]): number {
  let total = 0;
  for (const amount of amounts) {
    assertMinor(amount);
    total += amount;
  }
  if (!Number.isSafeInteger(total)) {
    throw new MoneyError("Sum exceeds the safe integer range.");
  }
  return total;
}

/**
 * Applies a rate (tax, discount, share) to a minor-unit amount.
 *
 * Rounds half away from zero so that a credit and the debit it reverses round
 * identically — banker's rounding would make a reversal fail to cancel out.
 */
export function applyRate(minor: number, rate: number): number {
  assertMinor(minor);
  if (!Number.isFinite(rate)) {
    throw new MoneyError(`Rate is not a finite number: ${String(rate)}`);
  }
  const raw = minor * rate;
  return raw < 0 ? -Math.round(-raw) : Math.round(raw);
}

/**
 * Splits an amount into `parts` shares that sum exactly back to the original.
 *
 * The remainder is distributed one minor unit at a time across the leading
 * shares, so nothing is created or lost by rounding.
 */
export function allocate(minor: number, parts: number): number[] {
  assertMinor(minor);
  if (!Number.isInteger(parts) || parts <= 0) {
    throw new MoneyError(`Cannot allocate into ${String(parts)} parts.`);
  }
  const sign = minor < 0 ? -1 : 1;
  const absolute = Math.abs(minor);
  const base = Math.floor(absolute / parts);
  let remainder = absolute - base * parts;

  return Array.from({ length: parts }, () => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return sign * (base + extra);
  });
}

/** Formats a minor-unit amount for display in the given locale. */
export function formatMoney(
  minor: number,
  currency: CurrencyCode = DEFAULT_CURRENCY,
  locale = "en-EG",
): string {
  assertMinor(minor);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(toMajorUnits(minor, currency));
}
