import { Paperclip, Plus } from "lucide-react";
import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { COMMITTEES_PERMISSIONS } from "@/modules/committees/contracts/permissions";
import {
  getExpenseTotals,
  listExpenseSubmitters,
  listExpenses,
  listMissionOptions,
} from "@/modules/committees/contracts/service";
import type { ExpenseListItem } from "@/modules/committees/contracts/types";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  EXPENSE_STATUSES,
  EXPENSE_STATUS_LABELS,
  formatExpenseAmount,
} from "@/modules/committees/domain/expenses";
import { formatCalendarDate, formatDate } from "@/modules/committees/domain/format";
import { ExpenseStatusBadge } from "@/modules/committees/ui/expense-badges";
import { flatParams } from "@/modules/committees/ui/page-helpers";
import { getActor } from "@/platform/auth/current-user";
import { EXCHANGE_RATE_ATTRIBUTION } from "@/platform/integrations/exchange-rates";
import { can } from "@/platform/authz/authz";
import { preview } from "@/platform/notifications/rules";

export const metadata: Metadata = { title: "Mission expenses" };

const BASE = "/committees/expenses";

/**
 * Mission expenses: your own claims, or everyone's for an approver — filtered by
 * mission, person, category, status and date, with totals per currency.
 */
export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = flatParams(await searchParams);
  const actor = await getActor();
  const [page, totals, missions, submitters, canSubmit] = await Promise.all([
    listExpenses(actor, params),
    getExpenseTotals(actor, params),
    listMissionOptions(actor, { includeInactive: true }),
    listExpenseSubmitters(actor),
    can(actor, COMMITTEES_PERMISSIONS.EXPENSE_CREATE),
  ]);
  const approver = page.isApprover;

  const columns: Column<ExpenseListItem>[] = [
    {
      key: "expense",
      header: "Expense",
      cell: (expense) => (
        <span className="block max-w-xs">
          {EXPENSE_CATEGORY_LABELS[expense.category]}
          {expense.description !== null && (
            <span dir="auto" className="text-foreground-muted block text-xs font-normal">
              {preview(expense.description, 80)}
            </span>
          )}
        </span>
      ),
    },
    {
      key: "mission",
      header: "Mission",
      cell: (expense) => <span dir="auto">{expense.mission.name}</span>,
    },
    {
      key: "date",
      header: "Expense date",
      cell: (expense) => (
        <span className="whitespace-nowrap">
          {formatCalendarDate(expense.expenseDate)}
        </span>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "end",
      cell: (expense) => (
        <span className="inline-flex flex-col items-end">
          <span className="font-semibold whitespace-nowrap">
            {formatExpenseAmount(expense.amountMinor, expense.currency)}
          </span>
          {expense.currency !== "USD" && (
            <span className="text-foreground-muted text-xs whitespace-nowrap tabular-nums">
              {expense.amountUsdMinor === null
                ? "USD pending"
                : `≈ ${formatExpenseAmount(expense.amountUsdMinor, "USD")}`}
            </span>
          )}
        </span>
      ),
    },
    {
      key: "submitted",
      header: approver ? "Submitted by" : "Submitted",
      hideOnMobile: !approver,
      cell: (expense) => (
        <span className="text-xs whitespace-nowrap">
          {approver && (
            <span dir="auto" className="text-foreground block font-semibold">
              {expense.submitter.name}
            </span>
          )}
          <span className="text-foreground-muted">{formatDate(expense.submittedAt)}</span>
        </span>
      ),
    },
    {
      key: "receipt",
      header: "Receipt",
      cell: (expense) =>
        !expense.hasReceipt ? (
          <span className="text-foreground-muted text-xs">None</span>
        ) : (
          <a
            href={`${BASE}/${expense.id}/receipt`}
            target="_blank"
            rel="noopener"
            className="text-primary-ink inline-flex items-center gap-1 text-xs font-bold hover:underline pointer-coarse:min-h-10"
          >
            <Paperclip aria-hidden="true" className="size-3.5" />
            View
            <span className="sr-only"> the receipt (opens in a new tab)</span>
          </a>
        ),
    },
    {
      key: "status",
      header: "Status",
      cell: (expense) => <ExpenseStatusBadge status={expense.status} />,
    },
  ];

  const kept = {
    mission: params.mission,
    user: params.user,
    category: params.category,
    status: params.status,
    from: params.from,
    to: params.to,
  };

  return (
    <div>
      <PageHeader
        title="Mission expenses"
        description={
          approver
            ? "Everyone's claims on missions. Open one to see its receipt and approve or reject it."
            : "Your expense claims on missions, with their receipts and review status."
        }
        actions={
          canSubmit ? (
            <ButtonLink
              href={`${BASE}/new`}
              variant="primary"
              icon={<Plus aria-hidden="true" size={15} />}
            >
              New expense
            </ButtonLink>
          ) : undefined
        }
      />

      {totals.currencies.length > 0 && (
        <section aria-label="Totals" className="mb-4">
          <p className="label-caps mb-2">
            Totals for these filters · rejected claims left out
          </p>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <li className="panel border-primary p-4">
              <p className="label-caps">All claims in USD</p>
              <p className="text-foreground mt-1 text-2xl font-bold tabular-nums">
                {formatExpenseAmount(totals.usd.claimedMinor, "USD")}
              </p>
              <p className="text-foreground-muted mt-1 text-xs">
                Approved {formatExpenseAmount(totals.usd.approvedMinor, "USD")} · each
                claim at its rate when submitted
                {totals.usd.pendingCount > 0 &&
                  ` · ${totals.usd.pendingCount} not converted yet`}
              </p>
            </li>
            {totals.currencies.map((total) => (
              <li key={total.currency} className="panel p-4">
                <p className="label-caps">{total.currency}</p>
                <p className="text-foreground mt-1 text-2xl font-bold tabular-nums">
                  {formatExpenseAmount(total.claimedMinor, total.currency)}
                </p>
                <p className="text-foreground-muted mt-1 text-xs">
                  {total.count} {total.count === 1 ? "claim" : "claims"} · approved{" "}
                  {formatExpenseAmount(total.approvedMinor, total.currency)}
                </p>
              </li>
            ))}
          </ul>
          {totals.currencies.some((total) => total.currency !== "USD") && (
            <p className="text-foreground-muted mt-2 text-xs">
              <a
                href={EXCHANGE_RATE_ATTRIBUTION.href}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                {EXCHANGE_RATE_ATTRIBUTION.label}
              </a>
            </p>
          )}
        </section>
      )}

      <FilterBar
        basePath={BASE}
        dateRange={{ from: params.from, to: params.to }}
        selects={[
          {
            name: "mission",
            label: "Mission",
            value: params.mission,
            allLabel: "All missions",
            options: missions.map((mission) => ({
              value: mission.id,
              label: mission.name,
            })),
          },
          ...(approver
            ? [
                {
                  name: "user",
                  label: "Submitted by",
                  value: params.user,
                  allLabel: "Everyone",
                  options: submitters.map((person) => ({
                    value: person.id,
                    label: person.name,
                  })),
                },
              ]
            : []),
          {
            name: "category",
            label: "Category",
            value: params.category,
            allLabel: "All categories",
            options: EXPENSE_CATEGORIES.map((category) => ({
              value: category,
              label: EXPENSE_CATEGORY_LABELS[category],
            })),
          },
          {
            name: "status",
            label: "Status",
            value: params.status,
            allLabel: "All statuses",
            options: EXPENSE_STATUSES.map((status) => ({
              value: status,
              label: EXPENSE_STATUS_LABELS[status],
            })),
          },
        ]}
      />

      <Panel>
        <DataTable
          columns={columns}
          rows={page.rows}
          rowKey={(expense) => expense.id}
          rowHref={(expense) => `${BASE}/${expense.id}`}
          basePath={BASE}
          searchParams={kept}
          page={{ page: page.page, pageSize: page.pageSize, total: page.total }}
          emptyTitle={
            page.total === 0 && Object.values(kept).every((v) => v === undefined)
              ? "No expenses yet"
              : "No expenses match"
          }
          emptyDescription={
            canSubmit
              ? "Claim what you paid on a mission — choose the mission and category, enter the amount and, if you have it, take a picture of the receipt."
              : "Expense claims on missions appear here."
          }
          emptyAction={
            canSubmit ? (
              <ButtonLink href={`${BASE}/new`} variant="primary">
                New expense
              </ButtonLink>
            ) : undefined
          }
        />
      </Panel>
    </div>
  );
}
