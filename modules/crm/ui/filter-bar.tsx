"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { controlClasses, type Option } from "@/components/ui/form-controls";
import { cn } from "@/lib/cn";

/**
 * Search and filters for a list, as a plain GET form: the state lives in the URL
 * so a filtered list is shareable and the back button works (§16.4). Selects
 * apply on change; the Apply button keeps it working without JavaScript.
 */

export type FilterSelect = {
  name: string;
  label: string;
  value: string | undefined;
  /** The empty option, e.g. "All sources". */
  allLabel: string;
  options: readonly Option[];
};

export function FilterBar({
  basePath,
  query,
  searchLabel,
  selects = [],
  preserve = {},
}: {
  basePath: string;
  query?: string;
  /** Placeholder for the search box; omit to render no search box. */
  searchLabel?: string;
  selects?: FilterSelect[];
  /** Params kept across a filter change, such as the active status tab. */
  preserve?: Record<string, string | undefined>;
}) {
  const active =
    (query ?? "") !== "" || selects.some((select) => (select.value ?? "") !== "");
  const kept = new URLSearchParams(
    Object.entries(preserve).filter(
      (entry): entry is [string, string] => (entry[1] ?? "") !== "",
    ),
  ).toString();
  const clearHref = kept === "" ? basePath : `${basePath}?${kept}`;

  return (
    <form
      // Remount when the applied filters change: uncontrolled fields read
      // `defaultValue` only on mount, so "Clear" would otherwise leave stale values.
      key={JSON.stringify({
        query,
        values: selects.map((select) => select.value),
        preserve,
      })}
      method="get"
      action={basePath}
      role="search"
      className="mb-3 flex flex-wrap items-center gap-2"
    >
      {Object.entries(preserve).map(([name, value]) =>
        value === undefined || value === "" ? null : (
          <input key={name} type="hidden" name={name} value={value} />
        ),
      )}

      {searchLabel !== undefined && (
        <label className="relative min-w-48 flex-1 sm:max-w-80">
          <span className="sr-only">{searchLabel}</span>
          <Search
            aria-hidden="true"
            size={15}
            className="text-foreground-muted pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2"
          />
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder={searchLabel}
            className={cn(controlClasses, "border-border-strong min-h-9 ps-8")}
          />
        </label>
      )}

      {selects.map((select) => (
        <select
          key={select.name}
          name={select.name}
          aria-label={select.label}
          defaultValue={select.value ?? ""}
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
          className={cn(
            controlClasses,
            "border-border-strong min-h-9 w-auto cursor-pointer",
          )}
        >
          <option value="">{select.allLabel}</option>
          {select.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ))}

      <button
        type="submit"
        className="border-border-strong text-foreground hover:bg-surface-hover min-h-9 cursor-pointer border px-3 text-sm font-extrabold"
      >
        Apply
      </button>
      {active && (
        <Link
          href={clearHref}
          className="text-primary-ink text-sm font-extrabold hover:underline"
        >
          Clear filters
        </Link>
      )}
    </form>
  );
}
