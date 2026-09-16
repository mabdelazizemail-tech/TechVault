import { BusinessRuleError, ValidationError } from "@/lib/errors";
import { type PrismaTransaction, prisma } from "@/lib/prisma";
import { type Actor, requireGlobalPermission } from "@/platform/authz/authz";
import { ERP_PERMISSIONS } from "../../contracts/permissions";
import { ledgerReportParamsSchema } from "../../contracts/schemas";
import type {
  AccountType,
  BalanceSheet,
  ProfitAndLoss,
  ReportAccount,
  StatementSection,
  TrialBalance,
} from "../../contracts/types";
import {
  buildBalanceSheet,
  buildProfitAndLoss,
  buildTrialBalance,
  type LedgerBalance,
  type StatementSectionResult,
} from "../../domain/reports";
import { todayIso, toAmount } from "./support";

/**
 * Ledger reports (ADR-026): trial balance, profit and loss, balance sheet.
 *
 * They read POSTED and REVERSED journal entries — a reversed entry and its reversal are
 * both in the ledger and cancel out — and never drafts. Every document that reaches the
 * ledger (AR invoices and receipts included) is a journal entry, so these are the
 * books. Each report is one grouped statement returning a row per account with
 * postings: bounded by the size of the chart, never by the number of lines. At volume
 * this moves to rollups (§6.7).
 */

/** A report reads one row per account with postings; past this it needs a rollup. */
const MAX_REPORT_ACCOUNTS = 5000;

async function requireLedgerRead(actor: Actor): Promise<void> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.ACCOUNT_READ);
  await requireGlobalPermission(actor, ERP_PERMISSIONS.JOURNAL_READ);
}

function reportDates(
  rawParams: Record<string, unknown>,
  defaultFrom: (to: string) => string | null,
): { from: string | null; to: string } {
  const params = ledgerReportParamsSchema.parse(rawParams);
  const to = params.to ?? todayIso();
  const from = params.from ?? defaultFrom(to);
  if (from !== null && from > to) {
    throw new ValidationError("The start date must be on or before the end date.", {
      from: ["Choose a date on or before the end date."],
    });
  }
  return { from, to };
}

/**
 * Per-account posted totals: before `from` (opening) and from `from` to `to`. With
 * `excludeYearEndClose`, year-end close entries (and their reversals) are left out, so a
 * profit and loss shows the year's trading rather than the entry that closed it (ADR-028).
 */
export async function ledgerBalances(
  from: string | null,
  to: string,
  options: {
    client?: PrismaTransaction | typeof prisma;
    excludeYearEndClose?: boolean;
  } = {},
): Promise<LedgerBalance[]> {
  const client = options.client ?? prisma;
  const excludeYearEndClose = options.excludeYearEndClose === true;
  const rows = await client.$queryRaw<
    {
      id: string;
      code: string;
      name: string;
      name_ar: string | null;
      type: AccountType;
      opening_debit: bigint;
      opening_credit: bigint;
      debit: bigint;
      credit: bigint;
    }[]
  >`
    SELECT a.id, a.code, a.name, a.name_ar, a.type::text AS type,
           coalesce(sum(l.debit_minor) FILTER (WHERE e.entry_date < ${from}::date), 0)::bigint AS opening_debit,
           coalesce(sum(l.credit_minor) FILTER (WHERE e.entry_date < ${from}::date), 0)::bigint AS opening_credit,
           coalesce(sum(l.debit_minor) FILTER (WHERE ${from}::date IS NULL OR e.entry_date >= ${from}::date), 0)::bigint AS debit,
           coalesce(sum(l.credit_minor) FILTER (WHERE ${from}::date IS NULL OR e.entry_date >= ${from}::date), 0)::bigint AS credit
      FROM erp.journal_lines l
      JOIN erp.journal_entries e ON e.id = l.journal_entry_id
      JOIN erp.accounts a ON a.id = l.account_id
     WHERE e.status IN ('POSTED', 'REVERSED')
       AND e.entry_date <= ${to}::date
       AND (NOT ${excludeYearEndClose}::boolean OR e.kind <> 'YEAR_END_CLOSE')
     GROUP BY a.id, a.code, a.name, a.name_ar, a.type
     LIMIT ${MAX_REPORT_ACCOUNTS + 1}`;

  if (rows.length > MAX_REPORT_ACCOUNTS) {
    throw new BusinessRuleError(
      `More than ${MAX_REPORT_ACCOUNTS.toLocaleString("en")} accounts have postings, which is more than this report reads directly. It needs a reporting rollup.`,
    );
  }
  return rows.map((row) => ({
    accountId: row.id,
    code: row.code,
    name: row.name,
    nameAr: row.name_ar,
    type: row.type,
    openingDebitMinor: BigInt(row.opening_debit),
    openingCreditMinor: BigInt(row.opening_credit),
    debitMinor: BigInt(row.debit),
    creditMinor: BigInt(row.credit),
  }));
}

