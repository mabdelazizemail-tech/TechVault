"use client";

import Link from "next/link";
import { Search, SlidersHorizontal } from "lucide-react";
import { controlClasses } from "@/components/ui/form-controls";
import { cn } from "@/lib/cn";
import {
  CRM_CURRENCIES,
  INDUSTRIES,
  LEAD_SOURCES,
  LEAD_SOURCE_LABELS,
  SALES_CHANNELS,
  SALES_CHANNEL_LABELS,
  type StageDto,
} from "../contracts/types";

/**
 * Pipeline filters as a plain GET form: filters live in the URL, so a filtered
 * board is shareable and the back button works (§16.4). Selects apply on change;
 * the form still works with JavaScript disabled.
 */

export type FilterValues = Partial<
  Record<
    | "q"
    | "ownerId"
    | "stageId"
    | "currency"
    | "channel"
    | "industry"
    | "source"
    | "minAmount"
    | "maxAmount"
    | "closeFrom"
    | "closeTo"
    | "view",
    string
  >
>;

const MORE_KEYS = [
  "industry",
  "source",
  "minAmount",
  "maxAmount",
  "closeFrom",
  "closeTo",
] as const;

export function PipelineFilters({
  values,
  owners,
  stages,
  basePath,
}: {
  values: FilterValues;
  owners: { id: string; name: string }[];
  stages: StageDto[];
  basePath: string;
}) {
  const activeCount = [
    "q",
    "ownerId",
    "stageId",
    "currency",
    "channel",
    ...MORE_KEYS,
  ].filter((key) => (values[key as keyof FilterValues] ?? "") !== "").length;
  const moreActive = MORE_KEYS.some((key) => (values[key] ?? "") !== "");
  const submitOnChange = (event: { currentTarget: { form: HTMLFormElement | null } }) =>
    event.currentTarget.form?.requestSubmit();

  const select = "min-h-9 w-auto min-w-0 cursor-pointer border-border-strong";

  return (
    // Keyed by the applied values: uncontrolled fields only read `defaultValue` on
    // mount, so "Clear filters" must remount the form or the old values linger.
    <form
      key={JSON.stringify(values)}
      method="get"
      action={basePath}
      className="mb-4 flex flex-col gap-2"
      role="search"
    >
      {values.view !== undefined && (
        <input type="hidden" name="view" value={values.view} />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-48 flex-1 sm:max-w-72">
          <span className="sr-only">Search opportunities</span>
          <Search
            aria-hidden="true"
            size={15}
            className="text-foreground-muted pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2"
          />
          <input
            type="search"
            name="q"
            defaultValue={values.q}
            placeholder="Search deals, companies, partners…"
            className={cn(controlClasses, "border-border-strong min-h-9 ps-8")}
          />
        </label>

        <select
          name="ownerId"
          aria-label="Owner"
          defaultValue={values.ownerId ?? ""}
          onChange={submitOnChange}
          className={cn(controlClasses, select)}
        >
          <option value="">All owners</option>
          {owners.map((owner) => (
            <option key={owner.id} value={owner.id}>
              {owner.name}
            </option>
          ))}
        </select>

        <select
          name="stageId"
          aria-label="Stage"
          defaultValue={values.stageId ?? ""}
          onChange={submitOnChange}
          className={cn(controlClasses, select)}
        >
          <option value="">All stages</option>
          {stages.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {stage.name}
            </option>
          ))}
        </select>

        <select
          name="currency"
          aria-label="Currency"
          defaultValue={values.currency ?? ""}
          onChange={submitOnChange}
          className={cn(controlClasses, select)}
        >
          <option value="">All currencies</option>
          {CRM_CURRENCIES.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>

        <select
          name="channel"
          aria-label="Channel"
          defaultValue={values.channel ?? ""}
          onChange={submitOnChange}
          className={cn(controlClasses, select)}
        >
          <option value="">All channels</option>
          {SALES_CHANNELS.map((channel) => (
            <option key={channel} value={channel}>
              {SALES_CHANNEL_LABELS[channel]}
            </option>
          ))}
        </select>

        <button
          type="submit"
          className="border-border-strong text-foreground hover:bg-surface-hover min-h-9 cursor-pointer border px-3 text-sm font-extrabold"
        >
          Apply
        </button>
        {activeCount > 0 && (
          <Link
            href={
              values.view !== undefined ? `${basePath}?view=${values.view}` : basePath
            }
            className="text-primary-ink text-sm font-extrabold hover:underline"
          >
            Clear {activeCount} {activeCount === 1 ? "filter" : "filters"}
          </Link>
        )}
      </div>

      <details open={moreActive} className="group">
        <summary className="text-foreground-muted hover:text-foreground inline-flex cursor-pointer items-center gap-1.5 text-xs select-none">
          <SlidersHorizontal aria-hidden="true" size={13} />
          More filters
        </summary>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-foreground-muted">Industry</span>
            <select
              name="industry"
              defaultValue={values.industry ?? ""}
              onChange={submitOnChange}
              className={cn(controlClasses, select)}
            >
              <option value="">Any industry</option>
              {INDUSTRIES.map((industry) => (
                <option key={industry} value={industry}>
                  {industry}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-foreground-muted">Lead source</span>
            <select
              name="source"
              defaultValue={values.source ?? ""}
              onChange={submitOnChange}
              className={cn(controlClasses, select)}
            >
              <option value="">Any source</option>
              {LEAD_SOURCES.map((source) => (
                <option key={source} value={source}>
                  {LEAD_SOURCE_LABELS[source]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-foreground-muted">Amount from</span>
            <input
              type="number"
              name="minAmount"
              min={0}
              inputMode="decimal"
              defaultValue={values.minAmount}
              className={cn(controlClasses, "border-border-strong min-h-9 w-32")}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-foreground-muted">Amount to</span>
            <input
              type="number"
              name="maxAmount"
              min={0}
              inputMode="decimal"
              defaultValue={values.maxAmount}
              className={cn(controlClasses, "border-border-strong min-h-9 w-32")}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-foreground-muted">Close from</span>
            <input
              type="date"
              name="closeFrom"
              defaultValue={values.closeFrom}
              className={cn(controlClasses, "border-border-strong min-h-9 w-40")}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-foreground-muted">Close to</span>
            <input
              type="date"
              name="closeTo"
              defaultValue={values.closeTo}
              className={cn(controlClasses, "border-border-strong min-h-9 w-40")}
            />
          </label>
          <p className="text-foreground-subtle basis-full text-[11px]">
            Amounts compare in each deal&apos;s own currency.
          </p>
        </div>
      </details>
    </form>
  );
}
