/**
 * Calendar dates for Committees, as "YYYY-MM-DD" strings. Pure.
 *
 * A due date is a calendar date, stored in a `date` column (which Prisma reads as
 * UTC midnight). "Today" is today where the business operates (CLAUDE.md §29 #13),
 * so a task due today is not overdue until the day ends in Cairo.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written as YYYY-MM-DD ("2026-02-30" is not). */
export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (match === null) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function todayInCairo(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** A `date` column value as YYYY-MM-DD. */
export function isoDateOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** YYYY-MM-DD as the Date Prisma writes to a `date` column. */
export function dateFromIso(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}
