import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import { BusinessRuleError, NotFoundError, ValidationError } from "@/lib/errors";
import { prisma, type PrismaTransaction } from "@/lib/prisma";
import { recordAudit } from "@/platform/audit/audit";
import { type Actor, requirePermission } from "@/platform/authz/authz";
import { publish } from "@/platform/events/publish";
import {
  ERP_EVENTS,
  type JournalEntryPostedPayload,
  type JournalEntryReversedPayload,
} from "../../contracts/events";
import { ERP_PERMISSIONS } from "../../contracts/permissions";
import {
  journalDraftSchema,
  journalReverseSchema,
  listParamsSchema,
} from "../../contracts/schemas";
import type { JournalDetail, JournalListItem, Paginated } from "../../contracts/types";
import {
  MAX_JOURNAL_LINES,
  formatJournalNumber,
  postingProblems,
  reversedLines,
  summarizeLines,
  yearOfIsoDate,
} from "../../domain/journal";
import {
  accountRefSelect,
  costCentreRefSelect,
  journalListSelect,
  personSelect,
} from "../../repositories/selects";
import {
  ERP_MODULE,
  asFinanceError,
  assertId,
  auditFields,
  dateFromIso,
  isoDateOf,
  lockJournalEntry,
  parseInput,
  todayIso,
  toAmount,
  toJournalListItem,
  toPerson,
} from "./support";

/**
 * The journal: DRAFT → POSTED → REVERSED (CLAUDE.md §6.2).
 *
 * A draft may be edited and deleted. Posting is one transaction — lock, re-validate
 * everything on the server, number, post, audit, publish — and a posted entry is
 * never changed again: a correction is a reversal plus a new entry. The database
 * enforces the same invariants, so a bug here cannot write an unbalanced or edited
 * ledger (ADR-022).
 */

const LIST_PAGE_SIZE = 25;
/** Posting and reversing touch several tables; give a slow connection room. */
const POSTING_TRANSACTION = { timeout: 15_000, maxWait: 10_000 } as const;

type Draft = z.output<typeof journalDraftSchema>;

/* Reads --------------------------------------------------------------------- */

