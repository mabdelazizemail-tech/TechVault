import type { MoneyTotal, PipelineSummary as Summary } from "../contracts/types";
import { formatMoney } from "./format";

/**
 * Pipeline Overview: open, weighted, won and lost this month. Each figure lists
 * one line per currency present — EGP and USD are never added together.
 */
export function PipelineSummary({ summary }: { summary: Summary }) {
  return (
    <section
      aria-label="Pipeline overview"
      className="bg-border border-border mb-4 grid grid-cols-2 gap-px border lg:grid-cols-4"
    >
      <Figure
        label="Total pipeline"
        note={`${summary.openCount} open`}
        totals={summary.open}
      />
      <Figure label="Weighted pipeline" note="By probability" totals={summary.weighted} />
      <Figure label="Won this month" totals={summary.wonThisMonth} tone="success" />
      <Figure label="Lost this month" totals={summary.lostThisMonth} tone="danger" />
    </section>
  );
}

function Figure({
  label,
  note,
  totals,
  tone,
}: {
  label: string;
  note?: string;
  totals: MoneyTotal[];
  tone?: "success" | "danger";
}) {
  const valueClass =
    tone === "success"
      ? "text-success"
      : tone === "danger"
        ? "text-danger"
        : "text-foreground";
  return (
    <div className="bg-surface flex min-w-0 flex-col gap-1 px-4 py-3">
      <p className="text-foreground-muted text-[10.5px] tracking-[0.08em] uppercase">
        {label}
      </p>
      {totals.length === 0 ? (
        <p className="text-foreground-subtle text-xl font-extrabold">—</p>
      ) : (
        totals.map((total) => (
          <p
            key={total.currency}
            className={`truncate text-xl leading-tight font-extrabold tracking-[-0.02em] tabular-nums ${valueClass}`}
          >
            {formatMoney(total.amountMinor, total.currency)}
          </p>
        ))
      )}
      {note !== undefined && <p className="text-foreground-subtle text-[11px]">{note}</p>}
    </div>
  );
}
