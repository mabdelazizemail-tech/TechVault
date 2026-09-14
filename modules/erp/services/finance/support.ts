import { Prisma } from "@prisma/client";
import type { z } from "zod";
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ValidationError,
  isAppError,
} from "@/lib/errors";
import type { PrismaTransaction } from "@/lib/prisma";
import type { Actor } from "@/platform/authz/authz";
import type {
  AccountListItem,
  CostCentreListItem,
  JournalListItem,
  PeriodDto,
  PersonRef,
} from "../../contracts/types";
import type {
  AccountListRow,
  CostCentreListRow,
  JournalListRow,
  PeriodRow,
} from "../../repositories/selects";

/**
 * Shared plumbing for ERP finance services. Module-private.
 */

export const ERP_MODULE = "erp";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 404 for anything that is not a well-formed id, before any query runs. */
export function assertId(value: string, entity: string): void {
  if (!UUID_PATTERN.test(value)) throw new NotFoundError(entity);
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

/** Escapes a search term for ILIKE, so "100%" matches a literal percent sign. */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

/* Money and dates ----------------------------------------------------------- */

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * A minor-unit amount from the database, as a JavaScript number. Refuses rather than
 * rounds a value JavaScript cannot represent exactly — a wrong figure silently
 * shown is worse than an error.
 */
export function toAmount(value: bigint): number {
  if (value > MAX_SAFE || value < -MAX_SAFE) {
    throw new Error("ERP amount is outside the range that can be shown exactly.");
  }
  return Number(value);
}

/** A `date` column (read by Prisma as UTC midnight) as "YYYY-MM-DD". */
export function isoDateOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function dateFromIso(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

/** Today's date where the business operates (CLAUDE.md §29 #13). */
export function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/* Database errors ------------------------------------------------------------ */

function databaseText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (
    let depth = 0;
    depth < 5 && current !== null && current !== undefined;
    depth += 1
  ) {
    if (current instanceof Error) {
      parts.push(current.message);
      if (error instanceof Prisma.PrismaClientKnownRequestError && current === error) {
        parts.push(JSON.stringify(error.meta ?? {}));
      }
      current = (current as { cause?: unknown }).cause;
    } else {
      parts.push(typeof current === "string" ? current : JSON.stringify(current));
      break;
    }
  }
  return parts.join(" | ");
}

/**
 * Turns an accounting invariant the DATABASE refused into the business error it is.
 * The ERP triggers speak in "erp: …" sentences written for people; anything else is
 * returned untouched, so a real fault is never disguised as a rule.
 */
export function asFinanceError(error: unknown): unknown {
  if (isAppError(error)) return error;
  const text = databaseText(error);
  const rule = /erp: ([^"|\\\n]+)/.exec(text);
  if (rule?.[1] !== undefined) {
    const sentence = rule[1].trim();
    return new BusinessRuleError(
      `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}${sentence.endsWith(".") ? "" : "."}`,
    );
  }
  if (text.includes("fiscal_periods_no_overlap")) {
    return new ConflictError("These dates overlap an existing accounting period.");
  }
  return error;
}

/**
 * Locks one journal entry for the rest of the transaction, so two people cannot post,
 * edit or reverse the same entry at once.
 */
export async function lockJournalEntry(
  tx: PrismaTransaction,
  id: string,
): Promise<{
  id: string;
  status: "DRAFT" | "POSTED" | "REVERSED";
  entryDate: string;
  journalNumber: string | null;
  reversesEntryId: string | null;
}> {
  const rows = await tx.$queryRaw<
    {
      id: string;
      status: "DRAFT" | "POSTED" | "REVERSED";
      entry_date: string;
      journal_number: string | null;
      reverses_entry_id: string | null;
    }[]
  >`
    SELECT id, status::text AS status, entry_date::text AS entry_date,
           journal_number, reverses_entry_id
      FROM erp.journal_entries
     WHERE id = ${id}::uuid
       FOR UPDATE`;
  const row = rows[0];
  if (row === undefined) throw new NotFoundError("journal entry");
  return {
    id: row.id,
    status: row.status,
    entryDate: row.entry_date,
    journalNumber: row.journal_number,
    reversesEntryId: row.reverses_entry_id,
  };
}

/* Mappers -------------------------------------------------------------------- */

export function toPerson(
  user: { id: string; fullName: string | null; email: string } | null,
): PersonRef | null {
  return user === null ? null : { id: user.id, name: user.fullName ?? user.email };
}

export function toAccountListItem(row: AccountListRow, depth: number): AccountListItem {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    nameAr: row.nameAr,
    type: row.type,
    normalBalance: row.normalBalance,
    isPostable: row.isPostable,
    isActive: row.isActive,
    parentId: row.parentId,
    depth,
    childCount: row._count.children,
  };
}

export function toCostCentreListItem(
  row: CostCentreListRow,
  depth: number,
): CostCentreListItem {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    nameAr: row.nameAr,
    isActive: row.isActive,
    parentId: row.parentId,
    depth,
    childCount: row._count.children,
  };
}

export function toPeriodDto(row: PeriodRow): PeriodDto {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    startDate: isoDateOf(row.startDate),
    endDate: isoDateOf(row.endDate),
    closedAt: row.closedAt,
    closedBy: toPerson(row.closer),
    reopenedAt: row.reopenedAt,
    reopenedBy: toPerson(row.reopener),
    postedEntryCount: row._count.entries,
  };
}

export function toJournalListItem(row: JournalListRow): JournalListItem {
  return {
    id: row.id,
    journalNumber: row.journalNumber,
    entryDate: isoDateOf(row.entryDate),
    description: row.description,
    reference: row.reference,
    status: row.status,
    totalMinor: toAmount(row.totalMinor),
    lineCount: row._count.lines,
    createdBy: toPerson(row.creator) ?? { id: "", name: "Unknown" },
    postedAt: row.postedAt,
    reverses: row.reverses,
    reversal: row.reversal,
  };
}
