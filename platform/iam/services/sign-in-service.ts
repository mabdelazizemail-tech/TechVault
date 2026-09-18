import { prisma } from "@/lib/prisma";
import { internalSignInAddress } from "@/platform/iam/usernames";

/**
 * Turns what a person typed at sign-in into the address Supabase Auth knows them by
 * (ADR-035). An email address is used as typed; anything else is a username.
 *
 * An unknown username still yields an address — the internal one it would have — so
 * Supabase refuses it exactly as it refuses a wrong password. The sign-in page can
 * therefore never reveal which usernames exist (§11.6).
 */
export async function resolveSignInEmail(identifier: string): Promise<string> {
  const value = identifier.trim().toLowerCase();
  if (value.includes("@")) return value;

  const user = await prisma.user.findFirst({
    where: { username: value, deletedAt: null },
    select: { email: true },
  });
  return user?.email ?? internalSignInAddress(value);
}
