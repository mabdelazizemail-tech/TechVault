import { BusinessRuleError, ConflictError } from "@/lib/errors";
import { type PrismaTransaction, prisma } from "@/lib/prisma";
import { recordAudit } from "@/platform/audit/audit";
import { type Actor, requireGlobalPermission } from "@/platform/authz/authz";
import { publish } from "@/platform/events/publish";
import {
  ERP_EVENTS,
  type FiscalYearClosedPayload,
  type FiscalYearReopenedPayload,
} from "../../contracts/events";
import { ERP_PERMISSIONS } from "../../contracts/permissions";
import { fiscalYearReopenSchema, fiscalYearSchema } from "../../contracts/schemas";
import type { FiscalYearDto, YearEndPreview } from "../../contracts/types";
import { buildClosingLines } from "../../domain/reports";
import { accountRefSelect, personSelect } from "../../repositories/selects";
import { recordPostedJournal, reverseJournalInTransaction } from "./ledger";
import { ledgerBalances } from "./report-service";
import {
  ERP_MODULE,
  type FinanceSettingsRow,
  asFinanceError,
  auditFields,
  dateFromIso,
  isUniqueViolation,
  loadFinanceSettings,
  parseInput,
  toAmount,
  toPerson,
  todayIso,
} from "./support";

/**
 * Year-end close (ADR-028). The fiscal year is the calendar year (ADR-027).
 *
 * Closing a year posts one YEAR_END_CLOSE entry dated 31 December that brings every
 * revenue and expense account's movement for the year to zero and moves the result into
 * the retained earnings account named in finance settings. From then on nothing can be
 * posted into the year: the ledger engine refuses, and so does the journal guard trigger.
 * Reopening needs its own permission and a reason, reverses the closing entry, and is
 * audited at CRITICAL.
 */

const YEAR_TRANSACTION = { timeout: 30_000, maxWait: 10_000 } as const;
const MAX_YEARS_LISTED = 50;

const bounds = (year: number) => ({ start: `${year}-01-01`, end: `${year}-12-31` });

/**
 * Locks every accounting period touching the year. A posting locks its own period, so
 * no posting into the year can interleave with a close or a reopen.
 */
async function lockYearPeriods(tx: PrismaTransaction, year: number): Promise<void> {
  const { start, end } = bounds(year);
  await tx.$queryRaw`
    SELECT id FROM erp.fiscal_periods
     WHERE start_date <= ${end}::date AND end_date >= ${start}::date
     ORDER BY start_date
       FOR UPDATE`;
}

/** Everything that stops a year closing, in words a finance administrator can act on. */
async function yearEndProblems(
  client: PrismaTransaction | typeof prisma,
  year: number,
  settings: FinanceSettingsRow,
): Promise<string[]> {
  const { start, end } = bounds(year);
  const inYear = { gte: dateFromIso(start), lte: dateFromIso(end) };
  const [
    liveClose,
    account,
    drafts,
    unpostedInvoices,
    draftReceipts,
    openDecember,
    unpostedBills,
    unpostedPayments,
  ] = await Promise.all([
    client.erpFiscalYearClose.findFirst({
      where: { year, reopenedAt: null },
      select: { id: true },
    }),
    settings.retainedEarningsAccountId === null
      ? Promise.resolve(null)
      : client.erpAccount.findUnique({
          where: { id: settings.retainedEarningsAccountId },
          select: { type: true, isActive: true, isPostable: true },
        }),
    client.erpJournalEntry.count({ where: { status: "DRAFT", entryDate: inYear } }),
    client.erpArInvoice.count({
      where: {
        status: { in: ["DRAFT", "PENDING_APPROVAL", "APPROVED"] },
        invoiceDate: inYear,
      },
    }),
    client.erpArReceipt.count({ where: { status: "DRAFT", receiptDate: inYear } }),
    client.erpFiscalPeriod.findFirst({
      where: {
        startDate: { lte: dateFromIso(end) },
        endDate: { gte: dateFromIso(end) },
        status: "OPEN",
      },
      select: { id: true },
    }),
    client.erpApBill.count({
      where: {
        status: { in: ["DRAFT", "PENDING_APPROVAL", "APPROVED"] },
        billDate: inYear,
      },
    }),
    client.erpApPayment.count({
      where: {
        status: { in: ["DRAFT", "PENDING_APPROVAL", "APPROVED"] },
        paymentDate: inYear,
      },
    }),
  ]);

  const problems: string[] = [];
  if (liveClose !== null) problems.push(`${year} is already closed.`);
  if (end >= todayIso()) {
    problems.push(
      `${year} has not ended yet. It can be closed from 1 January ${year + 1}.`,
    );
  }
  if (settings.retainedEarningsAccountId === null) {
    problems.push("Choose a retained earnings account in finance settings first.");
  } else if (
    account === null ||
    account.type !== "EQUITY" ||
    !account.isActive ||
    !account.isPostable
  ) {
    problems.push(
      "The retained earnings account in finance settings must be an active, postable equity account.",
    );
  }
  if (drafts > 0) {
    problems.push(
      `${drafts} draft journal ${drafts === 1 ? "entry is" : "entries are"} dated in ${year}. Post or delete ${drafts === 1 ? "it" : "them"} first.`,
    );
  }
  if (unpostedInvoices + draftReceipts > 0) {
    problems.push(
      `${unpostedInvoices} unposted invoice(s) and ${draftReceipts} draft receipt(s) are dated in ${year}. Post, cancel or delete them first.`,
    );
  }
  if (unpostedBills + unpostedPayments > 0) {
    problems.push(
      `${unpostedBills} unposted bill(s) and ${unpostedPayments} unposted payment(s) are dated in ${year}. Post, cancel or delete them first.`,
    );
  }
  if (openDecember === null) {
    problems.push(
      `The closing entry is dated 31 December ${year}, so an open accounting period must contain that date.`,
    );
  }
  return problems;
}

