/**
 * Date presentation for Committees, in the platform's fixed display zone
 * (CLAUDE.md §29 #13). Pure, so services can write the same text into
 * notifications that pages show.
 */

const ZONE = "Africa/Cairo";

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
});

const dateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const calendarDateFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** A moment, as a date in Cairo: "3 Oct 2026". */
export function formatDate(date: Date): string {
  return dateFormat.format(date);
}

/** A meeting's time: "Sat, 3 Oct 2026, 14:00". */
export function formatDateTime(date: Date): string {
  return dateTimeFormat.format(date);
}

/** A calendar date "YYYY-MM-DD", which has no zone: "Sat, 10 Oct 2026". */
export function formatCalendarDate(isoDate: string): string {
  return calendarDateFormat.format(new Date(`${isoDate}T00:00:00.000Z`));
}

export function formatRelative(date: Date, now: Date = new Date()): string {
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d ago`;
  return formatDate(date);
}
