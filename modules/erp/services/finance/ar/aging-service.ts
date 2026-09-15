import { prisma } from "@/lib/prisma";
import { type Actor, requireGlobalPermission } from "@/platform/authz/authz";
import { ERP_PERMISSIONS } from "../../../contracts/permissions";
import { arListParamsSchema } from "../../../contracts/schemas";
import type { AgingReport } from "../../../contracts/types";
import { agingBucketLabels } from "../../../domain/ar";
import { todayIso, toAmount } from "../support";
import {
  customerFrom,
  customerIdsMatching,
  customerRefs,
  loadArSettings,
} from "./support";

/**
 * AR aging (ADR-023): each open invoice's CURRENT outstanding amount, placed by days
 * past its due date as of the chosen date, in the buckets configured in AR settings.
 * Unapplied receipts are shown as a credit. Everything is summed in SQL.
 *
 * Phase 2 limitation, documented: allocations are not dated, so an as-of date in the
 * past ages today's outstanding amounts rather than reconstructing past balances.
 */

const PAGE_SIZE = 25;

/** Bucket boundaries as width_bucket thresholds: [30, 60] → [31, 61]. */
function thresholds(boundaries: readonly number[]): number[] {
  return boundaries.map((boundary) => boundary + 1);
}

/** Per-bucket outstanding amounts for some customers (or all when `ids` is null). */
export async function agingBuckets(
  asOf: string,
  boundaries: readonly number[],
  ids: readonly string[] | null,
): Promise<{ crmAccountId: string; bucket: number; amount: bigint }[]> {
  const rows = await prisma.$queryRaw<
    { crm_account_id: string; bucket: number; amount: bigint }[]
  >`
    SELECT s.crm_account_id, s.bucket, sum(s.outstanding_minor)::bigint AS amount
      FROM (
        SELECT i.crm_account_id, i.outstanding_minor,
               CASE
                 WHEN ${asOf}::date - i.due_date <= 0 THEN 0
                 ELSE 1 + width_bucket(${asOf}::date - i.due_date, ${thresholds(boundaries)}::int[])
               END AS bucket
          FROM erp.ar_invoices i
         WHERE i.status IN ('POSTED', 'PARTIALLY_PAID', 'PAID')
           AND i.outstanding_minor > 0
           AND i.invoice_date <= ${asOf}::date
           AND (${ids}::uuid[] IS NULL OR i.crm_account_id = ANY(${ids}::uuid[]))
      ) s
     GROUP BY s.crm_account_id, s.bucket`;
  return rows.map((row) => ({
    crmAccountId: row.crm_account_id,
    bucket: Number(row.bucket),
    amount: BigInt(row.amount),
  }));
}

export async function getAgingReport(
  actor: Actor,
  rawParams: Record<string, unknown> = {},
): Promise<AgingReport> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AR_AGING_READ);
  const params = arListParamsSchema.parse(rawParams);
  const settings = await loadArSettings();
  const boundaries = settings.agingBucketDays;
  const labels = agingBucketLabels(boundaries);
  const asOf = params.asOf ?? todayIso();
  const filterIds = await customerIdsMatching(params.q);

  const page = await prisma.$queryRaw<
    {
      crm_account_id: string;
      outstanding: bigint;
      unapplied: bigint;
      total: bigint;
      all_outstanding: bigint;
      all_unapplied: bigint;
    }[]
  >`
    WITH open_invoices AS (
      SELECT crm_account_id, sum(outstanding_minor)::bigint AS outstanding
        FROM erp.ar_invoices
       WHERE status IN ('POSTED', 'PARTIALLY_PAID', 'PAID')
         AND outstanding_minor > 0
         AND invoice_date <= ${asOf}::date
       GROUP BY crm_account_id
    ), unapplied_receipts AS (
      SELECT crm_account_id, sum(amount_minor - allocated_minor)::bigint AS unapplied
        FROM erp.ar_receipts
       WHERE status = 'POSTED' AND allocated_minor < amount_minor AND receipt_date <= ${asOf}::date
       GROUP BY crm_account_id
    ), combined AS (
      SELECT coalesce(o.crm_account_id, u.crm_account_id) AS crm_account_id,
             coalesce(o.outstanding, 0)::bigint AS outstanding,
             coalesce(u.unapplied, 0)::bigint AS unapplied
        FROM open_invoices o
        FULL OUTER JOIN unapplied_receipts u ON u.crm_account_id = o.crm_account_id
    )
    SELECT c.crm_account_id, c.outstanding, c.unapplied,
           count(*) OVER () AS total,
           sum(c.outstanding) OVER ()::bigint AS all_outstanding,
           sum(c.unapplied) OVER ()::bigint AS all_unapplied
      FROM combined c
     WHERE (${filterIds}::uuid[] IS NULL OR c.crm_account_id = ANY(${filterIds}::uuid[]))
     ORDER BY c.outstanding - c.unapplied DESC, c.crm_account_id
     LIMIT ${PAGE_SIZE} OFFSET ${(params.page - 1) * PAGE_SIZE}`;

  const ids = page.map((row) => row.crm_account_id);
  const [pageBuckets, totalBuckets, customers] = await Promise.all([
    ids.length === 0 ? Promise.resolve([]) : agingBuckets(asOf, boundaries, ids),
    agingBuckets(asOf, boundaries, filterIds),
    customerRefs(ids),
  ]);

  const empty = () => labels.map(() => 0n);
  const byCustomer = new Map<string, bigint[]>();
  for (const row of pageBuckets) {
    const buckets = byCustomer.get(row.crmAccountId) ?? empty();
    buckets[row.bucket] = (buckets[row.bucket] ?? 0n) + row.amount;
    byCustomer.set(row.crmAccountId, buckets);
  }
  const totals = empty();
  for (const row of totalBuckets)
    totals[row.bucket] = (totals[row.bucket] ?? 0n) + row.amount;

  const first = page[0];
  const allOutstanding = BigInt(first?.all_outstanding ?? 0n);
  const allUnapplied = BigInt(first?.all_unapplied ?? 0n);

  return {
    asOf,
    bucketLabels: labels,
    rows: page.map((row) => {
      const outstanding = BigInt(row.outstanding);
      const unapplied = BigInt(row.unapplied);
      return {
        customer: customerFrom(customers, row.crm_account_id),
        bucketsMinor: (byCustomer.get(row.crm_account_id) ?? empty()).map(toAmount),
        outstandingMinor: toAmount(outstanding),
        unappliedMinor: toAmount(unapplied),
        balanceMinor: toAmount(outstanding - unapplied),
      };
    }),
    total: Number(first?.total ?? 0),
    page: params.page,
    pageSize: PAGE_SIZE,
    totals: {
      bucketsMinor: totals.map(toAmount),
      outstandingMinor: toAmount(allOutstanding),
      unappliedMinor: toAmount(allUnapplied),
      balanceMinor: toAmount(allOutstanding - allUnapplied),
    },
  };
}
