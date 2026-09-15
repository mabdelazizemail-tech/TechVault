import { prisma } from "@/lib/prisma";
import {
  type Actor,
  canAllGlobally,
  requireGlobalPermission,
} from "@/platform/authz/authz";
import { ERP_PERMISSIONS } from "../../contracts/permissions";
import type { FinanceOverview } from "../../contracts/types";
import { journalListSelect } from "../../repositories/selects";
import { dateFromIso, isoDateOf, todayIso, toAmount, toJournalListItem } from "./support";

/**
 * The finance landing page: a few operational counts and what just happened. Each
 * figure is gated by the permission to read what it counts, and each is one indexed
 * statement — no ledger scans on page load (§6.7).
 */
export async function getFinanceOverview(actor: Actor): Promise<FinanceOverview> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.ACCESS);
  const rights = await canAllGlobally(actor, [
    ERP_PERMISSIONS.JOURNAL_READ,
    ERP_PERMISSIONS.ACCOUNT_READ,
    ERP_PERMISSIONS.PERIOD_READ,
    ERP_PERMISSIONS.AR_AGING_READ,
  ]);
  const journals = rights[ERP_PERMISSIONS.JOURNAL_READ] === true;

  const today = todayIso();
  const monthStart = dateFromIso(`${today.slice(0, 7)}-01`);

  const [
    draftCount,
    postedThisMonthCount,
    activeAccountCount,
    openPeriods,
    recent,
    receivables,
  ] = await Promise.all([
    journals ? prisma.erpJournalEntry.count({ where: { status: "DRAFT" } }) : null,
    journals
      ? prisma.erpJournalEntry.count({
          where: {
            status: { in: ["POSTED", "REVERSED"] },
            entryDate: { gte: monthStart },
          },
        })
      : null,
    rights[ERP_PERMISSIONS.ACCOUNT_READ] === true
      ? prisma.erpAccount.count({ where: { isActive: true, isPostable: true } })
      : null,
    rights[ERP_PERMISSIONS.PERIOD_READ] === true
      ? prisma.erpFiscalPeriod.findMany({
          where: { status: "OPEN" },
          orderBy: { startDate: "asc" },
          take: 6,
          select: { id: true, name: true, status: true, startDate: true, endDate: true },
        })
      : null,
    journals
      ? prisma.erpJournalEntry.findMany({
          where: { status: { in: ["POSTED", "REVERSED"] } },
          orderBy: { postedAt: "desc" },
          take: 5,
          select: journalListSelect,
        })
      : null,
    rights[ERP_PERMISSIONS.AR_AGING_READ] === true
      ? prisma.$queryRaw<{ outstanding: bigint; overdue: bigint }[]>`
            SELECT coalesce(sum(outstanding_minor), 0)::bigint AS outstanding,
                   coalesce(sum(outstanding_minor) FILTER (WHERE due_date < ${today}::date), 0)::bigint AS overdue
              FROM erp.ar_invoices
             WHERE outstanding_minor > 0`
      : null,
  ]);

  return {
    draftCount,
    postedThisMonthCount,
    activeAccountCount,
    openPeriods:
      openPeriods?.map((period) => ({
        id: period.id,
        name: period.name,
        status: period.status,
        startDate: isoDateOf(period.startDate),
        endDate: isoDateOf(period.endDate),
      })) ?? null,
    recentJournals: recent?.map(toJournalListItem) ?? null,
    arOutstandingMinor:
      receivables === null ? null : toAmount(BigInt(receivables[0]?.outstanding ?? 0n)),
    arOverdueMinor:
      receivables === null ? null : toAmount(BigInt(receivables[0]?.overdue ?? 0n)),
  };
}
