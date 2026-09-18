import { z } from "zod";

/**
 * Usernames and the sign-in address behind them (ADR-035).
 *
 * Supabase Auth signs people in by email address. Someone without a mailbox gets an
 * internal address built from their username under a domain reserved for private
 * use (`.internal`), which no mail server delivers to; accounts are created by an
 * administrator with a password, so Supabase never tries to mail it either.
 */

/** Reserved for private use by ICANN, so it can never belong to a real mailbox. */
export const SIGN_IN_DOMAIN = "users.techvault.internal";

export const USERNAME_RULE =
  "3 to 32 characters: letters, numbers, dot, hyphen or underscore, starting with a letter or number.";

/** The form rule the database repeats as `users_username_format`. */
export const usernameField = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9._-]{2,31}$/, `Use ${USERNAME_RULE}`);

/** The sign-in address for a username with no mailbox of its own. */
export function internalSignInAddress(username: string): string {
  return `${username.trim().toLowerCase()}@${SIGN_IN_DOMAIN}`;
}

/** Whether an address can receive mail — false for an internal sign-in address. */
export function hasMailbox(email: string): boolean {
  return !email.toLowerCase().endsWith(`@${SIGN_IN_DOMAIN}`);
}

/** The address to show a person: their email if it is real, otherwise nothing. */
export function visibleEmail(email: string): string | null {
  return hasMailbox(email) ? email : null;
}
