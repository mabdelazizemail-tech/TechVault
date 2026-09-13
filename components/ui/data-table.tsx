import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { EmptyState } from "./primitives";

/**
 * The enterprise table primitive (CLAUDE.md §17.3).
 *
 * One table component used everywhere, so every list screen in every module
 * behaves identically. Deliberate properties:
 *
 *  - Pagination and sorting are expressed as URL state, so a filtered view is
 *    shareable and the back button works (§16.4). They are applied by the
 *    database query, never by slicing an array in the browser (§21).
 *  - It is a Server Component: a list of rows needs no client JavaScript.
 *  - Wide content scrolls inside its own container; the page never scrolls
 *    sideways.
 *  - Numeric columns use tabular figures so digits line up down the column.
 */

export type Column<TRow> = {
  /** Stable key, also used as the `sort` URL value when sortable. */
  key: string;
  header: string;
  /** Renders the cell. Keep it presentational — no data fetching. */
  cell: (row: TRow) => ReactNode;
  sortable?: boolean;
  align?: "start" | "end";
  /** Hides the column below the `md` breakpoint (§16.7). */
  hideOnMobile?: boolean;
  width?: string;
};

export type SortState = {
  key: string;
  direction: "asc" | "desc";
};

export type PageState = {
  /** 1-based. */
  page: number;
  pageSize: number;
  /** Total matching rows, from a `count` query. */
  total: number;
};

export type DataTableProps<TRow> = {
  columns: readonly Column<TRow>[];
  rows: readonly TRow[];
  rowKey: (row: TRow) => string;
  /** Base path for sort and pagination links, e.g. "/admin/users". */
  basePath: string;
  /** Current query string values to preserve across sort and page links. */
  searchParams?: Record<string, string | undefined>;
  sort?: SortState;
  page?: PageState;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  /** Rendered when a row is clickable; receives the row. */
  rowHref?: (row: TRow) => string;
};

export function DataTable<TRow>({
  columns,
  rows,
  rowKey,
  basePath,
  searchParams = {},
  sort,
  page,
  emptyTitle = "Nothing here yet",
  emptyDescription = "No records match the current filters.",
  emptyAction,
  rowHref,
}: DataTableProps<TRow>) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
      />
    );
  }

  return (
    <div className="flex flex-col">
      {/* Wide tables scroll here, not on the body (§17.3). */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-surface sticky top-0 z-10">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  style={column.width !== undefined ? { width: column.width } : undefined}
                  aria-sort={ariaSortFor(column, sort)}
                  className={cn(
                    "border-border-strong text-foreground-muted border-b-2 px-3 py-2 text-[11px] font-normal tracking-[0.08em] whitespace-nowrap uppercase",
                    column.align === "end" ? "text-end" : "text-start",
                    column.hideOnMobile === true && "hidden md:table-cell",
                  )}
                >
                  {column.sortable === true ? (
                    <SortLink
                      column={column}
                      sort={sort}
                      basePath={basePath}
                      searchParams={searchParams}
                    />
                  ) : (
                    column.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                className="border-border hover:bg-surface-hover border-b last:border-0"
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      "text-foreground px-3 py-2 align-middle",
                      column.align === "end" ? "text-end tabular-nums" : "text-start",
                      column.hideOnMobile === true && "hidden md:table-cell",
                    )}
                  >
                    {rowHref !== undefined && column.key === columns[0]?.key ? (
                      <Link
                        href={rowHref(row)}
                        className="text-foreground font-extrabold underline-offset-3 hover:underline"
                      >
                        {column.cell(row)}
                      </Link>
                    ) : (
                      column.cell(row)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {page !== undefined && (
        <Pagination page={page} basePath={basePath} searchParams={searchParams} />
      )}
    </div>
  );
}

function ariaSortFor<TRow>(
  column: Column<TRow>,
  sort: SortState | undefined,
): "ascending" | "descending" | "none" | undefined {
  if (column.sortable !== true) return undefined;
  if (sort?.key !== column.key) return "none";
  return sort.direction === "asc" ? "ascending" : "descending";
}

function buildQuery(
  searchParams: Record<string, string | undefined>,
  overrides: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...searchParams, ...overrides })) {
    if (value !== undefined && value !== "") params.set(key, value);
  }
  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}

function SortLink<TRow>({
  column,
  sort,
  basePath,
  searchParams,
}: {
  column: Column<TRow>;
  sort: SortState | undefined;
  basePath: string;
  searchParams: Record<string, string | undefined>;
}) {
  const isActive = sort?.key === column.key;
  const nextDirection = isActive && sort.direction === "asc" ? "desc" : "asc";

  return (
    <Link
      href={`${basePath}${buildQuery(searchParams, {
        sort: column.key,
        dir: nextDirection,
        // Changing the sort returns to the first page; staying on page 7 of a
        // re-sorted list shows the user an arbitrary window.
        page: undefined,
      })}`}
      className="hover:text-foreground inline-flex items-center gap-1"
    >
      {column.header}
      <span aria-hidden="true" className="text-foreground-subtle">
        {isActive ? (sort.direction === "asc" ? "▲" : "▼") : "↕"}
      </span>
    </Link>
  );
}

function Pagination({
  page,
  basePath,
  searchParams,
}: {
  page: PageState;
  basePath: string;
  searchParams: Record<string, string | undefined>;
}) {
  const lastPage = Math.max(1, Math.ceil(page.total / page.pageSize));
  const firstRow = page.total === 0 ? 0 : (page.page - 1) * page.pageSize + 1;
  const lastRow = Math.min(page.page * page.pageSize, page.total);

  return (
    <nav
      aria-label="Pagination"
      className="border-border-strong text-foreground-muted flex items-center justify-between gap-4 border-t-2 px-3 py-2 text-xs"
    >
      <span>
        {firstRow}–{lastRow} of {page.total}
      </span>
      <span className="flex items-center gap-1">
        <PageLink
          label="Previous"
          targetPage={page.page - 1}
          disabled={page.page <= 1}
          basePath={basePath}
          searchParams={searchParams}
        />
        <span className="px-2">
          Page {page.page} of {lastPage}
        </span>
        <PageLink
          label="Next"
          targetPage={page.page + 1}
          disabled={page.page >= lastPage}
          basePath={basePath}
          searchParams={searchParams}
        />
      </span>
    </nav>
  );
}

function PageLink({
  label,
  targetPage,
  disabled,
  basePath,
  searchParams,
}: {
  label: string;
  targetPage: number;
  disabled: boolean;
  basePath: string;
  searchParams: Record<string, string | undefined>;
}) {
  if (disabled) {
    return (
      <span aria-disabled="true" className="px-2 py-1 opacity-45">
        {label}
      </span>
    );
  }

  return (
    <Link
      href={`${basePath}${buildQuery(searchParams, { page: String(targetPage) })}`}
      className="text-primary-ink hover:bg-primary/10 px-2 py-1 font-extrabold"
    >
      {label}
    </Link>
  );
}
