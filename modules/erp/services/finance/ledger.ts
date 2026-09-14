import { BusinessRuleError } from "@/lib/errors";
import type { PrismaTransaction } from "@/lib/prisma";
import { recordAudit } from "@/platform/audit/audit";
import type { Actor } from "@/platform/authz/authz";
import { publish } from "@/platform/events/publish";
import {
  ERP_EVENTS,
  type JournalEntryPostedPayload,
  type JournalEntryReversedPayload,
} from "../../contracts/events";
import {
  formatJournalNumber,
  postingProblems,
  reversedLines,
  summarizeLines,
  yearOfIsoDate,
} from "../../domain/journal";
import {
  ERP_MODULE,
  auditFields,
  dateFromIso,
  isoDateOf,
  lockJournalEntry,
} from "./support";

/**
 * The ledger engine (ADR-022, ADR-023): the ONE way anything in ERP posts to or
 * reverses the journal. The Journal Entries screen and accounts receivable both call
 * these inside their own transaction, so an invoice and its journal entry commit or
 * roll back together, and every posting meets exactly the same rules.
 *
 * Module-private: other modules never post journals.
 */

export type JournalSource = { module: string; type: string; id: string };

export type LedgerLine = {
  accountId: string;
  costCentreId: string | null;
  description: string | null;
  debitMinor: bigint;
  creditMinor: bigint;
};

/** The next gap-free journal number for the entry's year, taken inside the transaction. */
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
 * Validates a locked draft entry against every posting rule and posts it: the open
 * period holding its date, active postable accounts, active cost centres, balance.
 */
export async function postLockedDraft(
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

/** The audit record and outbox event every posting writes. */
export async function announcePosting(
  tx: PrismaTransaction,
  actor: Actor,
  posting: {
    entryId: string;
    journalNumber: string;
    entryDate: string;
    fiscalPeriodId: string;
    reversesEntryId: string | null;
    summary: string;
  },
): Promise<void> {
  await recordAudit(
    {
      ...auditFields(actor),
      action: "erp.journal.posted",
      module: ERP_MODULE,
      entityType: "journal_entry",
      entityId: posting.entryId,
      summary: posting.summary,
      changes: {
        journalNumber: posting.journalNumber,
        entryDate: posting.entryDate,
        fiscalPeriodId: posting.fiscalPeriodId,
        ...(posting.reversesEntryId !== null
          ? { reversesEntryId: posting.reversesEntryId }
          : {}),
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
      journalEntryId: posting.entryId,
      journalNumber: posting.journalNumber,
      entryDate: posting.entryDate,
      fiscalPeriodId: posting.fiscalPeriodId,
      reversesEntryId: posting.reversesEntryId,
    } satisfies JournalEntryPostedPayload,
  });
}

/**
 * Creates and posts a journal entry in the caller's transaction — how a document such
 * as an AR invoice books its accounting. Throws a BusinessRuleError, rolling the
 * caller back, if any posting rule fails.
 */
export async function recordPostedJournal(
  tx: PrismaTransaction,
  actor: Actor,
  input: {
    entryDate: string;
    description: string;
    reference: string | null;
    source: JournalSource | null;
    lines: readonly LedgerLine[];
  },
): Promise<{ id: string; journalNumber: string; fiscalPeriodId: string }> {
  const lines = input.lines.map((line, index) => ({ lineNo: index + 1, ...line }));
  const entry = await tx.erpJournalEntry.create({
    data: {
      entryDate: dateFromIso(input.entryDate),
      description: input.description.slice(0, 500),
      reference: input.reference,
      totalMinor: summarizeLines(lines).debitMinor,
      sourceModule: input.source?.module ?? null,
      sourceType: input.source?.type ?? null,
      sourceId: input.source?.id ?? null,
      createdBy: actor.id,
      updatedBy: actor.id,
      lines: { create: lines },
    },
    select: { id: true },
  });

  const posted = await postLockedDraft(tx, actor, {
    id: entry.id,
    entryDate: input.entryDate,
  });
  await announcePosting(tx, actor, {
    entryId: entry.id,
    journalNumber: posted.journalNumber,
    entryDate: input.entryDate,
    fiscalPeriodId: posted.fiscalPeriodId,
    reversesEntryId: null,
    summary: `Posted journal entry ${posted.journalNumber}: ${input.description}`.slice(
      0,
      500,
    ),
  });
  return { id: entry.id, ...posted };
}

/**
 * Reverses a posted entry in the caller's transaction with an equal and opposite
 * posted entry, and marks the original reversed. The original is never edited
 * beyond that.
 */
export async function reverseJournalInTransaction(
  tx: PrismaTransaction,
  actor: Actor,
  entryId: string,
  options: { reversalDate: string; description: string | null },
): Promise<{ reversalId: string; journalNumber: string; fiscalPeriodId: string }> {
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
  if (options.reversalDate < original.entryDate) {
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
      entryDate: dateFromIso(options.reversalDate),
      description: (
        options.description ?? `Reversal of ${originalNumber}: ${source.description}`
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
    entryDate: options.reversalDate,
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
        reversalDate: options.reversalDate,
      },
      severity: "NOTICE",
    },
    tx,
  );
  await announcePosting(tx, actor, {
    entryId: reversal.id,
    journalNumber: posted.journalNumber,
    entryDate: options.reversalDate,
    fiscalPeriodId: posted.fiscalPeriodId,
    reversesEntryId: entryId,
    summary: `Posted journal entry ${posted.journalNumber}, reversing ${originalNumber}`,
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

  return {
    reversalId: reversal.id,
    journalNumber: posted.journalNumber,
    fiscalPeriodId: posted.fiscalPeriodId,
  };
}
