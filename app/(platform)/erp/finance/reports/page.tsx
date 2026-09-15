import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ErrorState, PageHeader, Panel } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { ValidationError } from "@/lib/errors";
import {
  getBalanceSheet,
  getProfitAndLoss,
  getTrialBalance,
} from "@/modules/erp/contracts/service";
import { formatDate } from "@/modules/erp/ui/format";
import {
  BalanceBadge,
  BalanceSheetTable,
  ProfitAndLossTable,
  TrialBalanceTable,
} from "@/modules/erp/ui/ledger-reports";
import { flatParams, orNotFound } from "@/modules/erp/ui/page-helpers";
import { getActor } from "@/platform/auth/current-user";

export const metadata: Metadata = { title: "Financial reports" };

const BASE = "/erp/finance/reports";

const VIEWS = [
  { key: "trial-balance", label: "Trial balance" },
  { key: "profit-and-loss", label: "Profit and loss" },
  { key: "balance-sheet", label: "Balance sheet" },
] as const;

type View = (typeof VIEWS)[number]["key"];

type Loaded<T> = { ok: true; data: T } | { ok: false; message: string };

/** A report, or the validation message for dates that cannot be reported on. */
async function load<T>(promise: Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, data: await orNotFound(promise) };
  } catch (error) {
    if (error instanceof ValidationError) return { ok: false, message: error.message };
    throw error;
  }
}

function DateField({
  name,
  label,
  value,
}: {
  name: string;
  label: string;
  value: string | undefined;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-semibold">
      {label}
      <input
        type="date"
        name={name}
        defaultValue={value}
        className="border-border-strong bg-surface min-h-9 border-2 px-2 text-sm"
      />
    </label>
  );
}

/** Trial balance, profit and loss and balance sheet, read from the posted ledger. */
export default async function FinancialReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = flatParams(await searchParams);
  const view: View = VIEWS.some((item) => item.key === params.view)
    ? (params.view as View)
    : "trial-balance";
  const actor = await getActor();

  let description = "";
  let badge: ReactNode = null;
  let fields: ReactNode;
  let body: ReactNode;

  if (view === "trial-balance") {
    const report = await load(getTrialBalance(actor, params));
    fields = (
      <>
        <DateField name="from" label="From (optional)" value={params.from} />
        <DateField name="to" label="To" value={report.ok ? report.data.to : params.to} />
      </>
    );
    if (report.ok) {
      const { from, to } = report.data;
      description = `Posted balances ${from === null ? "from the first posting" : `from ${formatDate(from)}`} to ${formatDate(to)}. Drafts are not included.`;
      badge = <BalanceBadge balanced={report.data.isBalanced} label="Balanced" />;
      body = <TrialBalanceTable report={report.data} />;
    } else {
      body = <ErrorState title="Check the dates" message={report.message} />;
    }
  } else if (view === "profit-and-loss") {
    const report = await load(getProfitAndLoss(actor, params));
    fields = (
      <>
        <DateField
          name="from"
          label="From"
          value={report.ok ? report.data.from : params.from}
        />
        <DateField name="to" label="To" value={report.ok ? report.data.to : params.to} />
      </>
    );
    if (report.ok) {
      description = `Revenue and expenses posted from ${formatDate(report.data.from)} to ${formatDate(report.data.to)}. Without a start date, the calendar year to date.`;
      body = <ProfitAndLossTable report={report.data} />;
    } else {
      body = <ErrorState title="Check the dates" message={report.message} />;
    }
  } else {
    const report = await load(getBalanceSheet(actor, params));
    fields = (
      <DateField
        name="to"
        label="As of"
        value={report.ok ? report.data.asOf : params.to}
      />
    );
    if (report.ok) {
      description = `Assets, liabilities and equity as of ${formatDate(report.data.asOf)}.`;
      badge = <BalanceBadge balanced={report.data.isBalanced} label="Balances" />;
      body = <BalanceSheetTable report={report.data} />;
    } else {
      body = <ErrorState title="Check the date" message={report.message} />;
    }
  }

  return (
    <div>
      <PageHeader title="Financial reports" description={description} actions={badge} />
      <nav
        aria-label="Report"
        className="border-border-strong mb-3 flex gap-5 overflow-x-auto border-b-2"
      >
        {VIEWS.map((item) => {
          const active = item.key === view;
          return (
            <Link
              key={item.key}
              href={`${BASE}?view=${item.key}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-0.5 border-b-2 pb-2 text-[13px] whitespace-nowrap",
                active
                  ? "border-primary text-foreground font-extrabold"
                  : "text-foreground-muted hover:text-foreground border-transparent",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <form method="get" action={BASE} className="mb-3 flex flex-wrap items-end gap-2">
        <input type="hidden" name="view" value={view} />
        {fields}
        <button
          type="submit"
          className="border-border bg-surface hover:bg-surface-hover min-h-9 cursor-pointer border-2 px-3 text-sm font-bold"
        >
          Apply
        </button>
      </form>
      <Panel className="overflow-hidden">{body}</Panel>
      <p className="text-foreground-muted mt-2 text-xs">
        Amounts in EGP. Every posted journal entry is included, whether entered by hand or
        raised by an invoice or receipt.
      </p>
    </div>
  );
}
