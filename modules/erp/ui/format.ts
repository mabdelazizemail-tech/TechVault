import { formatMinorAmount } from "../domain/journal";

/**
 * Display formatting for ERP finance. Amounts are shown in EGP major units with two
 * decimals, computed exactly from minor units; calendar dates never shift a day
 * because they are formatted as the date they are, in UTC.
 */

export function formatAmount(minor: number): string {
  return formatMinorAmount(minor);
}

/** An amount, or a quiet dash for zero — for debit and credit columns. */
export function formatAmountOrBlank(minor: number): string {
  return minor === 0 ? "" : formatMinorAmount(minor);
}

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** "2026-09-14" → "14 Sep 2026". */
export function formatDate(isoDate: string): string {
  return DATE.format(new Date(`${isoDate}T00:00:00.000Z`));
}

const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Africa/Cairo",
});

export function formatDateTime(value: Date): string {
  return DATE_TIME.format(value);
}

/** Today's date in Cairo, "YYYY-MM-DD" — the default date of a new entry. */
export function todayInCairo(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
