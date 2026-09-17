import { prisma } from "@/lib/prisma";
import { type Actor, requireGlobalPermission } from "@/platform/authz/authz";
import { ERP_PERMISSIONS } from "../../../contracts/permissions";
import { arListParamsSchema } from "../../../contracts/schemas";
import type { ApAgingReport } from "../../../contracts/types";
import { agingBucketLabels } from "../../../domain/ar";
import { toAmount, todayIso } from "../support";
import { loadApSettings } from "./support";

/**
 * AP aging (ADR-033): each open bill's current outstanding amount, by days past its
 * due date as of the chosen date, in the buckets set in AP settings. Summed in SQL.
 *
 * Like AR aging, an as-of date in the past ages today's outstanding amounts: payment
 * voids after that date still count.
 */

const PAGE_SIZE = 25;

function thresholds(boundaries: readonly number[]): number[] {
  return boundaries.map((boundary) => boundary + 1);
}

/** Per-bucket outstanding amounts for some vendors, or all when `ids` is null. */
export async function apAgingBuckets(
  asOf: string,
  boundaries: readonly number[],
  ids: readonly string[] | null,
): Promise<{ vendorId: string; bucket: number; amount: bigint }[]> {
  const rows = await prisma.$queryRaw<
    { vendor_id: string; bucket: number; amount: bigint }[]
  >`
    SELECT s.vendor_id, s.bucket, sum(s.outstanding_minor)::bigint AS amount
      FROM (
        SELECT b.vendor_id, b.outstanding_minor,
               CASE
                 WHEN ${asOf}::date - b.due_date <= 0 THEN 0
                 ELSE 1 + width_bucket(${asOf}::date - b.due_date, ${thresholds(boundaries)}::int[])
               END AS bucket
          FROM erp.ap_bills b
         WHERE b.status IN ('POSTED', 'PARTIALLY_PAID', 'PAID')
           AND b.outstanding_minor > 0
           AND b.bill_date <= ${asOf}::date
           AND (${ids}::uuid[] IS NULL OR b.vendor_id = ANY(${ids}::uuid[]))
      ) s
     GROUP BY s.vendor_id, s.bucket`;
  return rows.map((row) => ({
    vendorId: row.vendor_id,
    bucket: Number(row.bucket),
    amount: BigInt(row.amount),
  }));
}

export async function getApAgingReport(
  actor: Actor,
  rawParams: Record<string, unknown> = {},
): Promise<ApAgingReport> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AP_AGING_READ);
  const params = arListParamsSchema.parse(rawParams);
  const settings = await loadApSettings();
  const boundaries = settings.agingBucketDays;
  const labels = agingBucketLabels(boundaries);
  const asOf = params.asOf ?? todayIso();
  const q = params.q !== undefined && params.q !== "" ? `%${params.q}%` : null;

  const page = await prisma.$queryRaw<
    {
      vendor_id: string;
      name: string;
      is_active: boolean;
      outstanding: bigint;
      total: bigint;
      all_outstanding: bigint;
    }[]
  >`
    WITH open_bills AS (
      SELECT b.vendor_id, sum(b.outstanding_minor)::bigint AS outstanding
        FROM erp.ap_bills b
       WHERE b.status IN ('POSTED', 'PARTIALLY_PAID', 'PAID')
         AND b.outstanding_minor > 0
         AND b.bill_date <= ${asOf}::date
       GROUP BY b.vendor_id
    )
    SELECT o.vendor_id, v.name, v.is_active, o.outstanding,
           count(*) OVER () AS total,
           sum(o.outstanding) OVER ()::bigint AS all_outstanding
      FROM open_bills o
      JOIN erp.vendors v ON v.id = o.vendor_id
     WHERE (${q}::text IS NULL OR v.name ILIKE ${q} OR v.name_ar ILIKE ${q})
     ORDER BY o.outstanding DESC, v.name
     LIMIT ${PAGE_SIZE} OFFSET ${(params.page - 1) * PAGE_SIZE}`;

  const ids = page.map((row) => row.vendor_id);
  const matching =
    q === null
      ? null
      : (
          await prisma.erpVendor.findMany({
            where: {
              OR: [
                { name: { contains: params.q, mode: "insensitive" } },
                { nameAr: { contains: params.q, mode: "insensitive" } },
              ],
            },
            take: 1000,
            select: { id: true },
          })
        ).map((vendor) => vendor.id);
  const [pageBuckets, totalBuckets] = await Promise.all([
    ids.length === 0 ? Promise.resolve([]) : apAgingBuckets(asOf, boundaries, ids),
    apAgingBuckets(asOf, boundaries, matching),
  ]);

  const empty = () => labels.map(() => 0n);
  const byVendor = new Map<string, bigint[]>();
  for (const row of pageBuckets) {
    const buckets = byVendor.get(row.vendorId) ?? empty();
    buckets[row.bucket] = (buckets[row.bucket] ?? 0n) + row.amount;
    byVendor.set(row.vendorId, buckets);
  }
  const totals = empty();
  for (const row of totalBuckets)
    totals[row.bucket] = (totals[row.bucket] ?? 0n) + row.amount;
  const first = page[0];

  return {
    asOf,
    bucketLabels: labels,
    rows: page.map((row) => ({
      vendor: { id: row.vendor_id, name: row.name, isActive: row.is_active },
      bucketsMinor: (byVendor.get(row.vendor_id) ?? empty()).map(toAmount),
      outstandingMinor: toAmount(BigInt(row.outstanding)),
    })),
    total: Number(first?.total ?? 0),
    page: params.page,
    pageSize: PAGE_SIZE,
    totals: {
      bucketsMinor: totals.map(toAmount),
      outstandingMinor: toAmount(BigInt(first?.all_outstanding ?? 0n)),
    },
  };
}
