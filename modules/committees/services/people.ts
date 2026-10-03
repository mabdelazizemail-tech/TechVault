import { ValidationError } from "@/lib/errors";
import { type Actor, can, requirePermission } from "@/platform/authz/authz";
import {
  type DirectoryEntry,
  findDirectoryPeople,
  searchDirectory,
} from "@/platform/iam/services/directory-service";
import { COMMITTEES_PERMISSIONS } from "../contracts/permissions";

/** Colleagues matching a typed query, for the member and responsible-person pickers. */
export async function searchPeople(
  actor: Actor,
  query: string,
): Promise<DirectoryEntry[]> {
  await requirePermission(actor, COMMITTEES_PERMISSIONS.MEETING_READ);
  return searchDirectory(actor, query.slice(0, 100));
}

/**
 * Checks that registered people chosen as committee members or as responsible for
 * a task exist, are active, and can open Committees. Someone who cannot would
 * receive notifications whose links lead nowhere, so they are refused with the
 * fix spelled out: grant them the role, or (for tasks) type their name instead.
 *
 * `keep` lists people already on the record: they stay even if they have since
 * lost access, so an unrelated edit never fails because of them.
 *
 * Returns each person's display name, read through IAM's directory (§5).
 */
export async function assertPeopleCanTakePart(
  actor: Actor,
  userIds: readonly string[],
  options: { field: string; allowTypedName: boolean; keep?: readonly string[] },
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (userIds.length === 0) return names;

  const people = await findDirectoryPeople(actor, userIds);
  const keep = new Set(options.keep ?? []);
  const problems: string[] = [];

  for (const id of new Set(userIds)) {
    const person = people.find((candidate) => candidate.id === id);
    if (person === undefined) {
      problems.push("Choose people from the list.");
      continue;
    }
    names.set(id, person.name);
    if (keep.has(id)) continue;
    if (!person.isActive) {
      problems.push(`${person.name}'s account is not active.`);
      continue;
    }
    if (!(await can({ id }, COMMITTEES_PERMISSIONS.MEETING_READ))) {
      problems.push(
        options.allowTypedName
          ? `${person.name} can't open Committees yet. Ask an administrator to give them the Committees role, or type their name instead.`
          : `${person.name} can't open Committees yet. Give them the Committees role first.`,
      );
    }
  }

  if (problems.length > 0) {
    throw new ValidationError(problems[0], { [options.field]: problems });
  }
  return names;
}

/** The actor's own display name, for notifications they cause. */
export async function displayNameOf(actor: Actor): Promise<string> {
  const [me] = await findDirectoryPeople(actor, [actor.id]);
  return me?.name ?? "Someone";
}