export async function listJournals(
  actor: Actor,
  rawParams: Record<string, unknown> = {},
): Promise<Paginated<JournalListItem>> {
  await requirePermission(actor, ERP_PERMISSIONS.JOURNAL_READ);
  const params = listParamsSchema.parse(rawParams);
  const query = params.q === undefined || params.q === "" ? undefined : params.q;

  const where: Prisma.ErpJournalEntryWhereInput = {
    ...(params.status !== undefined ? { status: params.status } : {}),
    ...(params.period !== undefined ? { fiscalPeriodId: params.period } : {}),
    ...(params.from !== undefined || params.to !== undefined
      ? {
          entryDate: {
            ...(params.from !== undefined ? { gte: dateFromIso(params.from) } : {}),
            ...(params.to !== undefined ? { lte: dateFromIso(params.to) } : {}),
          },
        }
      : {}),
    ...(query !== undefined
      ? {
          OR: [
            { journalNumber: { contains: query, mode: "insensitive" } },
            { description: { contains: query, mode: "insensitive" } },
            { reference: { contains: query, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.erpJournalEntry.count({ where }),
    prisma.erpJournalEntry.findMany({
      where,
      orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
      skip: (params.page - 1) * LIST_PAGE_SIZE,
      take: LIST_PAGE_SIZE,
      select: journalListSelect,
    }),
  ]);

  return {
    rows: rows.map(toJournalListItem),
    total,
    page: params.page,
    pageSize: LIST_PAGE_SIZE,
  };
}

export async function getJournal(actor: Actor, entryId: string): Promise<JournalDetail> {
  await requirePermission(actor, ERP_PERMISSIONS.JOURNAL_READ);
  assertId(entryId, "journal entry");

  const row = await prisma.erpJournalEntry.findUnique({
    where: { id: entryId },
    select: {
      ...journalListSelect,
      sourceModule: true,
      sourceType: true,
      sourceId: true,
      reversedAt: true,
      createdAt: true,
      updatedAt: true,
      poster: { select: personSelect },
      reverser: { select: personSelect },
      period: { select: { id: true, name: true, status: true } },
      lines: {
        orderBy: { lineNo: "asc" },
        take: MAX_JOURNAL_LINES,
        select: {
          id: true,
          lineNo: true,
          description: true,
          debitMinor: true,
          creditMinor: true,
          account: { select: { ...accountRefSelect, type: true } },
          costCentre: { select: costCentreRefSelect },
        },
      },
    },
  });
  if (row === null) throw new NotFoundError("journal entry");

  const summary = summarizeLines(row.lines);
  return {
    ...toJournalListItem(row),
    lines: row.lines.map((line) => ({
      id: line.id,
      lineNo: line.lineNo,
      account: line.account,
      costCentre: line.costCentre,
      description: line.description,
      debitMinor: toAmount(line.debitMinor),
      creditMinor: toAmount(line.creditMinor),
    })),
    debitTotalMinor: toAmount(summary.debitMinor),
    creditTotalMinor: toAmount(summary.creditMinor),
    period: row.period,
    postedBy: toPerson(row.poster),
    reversedAt: row.reversedAt,
    reversedBy: toPerson(row.reverser),
    source:
      row.sourceModule !== null && row.sourceType !== null && row.sourceId !== null
        ? { module: row.sourceModule, type: row.sourceType, id: row.sourceId }
        : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/* Drafts -------------------------------------------------------------------- */

/**
 * Every account and cost centre a draft names must exist and be usable. Reported per
 * line, so the form marks the exact field.
 */
async function assertLineReferences(draft: Draft): Promise<void> {
  const accountIds = [...new Set(draft.lines.map((line) => line.accountId))];
  const centreIds = [
    ...new Set(
      draft.lines.flatMap((line) =>
        line.costCentreId === null ? [] : [line.costCentreId],
      ),
    ),
  ];

  const [accounts, centres] = await Promise.all([
    prisma.erpAccount.findMany({
      where: { id: { in: accountIds } },
      select: { id: true, code: true, isActive: true, isPostable: true },
    }),
    centreIds.length === 0
      ? Promise.resolve([])
      : prisma.erpCostCentre.findMany({
          where: { id: { in: centreIds } },
          select: { id: true, code: true, isActive: true },
        }),
  ]);
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const centreById = new Map(centres.map((centre) => [centre.id, centre]));

  const fieldErrors: Record<string, string[]> = {};
  draft.lines.forEach((line, index) => {
    const account = accountById.get(line.accountId);
    if (account === undefined) {
      fieldErrors[`lines.${index}.accountId`] = ["Choose a valid account."];
    } else if (!account.isActive) {
      fieldErrors[`lines.${index}.accountId`] = [`Account ${account.code} is inactive.`];
    } else if (!account.isPostable) {
      fieldErrors[`lines.${index}.accountId`] = [
        `${account.code} is a heading and cannot take postings.`,
      ];
    }
    if (line.costCentreId !== null) {
      const centre = centreById.get(line.costCentreId);
      if (centre === undefined) {
        fieldErrors[`lines.${index}.costCentreId`] = ["Choose a valid cost centre."];
      } else if (!centre.isActive) {
        fieldErrors[`lines.${index}.costCentreId`] = [
          `Cost centre ${centre.code} is inactive.`,
        ];
      }
    }
  });

  if (Object.keys(fieldErrors).length > 0) {
    throw new ValidationError("Please correct the highlighted lines.", fieldErrors);
  }
}

function linesOf(draft: Draft) {
  return draft.lines.map((line, index) => ({
    lineNo: index + 1,
    accountId: line.accountId,
    costCentreId: line.costCentreId,
    description: line.description,
    debitMinor: line.debit,
    creditMinor: line.credit,
  }));
}

export async function createJournal(
  actor: Actor,
  input: unknown,
): Promise<{ id: string }> {
  await requirePermission(actor, ERP_PERMISSIONS.JOURNAL_CREATE);
  const draft = parseInput(journalDraftSchema, input);
  await assertLineReferences(draft);
  const lines = linesOf(draft);

  try {
    return await prisma.$transaction(async (tx) => {
      const entry = await tx.erpJournalEntry.create({
        data: {
          entryDate: dateFromIso(draft.entryDate),
          description: draft.description,
          reference: draft.reference,
          totalMinor: summarizeLines(lines).debitMinor,
          createdBy: actor.id,
          updatedBy: actor.id,
          lines: { create: lines },
        },
        select: { id: true },
      });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.journal.created",
          module: ERP_MODULE,
          entityType: "journal_entry",
          entityId: entry.id,
          summary: `Created a draft journal entry dated ${draft.entryDate}`,
          changes: { entryDate: draft.entryDate, lineCount: lines.length },
        },
        tx,
      );
      return entry;
    });
  } catch (error) {
    throw asFinanceError(error);
  }
}

export async function updateJournal(
  actor: Actor,
  entryId: string,
  input: unknown,
): Promise<{ id: string }> {
  await requirePermission(actor, ERP_PERMISSIONS.JOURNAL_UPDATE);
  assertId(entryId, "journal entry");
  const draft = parseInput(journalDraftSchema, input);
  await assertLineReferences(draft);
  const lines = linesOf(draft);

  try {
    await prisma.$transaction(async (tx) => {
      const entry = await lockJournalEntry(tx, entryId);
      if (entry.status !== "DRAFT") {
        throw new BusinessRuleError(
          "A posted journal entry cannot be changed. Reverse it and post a new entry instead.",
        );
      }
      await tx.erpJournalLine.deleteMany({ where: { journalEntryId: entryId } });
      await tx.erpJournalEntry.update({
        where: { id: entryId },
        data: {
          entryDate: dateFromIso(draft.entryDate),
          description: draft.description,
          reference: draft.reference,
          totalMinor: summarizeLines(lines).debitMinor,
          updatedBy: actor.id,
          lines: { create: lines },
        },
      });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.journal.updated",
          module: ERP_MODULE,
          entityType: "journal_entry",
          entityId: entryId,
          summary: `Updated a draft journal entry dated ${draft.entryDate}`,
          changes: { entryDate: draft.entryDate, lineCount: lines.length },
        },
        tx,
      );
    });
  } catch (error) {
    throw asFinanceError(error);
  }
  return { id: entryId };
}

export async function deleteJournal(actor: Actor, entryId: string): Promise<void> {
  await requirePermission(actor, ERP_PERMISSIONS.JOURNAL_DELETE);
  assertId(entryId, "journal entry");

  try {
    await prisma.$transaction(async (tx) => {
      const entry = await lockJournalEntry(tx, entryId);
      if (entry.status !== "DRAFT") {
        throw new BusinessRuleError(
          "A posted journal entry cannot be deleted. Reverse it instead.",
        );
      }
      await tx.erpJournalEntry.delete({ where: { id: entryId } });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.journal.deleted",
          module: ERP_MODULE,
          entityType: "journal_entry",
          entityId: entryId,
          summary: `Deleted a draft journal entry dated ${entry.entryDate}`,
        },
        tx,
      );
    });
  } catch (error) {
    throw asFinanceError(error);
  }
}

