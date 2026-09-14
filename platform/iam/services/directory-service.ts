import { UnauthenticatedError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { Actor } from "@/platform/authz/authz";
import { getPermissionSet } from "@/platform/iam/permission-loader";

/**
 * The staff directory: who can be named as the owner or assignee of a record.
 *
 * Deliberately narrow — name and email of active colleagues only — so any signed-in
 * user may read it without holding the administrative `iam.user.read`, which exposes
 * roles, units and activation state. Domain modules call this rather than querying
 * `iam.users` themselves (CLAUDE.md §5).
 */

export type DirectoryEntry = { id: string; name: string; email: string };

const DIRECTORY_LIMIT = 500;

export async function listDirectory(actor: Actor): Promise<DirectoryEntry[]> {
  if ((await getPermissionSet(actor.id)) === null) throw new UnauthenticatedError();

  const users = await prisma.user.findMany({
    where: { isActive: true, deletedAt: null },
    orderBy: [{ fullName: "asc" }, { email: "asc" }],
    take: DIRECTORY_LIMIT,
    select: { id: true, fullName: true, email: true },
  });

  return users.map((user) => ({
    id: user.id,
    name: user.fullName ?? user.email,
    email: user.email,
  }));
}
