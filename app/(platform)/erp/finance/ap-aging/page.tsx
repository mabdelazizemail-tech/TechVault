import type { Metadata } from "next";
import Link from "next/link";
import { Pagination } from "@/components/ui/data-table";
import { EmptyState, PageHeader, Panel } from "@/components/ui/primitives";
import { getApAgingReport } from "@/modules/erp/contracts/service";
import { VendorName } from "@/modules/erp/ui/ap-badges";
import { formatAmount, formatDate } from "@/modules/erp/ui/format";
import { flatParams, orNotFound } from "@/modules/erp/ui/page-helpers";
import { getActor } from "@/platform/auth/current-user";

export const metadata: Metadata = { title: "AP aging" };

const BASE = "/erp/finance/ap-aging";

/** What is owed to vendors, by days past the bills' due dates. */
export default async function ApAgingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = flatParams(await searchParams);
  const actor = await getActor();
  const report = await orNotFound(getApAgingReport(actor, params));

  return (
    <div>
      <PageHeader
        title="AP aging"
        description={`Open bill amounts by days past their due date, as of ${formatDate(report.asOf)}. Buckets are set in AP settings.`}
      />
      <form method="get" action={BASE} className="mb-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs font-semibold">
          As of
          <input
            type="date"
            name="asOf"
            defaultValue={report.asOf}
            className="border-border-strong bg-surface min-h-9 border-2 px-2 text-sm pointer-coarse:min-h-11"
          />
        </label>
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs font-semibold sm:max-w-80">
          Vendor
          <input
            type="search"
            name="q"
            defaultValue={params.q}
            placeholder="Search vendor name…"
            className="border-border-strong bg-surface min-h-9 border-2 px-2 text-sm pointer-coarse:min-h-11"
          />
        </label>
        <button
          type="submit"
          className="border-border bg-surface hover:bg-surface-hover min-h-9 cursor-pointer border-2 px-3 text-sm font-bold pointer-coarse:min-h-11"
        >
          Apply
        </button>
      </form>
      <Panel className="overflow-hidden">
        {report.rows.length === 0 ? (
          <EmptyState
            title="Nothing owed"
            description="Vendors with posted bills still to pay appear here."
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-surface sticky top-0">
                  <tr>
                    <th
                      scope="col"
                      className="label-caps border-border border-b-2 px-4 py-2.5 text-start"
                    >
                      Vendor
                    </th>
                    {report.bucketLabels.map((label) => (
                      <th
                        key={label}
                        scope="col"
                        className="label-caps border-border border-b-2 px-4 py-2.5 text-end whitespace-nowrap"
                      >
                        {label}
                      </th>
                    ))}
                    <th
                      scope="col"
                      className="label-caps border-border border-b-2 px-4 py-2.5 text-end"
                    >
                      Owed
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row) => (
                    <tr
                      key={row.vendor.id}
                      className="border-border hover:bg-surface-hover border-b"
                    >
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/erp/finance/vendors/${row.vendor.id}`}
                          className="font-semibold hover:underline"
                        >
                          <VendorName vendor={row.vendor} />
                        </Link>
                      </td>
                      {row.bucketsMinor.map((amount, index) => (
                        <td
                          key={report.bucketLabels[index]}
                          dir="ltr"
                          className={`px-4 py-2.5 text-end tabular-nums ${index > 0 && amount > 0 ? "text-danger" : ""}`}
                        >
                          {amount === 0 ? "—" : formatAmount(amount)}
                        </td>
                      ))}
                      <td dir="ltr" className="px-4 py-2.5 text-end font-bold tabular-nums">
                        {formatAmount(row.outstandingMinor)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="rule-t font-bold">
                    <td className="px-4 py-2.5">Total</td>
                    {report.totals.bucketsMinor.map((amount, index) => (
                      <td
                        key={report.bucketLabels[index]}
                        dir="ltr"
                        className="px-4 py-2.5 text-end tabular-nums"
                      >
                        {formatAmount(amount)}
                      </td>
                    ))}
                    <td
                      dir="ltr"
                      className="px-4 py-2.5 text-end tabular-nums"
                      data-testid="ap-aging-total"
                    >
                      {formatAmount(report.totals.outstandingMinor)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <Pagination
              page={{ page: report.page, pageSize: report.pageSize, total: report.total }}
              basePath={BASE}
              searchParams={params}
            />
          </>
        )}
      </Panel>
    </div>
  );
}