/* Posting ------------------------------------------------------------------- */

/** The next gap-free number for the entry's year, taken inside the transaction. */
async function nextJournalNumber(
  tx: PrismaTransaction,
  entryDate: string,
): Promise<string> {
  const year = yearOfIsoDate(entryDate);
  const rows = await tx.$queryRaw<{ last_number: number }[]>`
    INSERT INTO erp.journal_sequences (year, last_number, updated_at)
    VALUES (${year}, 1, now())
    ON CONFLICT (year) DO UPDATE
      SET last_number = erp.journal_sequences.last_number + 1, updated_at = now()
    RETURNING last_number`;
  const sequence = rows[0]?.last_number;
  if (sequence === undefined) throw new Error("Journal number sequence returned no row.");
  return formatJournalNumber(year, sequence);
}

/**
 * Validates a locked draft against every posting rule and posts it. Shared by
 * posting and by reversal, so a reversal meets exactly the same bar.
 */
async function postLockedDraft(
  tx: PrismaTransaction,
  actor: Actor,
  entry: { id: string; entryDate: string },
): Promise<{ journalNumber: string; fiscalPeriodId: string }> {
  const date = dateFromIso(entry.entryDate);
  const [lines, period] = await Promise.all([
    tx.erpJournalLine.findMany({
      where: { journalEntryId: entry.id },
      orderBy: { lineNo: "asc" },
      select: {
        debitMinor: true,
        creditMinor: true,
        account: { select: { code: true, isActive: true, isPostable: true } },
        costCentre: { select: { code: true, isActive: true } },
      },
    }),
    tx.erpFiscalPeriod.findFirst({
      where: { startDate: { lte: date }, endDate: { gte: date } },
      select: { id: true, name: true, status: true, startDate: true, endDate: true },
    }),
  ]);

  const problems = postingProblems({
    entryDate: entry.entryDate,
    lines,
    period:
      period === null
        ? null
        : {
            name: period.name,
            status: period.status,
            startDate: isoDateOf(period.startDate),
            endDate: isoDateOf(period.endDate),
          },
  });
  if (problems.length > 0 || period === null) {
    throw new BusinessRuleError(problems.join(" "), { problems });
  }

  const journalNumber = await nextJournalNumber(tx, entry.entryDate);
  await tx.erpJournalEntry.update({
    where: { id: entry.id },
    data: {
      status: "POSTED",
      journalNumber,
      fiscalPeriodId: period.id,
      totalMinor: summarizeLines(lines).debitMinor,
      postedAt: new Date(),
      postedBy: actor.id,
      updatedBy: actor.id,
    },
  });
  return { journalNumber, fiscalPeriodId: period.id };
}

