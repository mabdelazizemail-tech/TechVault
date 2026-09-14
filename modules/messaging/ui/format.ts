/**
 * Date and time presentation for messaging.
 *
 * One fixed display zone, the same as the CRM, until people carry a time-zone
 * preference (CLAUDE.md §29 #13). A fixed zone also keeps the server-rendered and
 * hydrated text identical.
 */

const ZONE = "Africa/Cairo";

const timeFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: ZONE,
  hour: "2-digit",
  minute: "2-digit",
});
// en-CA formats as YYYY-MM-DD, which doubles as a sortable calendar-day key.
const dayKeyFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const weekdayFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: ZONE,
  weekday: "short",
});
const shortDateFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: ZONE,
  day: "numeric",
  month: "short",
});
const longDateFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

export function formatTime(iso: string): string {
  return timeFormat.format(new Date(iso));
}

export function dayKeyOf(iso: string): string {
  return dayKeyFormat.format(new Date(iso));
}

/** Whole calendar days from `iso` to `now` in the display zone. */
function daysAgo(iso: string, now: Date): number {
  return Math.round(
    (Date.parse(dayKeyOf(now.toISOString())) - Date.parse(dayKeyOf(iso))) / 86_400_000,
  );
}

export function formatDayLabel(iso: string, now: Date = new Date()): string {
  const days = daysAgo(iso, now);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return longDateFormat.format(new Date(iso));
}

/** The time beside a conversation in the list. */
export function formatInboxTime(iso: string, now: Date = new Date()): string {
  const days = daysAgo(iso, now);
  if (days === 0) return formatTime(iso);
  if (days === 1) return "Yesterday";
  if (days < 7) return weekdayFormat.format(new Date(iso));
  return shortDateFormat.format(new Date(iso));
}

/** Messenger-style presence: "Active now", "Active 5m ago", "Offline". */
export function formatActive(
  online: boolean,
  lastSeenIso: string | null,
  now: Date = new Date(),
): string {
  if (online) return "Active now";
  if (lastSeenIso === null) return "Offline";
  const minutes = Math.floor((now.getTime() - Date.parse(lastSeenIso)) / 60_000);
  if (minutes < 1) return "Active just now";
  if (minutes < 60) return `Active ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Active ${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Active ${days}d ago`;
  return "Offline";
}

export function initialsOf(name: string): string {
  const letters = name
    .replace(/@.*$/, "")
    .split(/[\s._-]+/)
    .filter((part) => part.length > 0)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
  return letters === "" ? "?" : letters;
}

/** The later of two optional timestamps. */
export function latest(a: string | null, b: string | null | undefined): string | null {
  if (a === null) return b ?? null;
  if (b === null || b === undefined) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}
