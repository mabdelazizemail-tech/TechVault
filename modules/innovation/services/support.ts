import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { NotFoundError, ValidationError } from "@/lib/errors";
import type { Actor } from "@/platform/authz/authz";
import { excerptOf } from "../domain/search";
import type { FileDto, PersonRef } from "../contracts/types";
import { ruleFor } from "../domain/files";

/**
 * Shared plumbing for THE THINK TANK services. Module-private.
 */

export const INNOVATION_MODULE = "innovation";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** 404 for anything that is not a well-formed id, before any query runs. */
export function assertId(value: string, entity: string): void {
  if (!isUuid(value)) throw new NotFoundError(entity);
}

export function parseInput<TSchema extends z.ZodType>(
  schema: TSchema,
  input: unknown,
  message = "Please correct the highlighted fields.",
): z.output<TSchema> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const fields: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      (fields[issue.path.join(".") || "_"] ??= []).push(issue.message);
    }
    throw new ValidationError(message, fields);
  }
  return parsed.data;
}

export function auditFields(actor: Actor) {
  return {
    actorId: actor.id,
    ipAddress: actor.ipAddress ?? null,
    userAgent: actor.userAgent ?? null,
    correlationId: actor.correlationId ?? null,
  };
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export const personSelect = { id: true, fullName: true, email: true } as const;

export function toPerson(
  user: { id: string; fullName: string | null; email: string } | null,
): PersonRef | null {
  return user === null ? null : { id: user.id, name: user.fullName ?? user.email };
}

export const fileSelect = {
  id: true,
  fileName: true,
  contentType: true,
  sizeBytes: true,
  status: true,
} as const;

/** Only READY files are shown; a file still being checked is as good as absent. */
export function toFile(
  file: {
    id: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    status: "PENDING" | "READY";
  } | null,
): FileDto | null {
  if (file === null || file.status !== "READY") return null;
  return {
    id: file.id,
    fileName: file.fileName,
    contentType: file.contentType,
    sizeBytes: file.sizeBytes,
    preview: ruleFor(file.fileName)?.preview ?? null,
  };
}

export { excerptOf };

/**
 * Orders rows fetched by id to match the order the search returned the ids in.
 */
export function inIdOrder<T extends { id: string }>(
  ids: readonly string[],
  rows: T[],
): T[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row === undefined ? [] : [row];
  });
}
