import type { PurchaseTimeline } from "../contracts/types";

/** Zod issues as one message per field, keyed by the dotted path. */
export function issuesToErrors(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join(".");
    errors[key] ??= issue.message;
  }
  return errors;
}

/**
 * Server field errors reduced to the first message per field. With `prefix`, a
 * nested key such as "opportunity.amount" becomes the form's own "amount".
 */
export function firstFieldErrors(
  fieldErrors: Record<string, string[]> | undefined,
  prefix?: string,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const [key, messages] of Object.entries(fieldErrors ?? {})) {
    const short =
      prefix !== undefined && key.startsWith(`${prefix}.`)
        ? key.slice(prefix.length + 1)
        : key;
    const message = messages[0];
    if (message !== undefined) errors[short] ??= message;
  }
  return errors;
}

/** A default expected close date, in months, from what the lead said about timing. */
export const TIMELINE_MONTHS: Partial<Record<PurchaseTimeline, number>> = {
  IMMEDIATE: 1,
  WITHIN_3_MONTHS: 3,
  WITHIN_6_MONTHS: 6,
  WITHIN_12_MONTHS: 12,
  OVER_12_MONTHS: 18,
};