export async function postJournal(
  actor: Actor,
  entryId: string,
): Promise<{ journalNumber: string }> {
  await requirePermission(actor, ERP_PERMISSIONS.JOURNAL_POST);
  assertId(entryId, "journal entry");

  try {
    return await prisma.$transaction(async (tx) => {
      const entry = await lockJournalEntry(tx, entryId);
      if (entry.status !== "DRAFT") {
        throw new BusinessRuleError(
          entry.status === "POSTED"
            ? "This journal entry is already posted."
            : "This journal entry has been reversed.",
        );
      }

      const { journalNumber, fiscalPeriodId } = await postLockedDraft(tx, actor, entry);
      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.journal.posted",
          module: ERP_MODULE,
          entityType: "journal_entry",
          entityId: entryId,
          summary: `Posted journal entry ${journalNumber}`,
          changes: { journalNumber, entryDate: entry.entryDate, fiscalPeriodId },
          severity: "NOTICE",
        },
        tx,
      );
      await publish(tx, {
        name: ERP_EVENTS.JOURNAL_ENTRY_POSTED,
        actorId: actor.id,
        correlationId: actor.correlationId ?? null,
        payload: {
          journalEntryId: entryId,
          journalNumber,
          entryDate: entry.entryDate,
          fiscalPeriodId,
          reversesEntryId: null,
        } satisfies JournalEntryPostedPayload,
      });
      return { journalNumber };
    }, POSTING_TRANSACTION);
  } catch (error) {
    throw asFinanceError(error);
  }
}

/**
 * Reverses a posted entry with an equal and opposite posted entry, and marks the
 * original reversed — in one transaction. The original is never edited beyond that.
 */
