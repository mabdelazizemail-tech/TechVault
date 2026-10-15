import { ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { BreadcrumbTitle } from "@/components/shell/breadcrumbs";
import { EmptyState, Panel, PanelHeader } from "@/components/ui/primitives";
import { getExpense } from "@/modules/committees/contracts/service";
import {
  EXPENSE_CATEGORY_LABELS,
  formatExpenseAmount,
  formatRate,
} from "@/modules/committees/domain/expenses";
import {
  formatCalendarDate,
  formatDate,
  formatDateTime,
} from "@/modules/committees/domain/format";
import {
  CATEGORY_ICONS,
  ExpenseStatusBadge,
} from "@/modules/committees/ui/expense-badges";
import {
  DeleteExpenseButton,
  ExpenseReview,
} from "@/modules/committees/ui/expense-review";
import { orNotFound } from "@/modules/committees/ui/page-helpers";
import { getActor } from "@/platform/auth/current-user";
import { EXCHANGE_RATE_ATTRIBUTION } from "@/platform/integrations/exchange-rates";

export const metadata: Metadata = { title: "Expense" };

/** One claim: what, how much, the receipt picture, and its review. */
export default async function ExpensePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await getActor();
  const expense = await orNotFound(getExpense(actor, id));
  const amount = formatExpenseAmount(expense.amountMinor, expense.currency);
  const category = EXPENSE_CATEGORY_LABELS[expense.category];
  const Icon = CATEGORY_ICONS[expense.category];
  const receiptUrl = `/committees/expenses/${expense.id}/receipt`;
  const label = `${category} ${amount} on ${expense.mission.name} by ${expense.submitter.name}`;

  return (
    <div className="mx-auto max-w-4xl">
      <BreadcrumbTitle segment={expense.id} label={`${category} · ${amount}`} />

      <div className="flex flex-wrap items-start gap-3 pb-4">
        <Icon aria-hidden="true" className="text-foreground-muted mt-1.5 size-6" />
        <div className="min-w-0 flex-1">
          <p className="label-caps">
            <span dir="auto">{expense.mission.name}</span> · {category}
          </p>
          <h1 className="text-foreground mt-1 text-[28px] leading-tight font-bold tabular-nums">
            {amount}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <ExpenseStatusBadge status={expense.status} />
          {expense.canDelete && (
            <DeleteExpenseButton
              expenseId={expense.id}
              label={label}
              submitter={expense.submitter.name}
            />
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Panel className="overflow-hidden lg:col-span-3">
          <PanelHeader
            title="Invoice / receipt"
            actions={
              expense.receipt !== null && (
                <a
                  href={receiptUrl}
                  target="_blank"
                  rel="noopener"
                  className="text-primary-ink inline-flex items-center gap-1 text-xs font-bold hover:underline"
                >
                  Open full size
                  <ExternalLink aria-hidden="true" className="size-3.5" />
                </a>
              )
            }
          />
          {expense.receipt === null ? (
            <EmptyState
              title="No receipt attached"
              description="This expense was submitted without a picture of its invoice or receipt."
            />
          ) : (
            <div className="bg-surface-sunken p-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- served through an authorised, expiring redirect, which next/image cannot optimise */}
              <img
                src={receiptUrl}
                alt={`Receipt for ${category} ${amount}`}
                className="mx-auto max-h-[70dvh] w-full object-contain"
              />
            </div>
          )}
        </Panel>

        <div className="flex flex-col gap-4 lg:col-span-2">
          <Panel className="overflow-hidden">
            <PanelHeader title="Details" />
            <dl className="divide-border divide-y text-sm">
              <Fact label="Mission">
                <span dir="auto">{expense.mission.name}</span>
              </Fact>
              <Fact label="Category">{category}</Fact>
              {expense.description !== null && (
                <Fact label={expense.category === "OTHER" ? "Description" : "Notes"}>
                  <span dir="auto" className="whitespace-pre-line">
                    {expense.description}
                  </span>
                </Fact>
              )}
              <Fact label="Expense date">{formatCalendarDate(expense.expenseDate)}</Fact>
              <Fact label="Amount">
                <span className="font-semibold tabular-nums">{amount}</span>
              </Fact>
              {expense.currency !== "USD" && (
                <Fact label="In USD">
                  {expense.usd === null ? (
                    <span className="text-foreground-muted">
                      Waiting for an exchange rate
                    </span>
                  ) : (
                    <>
                      <span className="font-semibold tabular-nums">
                        {formatExpenseAmount(expense.usd.amountMinor, "USD")}
                      </span>
                      <span className="text-foreground-muted block text-xs">
                        At {formatRate(expense.usd.rate)} {expense.currency} per USD, the
                        rate of {formatDate(expense.usd.rateAt)}
                        {expense.usd.timing === "submission"
                          ? ", taken when it was submitted."
                          : `, taken on ${formatDate(expense.usd.convertedAt)} because no rate was available when it was submitted.`}{" "}
                        <a
                          href={EXCHANGE_RATE_ATTRIBUTION.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline"
                        >
                          {EXCHANGE_RATE_ATTRIBUTION.label}
                        </a>
                      </span>
                    </>
                  )}
                </Fact>
              )}
              <Fact label="Submitted by">
                <span dir="auto">{expense.submitter.name}</span>
              </Fact>
              <Fact label="Submitted">{formatDateTime(expense.submittedAt)}</Fact>
              <Fact label="Status">
                <ExpenseStatusBadge status={expense.status} />
              </Fact>
              {expense.reviewer !== null && expense.reviewedAt !== null && (
                <Fact
                  label={expense.status === "APPROVED" ? "Approved by" : "Rejected by"}
                >
                  <span dir="auto">{expense.reviewer.name}</span>
                  <span className="text-foreground-muted block text-xs">
                    {formatDateTime(expense.reviewedAt)}
                  </span>
                </Fact>
              )}
              {expense.reviewNote !== null && (
                <Fact label="Review note">
                  <span dir="auto" className="whitespace-pre-line">
                    {expense.reviewNote}
                  </span>
                </Fact>
              )}
            </dl>
          </Panel>

          {expense.canReview && (
            <Panel className="overflow-hidden">
              <PanelHeader title="Review" />
              <div className="px-4 py-4">
                <ExpenseReview expenseId={expense.id} label={label} />
              </div>
            </Panel>
          )}

          <Link
            href="/committees/expenses"
            className="text-primary-ink text-sm font-bold hover:underline"
          >
            ← All expenses
          </Link>
        </div>
      </div>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3 px-4 py-2.5">
      <dt className="text-foreground-muted text-xs">{label}</dt>
      <dd className="text-foreground min-w-0">{children}</dd>
    </div>
  );
}
