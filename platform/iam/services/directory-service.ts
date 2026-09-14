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
const SEARCH_LIMIT = 20;

/**
 * Colleagues matching a typed query, by name or email, for pickers that must not
 * load the whole directory into the browser. Every word must match somewhere, so
 * "sara ahmed" finds Sara Ahmed. Inactive and deleted accounts never match.
 *
 * No index backs the ILIKE: the users table holds one organisation's staff, and a
 * sequential scan of it costs less than maintaining a trigram index. Revisit if
 * the directory grows past tens of thousands of accounts.
 */
export async function searchDirectory(
  actor: Actor,
  query: string,
  options: { excludeUserId?: string; limit?: number } = {},
): Promise<DirectoryEntry[]> {
  if ((await getPermissionSet(actor.id)) === null) throw new UnauthenticatedError();

  const terms = query
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 0)
    .slice(0, 5);
  if (terms.length === 0) return [];

  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      deletedAt: null,
      ...(options.excludeUserId !== undefined
        ? { id: { not: options.excludeUserId } }
        : {}),
      AND: terms.map((term) => ({
        OR: [
          { fullName: { contains: term, mode: "insensitive" as const } },
          { email: { contains: term, mode: "insensitive" as const } },
        ],
      })),
    },
    orderBy: [{ fullName: "asc" }, { email: "asc" }],
    take: Math.min(options.limit ?? SEARCH_LIMIT, SEARCH_LIMIT),
    select: { id: true, fullName: true, email: true },
  });

  return users.map((user) => ({
    id: user.id,
    name: user.fullName ?? user.email,
    email: user.email,
  }));
}

export type DirectoryPerson = DirectoryEntry & { isActive: boolean };

/**
 * The named people, including deactivated and deleted accounts — a conversation
 * with someone who has left must still say who they were.
 */
export async function findDirectoryPeople(
  actor: Actor,
  userIds: readonly string[],
): Promise<DirectoryPerson[]> {
  if ((await getPermissionSet(actor.id)) === null) throw new UnauthenticatedError();
  if (userIds.length === 0) return [];

  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(userIds)] } },
    select: { id: true, fullName: true, email: true, isActive: true, deletedAt: true },
  });

  return users.map((user) => ({
    id: user.id,
    name: user.fullName ?? user.email,
    email: user.email,
    isActive: user.isActive && user.deletedAt === null,
  }));
}

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
