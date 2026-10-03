/**
 * Pure rules for in-app notifications (ADR-036). No I/O, so they are exhaustively
 * unit-testable.
 */

/** The longest title and body the table accepts (CHECKs in the migration). */
export const TITLE_MAX = 200;
export const BODY_MAX = 1000;

/**
 * Who receives a notification: each candidate once, never the person who acted,
 * and nobody without an id. Order is kept, so the result is deterministic.
 */
export function recipientsFor(
  candidates: readonly (string | null | undefined)[],
  actorId: string | null,
): string[] {
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined || candidate === "") continue;
    if (candidate === actorId) continue;
    seen.add(candidate);
  }
  return [...seen];
}

/**
 * Shortens text for a notification or a list, on a word boundary where one is
 * close, collapsing whitespace so a multi-line reply reads as one line.
 */
export function preview(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * True for an application path: one leading slash and not "//host" or "/\host",
 * which browsers read as another site. Notification links are rendered as hrefs,
 * so anything else is refused before it is stored (the database checks it too).
 */
export function isAppPath(link: string): boolean {
  return /^\/([^/\\]|$)/.test(link) && link.length <= 500;
}
