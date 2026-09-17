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
 *  - Below `md` it becomes a card list (§16.7): the first column is the card's
 *    title and every other column a labelled line, with sorting offered as links.
 *    Both layouts are server-rendered and switched by CSS, so there is no
 *    device detection and nothing to hydrate. Tables with row selection keep the
 *    scrolling table on phones, because a second set of checkboxes would submit
 *    each selected row twice.
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
  /** Hides the column below the `md` breakpoint, in the table and the cards (§16.7). */
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
  /**
   * Row selection for bulk actions. Each checkbox joins the caller's
   * `<form id={formId}>` through the `form` attribute, so the table stays a Server
   * Component and the bulk-action form reads the selection from its own FormData.
   */
  selection?: { formId: string; name: string; rowLabel: (row: TRow) => string };
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
  selection,
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

  const cards = selection === undefined;

  return (
    <div className="flex flex-col">
      {cards && (
        <CardList
          columns={columns}
          rows={rows}
          rowKey={rowKey}
          rowHref={rowHref}
          sort={sort}
          basePath={basePath}
          searchParams={searchParams}
        />
      )}
      {/* Wide tables scroll here, not on the body (§17.3). */}
      <div className={cn("overflow-x-auto", cards && "hidden md:block")}>
        <table className="w-full border-collapse text-sm">
          <thead className="bg-surface sticky top-0 z-10">
            <tr>
              {selection !== undefined && (
                <th scope="col" className="border-border w-10 border-b-2 px-4 py-2.5">
                  <input
                    type="checkbox"
                    aria-label="Select all rows on this page"
                    data-select-all={selection.formId}
                    className="accent-primary size-4 cursor-pointer align-middle"
                  />
                </th>
              )}
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  style={column.width !== undefined ? { width: column.width } : undefined}
                  aria-sort={ariaSortFor(column, sort)}
                  className={cn(
                    "border-border label-caps border-b-2 px-4 py-2.5 whitespace-nowrap",
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
                {selection !== undefined && (
                  <td className="px-4 py-3 align-middle">
                    <input
                      type="checkbox"
                      form={selection.formId}
                      name={selection.name}
                      value={rowKey(row)}
                      aria-label={`Select ${selection.rowLabel(row)}`}
                      className="accent-primary size-4 cursor-pointer align-middle"
                    />
                  </td>
                )}
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      "text-foreground px-4 py-3 align-middle",
                      column.align === "end" ? "text-end tabular-nums" : "text-start",
                      column.hideOnMobile === true && "hidden md:table-cell",
                    )}
                  >
                    {rowHref !== undefined && column.key === columns[0]?.key ? (
                      <Link
                        href={rowHref(row)}
                        className="text-foreground font-semibold underline-offset-3 hover:underline"
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

/**
 * The phone layout: one card per row. The first column is the title (linked when
 * rows are), and each remaining column a label and value; columns hidden on mobile
 * stay hidden here too.
 */
function CardList<TRow>({
  columns,
  rows,
  rowKey,
  rowHref,
  sort,
  basePath,
  searchParams,
}: {
  columns: readonly Column<TRow>[];
  rows: readonly TRow[];
  rowKey: (row: TRow) => string;
  rowHref?: (row: TRow) => string;
  sort?: SortState;
  basePath: string;
  searchParams: Record<string, string | undefined>;
}) {
  const [first, ...rest] = columns;
  if (first === undefined) return null;
  const details = rest.filter((column) => column.hideOnMobile !== true);
  const sortable = columns.filter((column) => column.sortable === true);

  return (
    <div className="md:hidden">
      {sortable.length > 0 && (
        <nav
          aria-label="Sort"
          className="rule-b text-foreground-muted flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-xs"
        >
          <span className="label-caps">Sort</span>
          {sortable.map((column) => (
            <SortLink
              key={column.key}
              column={column}
              sort={sort}
              basePath={basePath}
              searchParams={searchParams}
            />
          ))}
        </nav>
      )}
      <ul>
        {rows.map((row) => (
          <li
            key={rowKey(row)}
            className="border-border border-b px-4 py-3 last:border-0"
          >
            <div className="text-foreground min-w-0 text-[15px] font-semibold break-words">
              {rowHref !== undefined ? (
                <Link
                  href={rowHref(row)}
                  className="-my-1 block py-1 underline-offset-3 hover:underline"
                >
                  {first.cell(row)}
                </Link>
              ) : (
                first.cell(row)
              )}
            </div>
            {details.length > 0 && (
              <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1.5 text-sm">
                {details.map((column) => (
                  <div key={column.key} className="contents">
                    <dt className="text-foreground-muted text-xs">{column.header}</dt>
                    <dd
                      className={cn(
                        "text-foreground min-w-0 text-end break-words",
                        column.align === "end" && "tabular-nums",
                      )}
                    >
                      {column.cell(row)}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        ))}
      </ul>
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

/** Pagination links as URL state; also used by lists that are not tables. */
export function Pagination({
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
      className="rule-t text-foreground-muted flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5 text-xs"
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
      <span
        aria-disabled="true"
        className="border-border inline-flex items-center border-2 px-2.5 py-1 font-bold opacity-45 pointer-coarse:min-h-11 pointer-coarse:px-4"
      >
        {label}
      </span>
    );
  }

  return (
    <Link
      href={`${basePath}${buildQuery(searchParams, { page: String(targetPage) })}`}
      className="border-border text-foreground hover:bg-surface-hover inline-flex items-center border-2 px-2.5 py-1 font-bold pointer-coarse:min-h-11 pointer-coarse:px-4"
    >
      {label}
    </Link>
  );
}