/** Every year an accounting period falls in, newest first, with how it stands. */
export async function listFiscalYears(actor: Actor): Promise<FiscalYearDto[]> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.PERIOD_READ);
  const yearRows = await prisma.$queryRaw<{ year: number }[]>`
    SELECT DISTINCT g.y AS year
      FROM erp.fiscal_periods p
     CROSS JOIN LATERAL generate_series(
             EXTRACT(YEAR FROM p.start_date)::int, EXTRACT(YEAR FROM p.end_date)::int
           ) AS g(y)
     ORDER BY year DESC
     LIMIT ${MAX_YEARS_LISTED}`;
  const years = yearRows.map((row) => Number(row.year));
  if (years.length === 0) return [];

  const closes = await prisma.erpFiscalYearClose.findMany({
    where: { year: { in: years } },
    orderBy: { closedAt: "desc" },
    select: {
      year: true,
      closedAt: true,
      reopenedAt: true,
      netIncomeMinor: true,
      closer: { select: personSelect },
      reopener: { select: personSelect },
      journalEntry: { select: { id: true, journalNumber: true } },
    },
  });
  const today = todayIso();

  return years.map((year) => {
    const forYear = closes.filter((close) => close.year === year);
    const live = forYear.find((close) => close.reopenedAt === null) ?? null;
    const lastReopened = live === null ? (forYear[0] ?? null) : null;
    return {
      year,
      status: live === null ? ("OPEN" as const) : ("CLOSED" as const),
      hasEnded: bounds(year).end < today,
      closedAt: live?.closedAt ?? null,
      closedBy: toPerson(live?.closer ?? null),
      netIncomeMinor: live === null ? null : toAmount(live.netIncomeMinor),
      closingJournal: live?.journalEntry ?? null,
      reopenedAt: lastReopened?.reopenedAt ?? null,
      reopenedBy: toPerson(lastReopened?.reopener ?? null),
    };
  });
}

/** What closing the year would do, and anything stopping it — shown before confirming. */
export async function previewYearEnd(
  actor: Actor,
  input: unknown,
): Promise<YearEndPreview> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.FISCAL_YEAR_CLOSE);
  const { year } = parseInput(fiscalYearSchema, input);
  const settings = await loadFinanceSettings();
  const { start, end } = bounds(year);

  const [problems, balances, account] = await Promise.all([
    yearEndProblems(prisma, year, settings),
    ledgerBalances(start, end, { excludeYearEndClose: true }),
    settings.retainedEarningsAccountId === null
      ? Promise.resolve(null)
      : prisma.erpAccount.findUnique({
          where: { id: settings.retainedEarningsAccountId },
          select: accountRefSelect,
        }),
  ]);
  const closing = buildClosingLines(balances, settings.retainedEarningsAccountId ?? "");
  return {
    year,
    netIncomeMinor: toAmount(closing.netIncomeMinor),
    accountCount: closing.accountCount,
    retainedEarningsAccount: account,
    problems,
  };
}

