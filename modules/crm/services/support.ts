import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { type Actor, can, scopeFilter } from "@/platform/authz/authz";
import { scopeWhere, type WhereFragment } from "@/platform/authz/prisma-filter";
import type { ScopeTarget } from "@/platform/authz/types";

/**
 * Shared plumbing for CRM services. Module-private.
 */

export const CRM_MODULE = "crm";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** Parses input with a contract schema, throwing a field-level `ValidationError`. */
export function parseInput<TSchema extends z.ZodType>(
  schema: TSchema,
  input: unknown,
  message = "Please correct the highlighted fields.",
): z.output<TSchema> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new ValidationError(message, fieldErrorsOf(parsed.error));
  return parsed.data;
}

export function fieldErrorsOf(error: z.ZodError): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    (fields[key] ??= []).push(issue.message);
  }
  return fields;
}

/** The request context every audit record carries. */
export function auditFields(actor: Actor) {
  return {
    actorId: actor.id,
    ipAddress: actor.ipAddress ?? null,
    userAgent: actor.userAgent ?? null,
    correlationId: actor.correlationId ?? null,
  };
}

/**
 * Row-level narrowing for owner-scoped CRM records (CLAUDE.md §11.5): an
 * OWN-scoped grant sees its own records, an ORG_UNIT grant sees records owned by
 * people in that subtree. Fails closed for anything else.
 */
export async function ownerScope(
  actor: Actor,
  permission: string,
): Promise<WhereFragment> {
  const filter = await scopeFilter(actor, permission);
  return scopeWhere(filter, {
    owner: ["ownerId"],
    orgUnitPath: ["owner", "orgUnit", "path"],
  });
}

/**
 * Asserts the actor may see a record. A record they may not see is reported as
 * not found, so the error does not confirm it exists (CLAUDE.md §11.6).
 */
export async function assertCanRead(
  actor: Actor,
  permission: string,
  target: ScopeTarget,
  entity: string,
): Promise<void> {
  if (!(await can(actor, permission, target))) throw new NotFoundError(entity);
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Splits a search query into terms that must ALL match somewhere, so "john acme"
 * finds John Smith at Acme Corporation.
 */
export function searchTerms(query: string | undefined): string[] {
  if (query === undefined) return [];
  return query
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 0)
    .slice(0, 5);
}

export const insensitive = (value: string) =>
  ({ contains: value, mode: "insensitive" }) as const;

export const equalsInsensitive = (value: string) =>
  ({ equals: value, mode: "insensitive" }) as const;