export async function reverseJournal(
  actor: Actor,
  entryId: string,
  input: unknown = {},
): Promise<{ reversalId: string; journalNumber: string }> {
  await requirePermission(actor, ERP_PERMISSIONS.JOURNAL_REVERSE);
  assertId(entryId, "journal entry");
  const data = parseInput(journalReverseSchema, input ?? {});
  const reversalDate = data.reversalDate ?? todayIso();

  try {
    return await prisma.$transaction(async (tx) => {
      const original = await lockJournalEntry(tx, entryId);
      if (original.status === "DRAFT") {
        throw new BusinessRuleError(
          "Only a posted journal entry can be reversed. Delete the draft instead.",
        );
      }
      if (original.status === "REVERSED") {
        throw new BusinessRuleError("This journal entry has already been reversed.");
      }
      if (original.reversesEntryId !== null) {
        throw new BusinessRuleError(
          "This entry is itself a reversal. Post a new journal entry to correct it.",
        );
      }
      if (reversalDate < original.entryDate) {
        throw new BusinessRuleError(
          "A reversal cannot be dated before the entry it reverses.",
        );
      }

      const source = await tx.erpJournalEntry.findUniqueOrThrow({
        where: { id: entryId },
        select: {
          description: true,
          lines: {
            orderBy: { lineNo: "asc" },
            select: {
              lineNo: true,
              accountId: true,
              costCentreId: true,
              description: true,
              debitMinor: true,
              creditMinor: true,
            },
          },
        },
      });
      const originalNumber = original.journalNumber ?? "";
      const lines = reversedLines(source.lines);

      const reversal = await tx.erpJournalEntry.create({
        data: {
          entryDate: dateFromIso(reversalDate),
          description: (
            data.description ?? `Reversal of ${originalNumber}: ${source.description}`
          ).slice(0, 500),
          reference: originalNumber,
          reversesEntryId: entryId,
          totalMinor: summarizeLines(lines).debitMinor,
          createdBy: actor.id,
          updatedBy: actor.id,
          lines: { create: lines },
        },
        select: { id: true },
      });

      const posted = await postLockedDraft(tx, actor, {
        id: reversal.id,
        entryDate: reversalDate,
      });

      await tx.erpJournalEntry.update({
        where: { id: entryId },
        data: {
          status: "REVERSED",
          reversedAt: new Date(),
          reversedBy: actor.id,
          updatedBy: actor.id,
        },
      });

      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.journal.reversed",
          module: ERP_MODULE,
          entityType: "journal_entry",
          entityId: entryId,
          summary: `Reversed journal entry ${originalNumber} with ${posted.journalNumber}`,
          changes: {
            reversalEntryId: reversal.id,
            reversalJournalNumber: posted.journalNumber,
            reversalDate,
          },
          severity: "NOTICE",
        },
        tx,
      );
      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.journal.posted",
          module: ERP_MODULE,
          entityType: "journal_entry",
          entityId: reversal.id,
          summary: `Posted journal entry ${posted.journalNumber}, reversing ${originalNumber}`,
          changes: {
            journalNumber: posted.journalNumber,
            entryDate: reversalDate,
            fiscalPeriodId: posted.fiscalPeriodId,
            reversesEntryId: entryId,
          },
          severity: "NOTICE",
        },
        tx,
      );
      await publish(tx, {
        name: ERP_EVENTS.JOURNAL_ENTRY_POSTED,
        actorId: actor.id,
        correlationId: actor.correlationId ?? null,
        payload: {
          journalEntryId: reversal.id,
          journalNumber: posted.journalNumber,
          entryDate: reversalDate,
          fiscalPeriodId: posted.fiscalPeriodId,
          reversesEntryId: entryId,
        } satisfies JournalEntryPostedPayload,
      });
      await publish(tx, {
        name: ERP_EVENTS.JOURNAL_ENTRY_REVERSED,
        actorId: actor.id,
        correlationId: actor.correlationId ?? null,
        payload: {
          journalEntryId: entryId,
          journalNumber: originalNumber,
          reversalEntryId: reversal.id,
          reversalJournalNumber: posted.journalNumber,
        } satisfies JournalEntryReversedPayload,
      });

      return { reversalId: reversal.id, journalNumber: posted.journalNumber };
    }, POSTING_TRANSACTION);
  } catch (error) {
    throw asFinanceError(error);
  }
}