export async function closeFiscalYear(
  actor: Actor,
  input: unknown,
): Promise<{ journalNumber: string | null; netIncomeMinor: number }> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.FISCAL_YEAR_CLOSE);
  const { year } = parseInput(fiscalYearSchema, input);
  const { start, end } = bounds(year);

  try {
    return await prisma.$transaction(async (tx) => {
      await lockYearPeriods(tx, year);
      const settings = await loadFinanceSettings(tx);
      const problems = await yearEndProblems(tx, year, settings);
      const retainedEarningsAccountId = settings.retainedEarningsAccountId;
      if (problems.length > 0 || retainedEarningsAccountId === null) {
        throw new BusinessRuleError(problems.join(" "), { problems });
      }

      const closing = buildClosingLines(
        await ledgerBalances(start, end, { client: tx, excludeYearEndClose: true }),
        retainedEarningsAccountId,
      );
      // The closing entry posts before the close is recorded, so the ledger still takes it.
      const entry =
        closing.lines.length === 0
          ? null
          : await recordPostedJournal(tx, actor, {
              entryDate: end,
              description: `Year-end close ${year}: profit or loss to retained earnings`,
              reference: `FY${year}`,
              source: null,
              kind: "YEAR_END_CLOSE",
              lines: closing.lines.map((line) => ({
                ...line,
                costCentreId: null,
                description: null,
              })),
            });

      const close = await tx.erpFiscalYearClose.create({
        data: {
          year,
          journalEntryId: entry?.id ?? null,
          netIncomeMinor: closing.netIncomeMinor,
          retainedEarningsAccountId,
          closedBy: actor.id,
        },
        select: { id: true },
      });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.fiscal_year.closed",
          module: ERP_MODULE,
          entityType: "fiscal_year",
          entityId: String(year),
          summary:
            entry === null
              ? `Closed fiscal year ${year}; nothing moved in revenue or expenses`
              : `Closed fiscal year ${year} with ${entry.journalNumber}`,
          changes: {
            year,
            netIncomeMinor: closing.netIncomeMinor.toString(),
            journalNumber: entry?.journalNumber ?? null,
          },
          severity: "NOTICE",
        },
        tx,
      );
      await publish(tx, {
        name: ERP_EVENTS.FISCAL_YEAR_CLOSED,
        actorId: actor.id,
        correlationId: actor.correlationId ?? null,
        payload: {
          year,
          fiscalYearCloseId: close.id,
          journalEntryId: entry?.id ?? null,
        } satisfies FiscalYearClosedPayload,
      });
      return {
        journalNumber: entry?.journalNumber ?? null,
        netIncomeMinor: toAmount(closing.netIncomeMinor),
      };
    }, YEAR_TRANSACTION);
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError(`${year} is already closed.`);
    throw asFinanceError(error);
  }
}

export async function reopenFiscalYear(actor: Actor, input: unknown): Promise<void> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.FISCAL_YEAR_REOPEN);
  const { year, reason } = parseInput(fiscalYearReopenSchema, input);

  try {
    await prisma.$transaction(async (tx) => {
      await lockYearPeriods(tx, year);
      const [live, later] = await Promise.all([
        tx.erpFiscalYearClose.findFirst({
          where: { year, reopenedAt: null },
          select: { id: true, journalEntryId: true },
        }),
        tx.erpFiscalYearClose.findFirst({
          where: { year: { gt: year }, reopenedAt: null },
          orderBy: { year: "asc" },
          select: { year: true },
        }),
      ]);
      if (live === null) throw new BusinessRuleError(`${year} is not closed.`);
      if (later !== null) {
        throw new BusinessRuleError(
          `Reopen ${later.year} first. Years are reopened from the most recent.`,
        );
      }

      // Marked reopened first, so the reversal below may post into the year.
      await tx.erpFiscalYearClose.update({
        where: { id: live.id },
        data: { reopenedAt: new Date(), reopenedBy: actor.id, reopenReason: reason },
      });
      const reversal =
        live.journalEntryId === null
          ? null
          : await reverseJournalInTransaction(tx, actor, live.journalEntryId, {
              reversalDate: bounds(year).end,
              description: `Reopening ${year}: reversal of the year-end close`,
            });
      if (reversal !== null) {
        await tx.erpFiscalYearClose.update({
          where: { id: live.id },
          data: { reopenJournalEntryId: reversal.reversalId },
        });
      }

      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.fiscal_year.reopened",
          module: ERP_MODULE,
          entityType: "fiscal_year",
          entityId: String(year),
          summary: `Reopened fiscal year ${year}`,
          changes: {
            year,
            reason,
            reversalJournalNumber: reversal?.journalNumber ?? null,
          },
          severity: "CRITICAL",
        },
        tx,
      );
      await publish(tx, {
        name: ERP_EVENTS.FISCAL_YEAR_REOPENED,
        actorId: actor.id,
        correlationId: actor.correlationId ?? null,
        payload: {
          year,
          fiscalYearCloseId: live.id,
          reversalEntryId: reversal?.reversalId ?? null,
        } satisfies FiscalYearReopenedPayload,
      });
    }, YEAR_TRANSACTION);
  } catch (error) {
    throw asFinanceError(error);
  }
}
