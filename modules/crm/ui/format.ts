import type { CrmCurrency, MoneyTotal } from "../contracts/types";

/**
 * Display formatting for CRM screens. Pure and client-safe.
 *
 * Money is formatted per currency and NEVER combined: a list of totals renders as
 * "EGP 10,000,000 · $35,000", not as one number.
 */

/**
 * Time zone for timestamps until users carry their own preference. The team this
 * CRM serves works in Egypt; calendar dates (close dates) are shown in UTC because
 * they are stored as dates, not moments.
 */
export const DISPLAY_TIME_ZONE = "Africa/Cairo";

const moneyFormatters = new Map<string, Intl.NumberFormat>();

function moneyFormatter(currency: CrmCurrency, compact: boolean, fractional: boolean) {
  const key = `${currency}:${compact}:${fractional}`;
  let formatter = moneyFormatters.get(key);
  if (formatter === undefined) {
    formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      // "$35,000" reads naturally; "E£" does not, so Egyptian pounds show the code.
      currencyDisplay: currency === "USD" ? "narrowSymbol" : "code",
      notation: compact ? "compact" : "standard",
      minimumFractionDigits: compact || !fractional ? 0 : 2,
      maximumFractionDigits: compact ? 1 : 2,
    });
    moneyFormatters.set(key, formatter);
  }
  return formatter;
}

export function formatMoney(
  amountMinor: number,
  currency: CrmCurrency,
  options: { compact?: boolean } = {},
): string {
  const major = amountMinor / 100;
  return moneyFormatter(
    currency,
    options.compact === true,
    !Number.isInteger(major),
  ).format(major);
}

/** Per-currency totals joined for display; `empty` when there are none. */
export function formatTotals(
  totals: readonly MoneyTotal[],
  options: { compact?: boolean; empty?: string } = {},
): string {
  if (totals.length === 0) return options.empty ?? "—";
  return totals
    .map((total) =>
      formatMoney(total.amountMinor, total.currency, { compact: options.compact }),
    )
    .join(" · ");
}

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const shortDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: DISPLAY_TIME_ZONE,
});

/** A calendar date, e.g. "Oct 30, 2026". */
export function formatDate(date: Date): string {
  return dateFormatter.format(date);
}

/** A calendar date without the year, e.g. "Oct 30". */
export function formatShortDate(date: Date): string {
  return shortDateFormatter.format(date);
}

/** A moment, e.g. "Sep 13, 2026, 3:00 PM". */
export function formatDateTime(date: Date): string {
  return dateTimeFormatter.format(date);
}

/** Whether a moment has already passed — e.g. a task's due date. */
export function isPast(date: Date, now: Date = new Date()): boolean {
  return date.getTime() < now.getTime();
}

const relativeFormatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "2 days ago", "in 3 days", "yesterday". */
export function formatRelative(date: Date, now: Date = new Date()): string {
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 365 * 24 * 3600],
    ["month", 30 * 24 * 3600],
    ["week", 7 * 24 * 3600],
    ["day", 24 * 3600],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size)
      return relativeFormatter.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

export function initials(name: string): string {
  const parts = name
    .trim()
    .split(/[\s@.]+/)
    .filter(Boolean);
  const first = parts[0]?.charAt(0) ?? "?";
  const second = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? "") : "";
  return `${first}${second}`.toUpperCase();
}

/** "YYYY-MM-DD" for an `<input type="date">`, in UTC. */
export function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Today plus `months`, as a date-input value. */
export function monthsFromToday(months: number, now: Date = new Date()): string {
  const date = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months, now.getUTCDate()),
  );
  return toDateInputValue(date);
}

/** Minor units to a major-unit string for an amount input, e.g. 4500000 → "45000". */
export function toMajorInput(amountMinor: number | null): string {
  if (amountMinor === null) return "";
  const major = amountMinor / 100;
  return Number.isInteger(major) ? String(major) : major.toFixed(2);
}

function counted(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The confirmation sentence for what a deletion takes with it. */
export function describeAlsoDeleted(impact: {
  contacts: number;
  opportunities: number;
  activities: number;
}): string {
  const parts = [
    impact.contacts > 0 ? counted(impact.contacts, "contact", "contacts") : null,
    impact.opportunities > 0
      ? counted(impact.opportunities, "opportunity", "opportunities")
      : null,
    impact.activities > 0 ? counted(impact.activities, "activity", "activities") : null,
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) return "Nothing else is deleted with it.";
  const list =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `This also deletes ${list}.`;
}
