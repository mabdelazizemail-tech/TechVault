import { notFound } from "next/navigation";
import { ForbiddenError, NotFoundError } from "@/lib/errors";

/**
 * Resolves a CRM read for a page, turning "not found" and "not permitted" into
 * the 404 page — which already says "does not exist, or you do not have access",
 * so it never confirms a record exists to someone who may not see it (§11.6).
 */
export async function orNotFound<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError) notFound();
    throw error;
  }
}

/** The first value of a search param that may be repeated. */
export function param(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** A search param narrowed to a known vocabulary, or undefined. */
export function oneOf<T extends string>(
  values: readonly T[],
  value: string | undefined,
): T | undefined {
  return value !== undefined && (values as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A search param that must be a record id; anything else is ignored, not queried. */
export function uuidParam(value: string | undefined): string | undefined {
  return value !== undefined && UUID_PATTERN.test(value) ? value : undefined;
}

/** Search params flattened to single values, for list services and URL state. */
export function flatParams(
  params: Record<string, string | string[] | undefined>,
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, param(value)]),
  );
}