function accountOf(balance: LedgerBalance): ReportAccount {
  return {
    id: balance.accountId,
    code: balance.code,
    name: balance.name,
    nameAr: balance.nameAr,
    type: balance.type,
  };
}

function toSection(result: StatementSectionResult): StatementSection {
  return {
    type: result.type,
    rows: result.lines.map((line) => ({
      account: accountOf(line.balance),
      amountMinor: toAmount(line.amountMinor),
    })),
    totalMinor: toAmount(result.totalMinor),
  };
}

/** Every account's posted balance, from the first posting (or `from`) to `to`. */
export async function getTrialBalance(
  actor: Actor,
  rawParams: Record<string, unknown> = {},
): Promise<TrialBalance> {
  await requireLedgerRead(actor);
  const { from, to } = reportDates(rawParams, () => null);
  const result = buildTrialBalance(await ledgerBalances(from, to));
  return {
    from,
    to,
    rows: result.lines.map((line) => ({
      account: accountOf(line.balance),
      openingMinor: toAmount(line.openingMinor),
      debitMinor: toAmount(line.balance.debitMinor),
      creditMinor: toAmount(line.balance.creditMinor),
      closingDebitMinor: toAmount(line.closingDebitMinor),
      closingCreditMinor: toAmount(line.closingCreditMinor),
    })),
    totals: {
      openingDebitMinor: toAmount(result.totals.openingDebitMinor),
      openingCreditMinor: toAmount(result.totals.openingCreditMinor),
      debitMinor: toAmount(result.totals.debitMinor),
      creditMinor: toAmount(result.totals.creditMinor),
      closingDebitMinor: toAmount(result.totals.closingDebitMinor),
      closingCreditMinor: toAmount(result.totals.closingCreditMinor),
    },
    isBalanced: result.isBalanced,
  };
}

/**
 * Revenue and expenses posted between two dates, leaving out year-end close entries.
 * Without `from`, the fiscal year to date — the calendar year (ADR-027).
 */
export async function getProfitAndLoss(
  actor: Actor,
  rawParams: Record<string, unknown> = {},
): Promise<ProfitAndLoss> {
  await requireLedgerRead(actor);
  const { from, to } = reportDates(rawParams, (end) => `${end.slice(0, 4)}-01-01`);
  const result = buildProfitAndLoss(
    await ledgerBalances(from, to, { excludeYearEndClose: true }),
  );
  return {
    from: from ?? to,
    to,
    revenue: toSection(result.revenue),
    expenses: toSection(result.expenses),
    netIncomeMinor: toAmount(result.netIncomeMinor),
  };
}

/** Assets, liabilities and equity as of a date (`to`, default today). */
export async function getBalanceSheet(
  actor: Actor,
  rawParams: Record<string, unknown> = {},
): Promise<BalanceSheet> {
  await requireLedgerRead(actor);
  const { to } = reportDates({ to: rawParams.to }, () => null);
  const result = buildBalanceSheet(await ledgerBalances(null, to));
  return {
    asOf: to,
    assets: toSection(result.assets),
    liabilities: toSection(result.liabilities),
    equity: toSection(result.equity),
    unclosedProfitMinor: toAmount(result.unclosedProfitMinor),
    liabilitiesAndEquityMinor: toAmount(result.liabilitiesAndEquityMinor),
    isBalanced: result.isBalanced,
  };
}
