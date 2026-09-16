import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import { BusinessRuleError, NotFoundError, ValidationError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/platform/audit/audit";
import { type Actor, requireGlobalPermission } from "@/platform/authz/authz";
import { ERP_PERMISSIONS } from "../../contracts/permissions";
import {
  journalDraftSchema,
  journalReverseSchema,
  listParamsSchema,
} from "../../contracts/schemas";
import type { JournalDetail, JournalListItem, Paginated } from "../../contracts/types";
import { MAX_JOURNAL_LINES, summarizeLines } from "../../domain/journal";
import {
  accountRefSelect,
  costCentreRefSelect,
  journalListSelect,
  personSelect,
} from "../../repositories/selects";
import { announcePosting, postLockedDraft, reverseJournalInTransaction } from "./ledger";
import {
  ERP_MODULE,
  asFinanceError,
  assertId,
  auditFields,
  dateFromIso,
  loadFinanceSettings,
  lockJournalEntry,
  parseInput,
  selfPostingBlocked,
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
  await requireGlobalPermission(actor, ERP_PERMISSIONS.JOURNAL_READ);
  const params = listParamsSchema.parse(rawParams);
  const query = params.q === undefined || params.q === "" ? undefined : params.q;

  const where: Prisma.ErpJournalEntryWhereInput = {
    ...(params.status !== undefined ? { status: params.status } : {}),
    ...(params.kind !== undefined ? { kind: params.kind } : {}),
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
  await requireGlobalPermission(actor, ERP_PERMISSIONS.JOURNAL_READ);
  assertId(entryId, "journal entry");

  const row = await prisma.erpJournalEntry.findUnique({
    where: { id: entryId },
    select: {
      ...journalListSelect,
      sourceModule: true,
      sourceType: true,
      sourceId: true,
      reversedAt: true,
      createdBy: true,
      updatedBy: true,
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
  const settings = await loadFinanceSettings();

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
    selfPostingBlocked:
      row.status === "DRAFT" && selfPostingBlocked(settings, row, actor.id),
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
  await requireGlobalPermission(actor, ERP_PERMISSIONS.JOURNAL_CREATE);
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
          kind: draft.kind,
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
          changes: {
            entryDate: draft.entryDate,
            kind: draft.kind,
            lineCount: lines.length,
          },
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
  await requireGlobalPermission(actor, ERP_PERMISSIONS.JOURNAL_UPDATE);
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
          kind: draft.kind,
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
  await requireGlobalPermission(actor, ERP_PERMISSIONS.JOURNAL_DELETE);
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

export async function postJournal(
  actor: Actor,
  entryId: string,
): Promise<{ journalNumber: string }> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.JOURNAL_POST);
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
      const settings = await loadFinanceSettings(tx);
      if (selfPostingBlocked(settings, entry, actor.id)) {
        throw new BusinessRuleError(
          "You cannot post a journal entry you created or last edited. Ask someone else with posting rights to post it, or allow it in finance settings.",
        );
      }

      const { journalNumber, fiscalPeriodId } = await postLockedDraft(tx, actor, entry);
      await announcePosting(tx, actor, {
        entryId,
        journalNumber,
        entryDate: entry.entryDate,
        fiscalPeriodId,
        reversesEntryId: null,
        summary: `Posted journal entry ${journalNumber}`,
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
  await requireGlobalPermission(actor, ERP_PERMISSIONS.JOURNAL_REVERSE);
  assertId(entryId, "journal entry");
  const data = parseInput(journalReverseSchema, input ?? {});
  const reversalDate = data.reversalDate ?? todayIso();

  try {
    return await prisma.$transaction(async (tx) => {
      const original = await lockJournalEntry(tx, entryId);
      // An entry raised by an invoice or receipt is corrected by voiding that
      // document, so the document and its balance stay in step with the ledger.
      if (original.sourceType !== null) {
        throw new BusinessRuleError(
          "This entry was posted from an invoice or receipt. Void that document instead.",
        );
      }
      if (original.kind === "YEAR_END_CLOSE") {
        throw new BusinessRuleError(
          "This entry closed a fiscal year. Reopen the year on the accounting periods page instead.",
        );
      }
      const reversal = await reverseJournalInTransaction(tx, actor, entryId, {
        reversalDate,
        description: data.description,
      });
      return { reversalId: reversal.reversalId, journalNumber: reversal.journalNumber };
    }, POSTING_TRANSACTION);
  } catch (error) {
    throw asFinanceError(error);
  }
}
