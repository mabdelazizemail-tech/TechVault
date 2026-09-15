import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { BreadcrumbTitle } from "@/components/shell/breadcrumbs";
import { Pagination } from "@/components/ui/data-table";
import {
  EmptyState,
  PageHeader,
  Panel,
  PanelHeader,
  StatCard,
} from "@/components/ui/primitives";
import { ERP_PERMISSIONS } from "@/modules/erp/contracts/permissions";
import {
  getAccount,
  listAccountActivity,
  listAccountOptions,
} from "@/modules/erp/contracts/service";
import {
  ACCOUNT_TYPE_LABELS,
  NORMAL_BALANCE_LABELS,
} from "@/modules/erp/contracts/types";
import { AccountActiveButton, AccountFormButton } from "@/modules/erp/ui/account-forms";
import { ActiveBadge, JournalStatusBadge } from "@/modules/erp/ui/badges";
import { formatAmount, formatAmountOrBlank, formatDate } from "@/modules/erp/ui/format";
import { flatParams, orNotFound } from "@/modules/erp/ui/page-helpers";
import { getActor } from "@/platform/auth/current-user";
import { canAllGlobally } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "Account" };

/** One account: what it is, its posted totals, and its activity. */
export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = flatParams(await searchParams);
  const actor = await getActor();
  const [account, rights] = await Promise.all([
    orNotFound(getAccount(actor, id)),
    canAllGlobally(actor, [
      ERP_PERMISSIONS.ACCOUNT_UPDATE,
      ERP_PERMISSIONS.ACCOUNT_ADMINISTER,
      ERP_PERMISSIONS.JOURNAL_READ,
    ]),
  ]);
  const canUpdate = rights[ERP_PERMISSIONS.ACCOUNT_UPDATE] === true;
  const [headings, activity] = await Promise.all([
    canUpdate ? listAccountOptions(actor, { postable: false }) : Promise.resolve([]),
    rights[ERP_PERMISSIONS.JOURNAL_READ] === true
      ? listAccountActivity(actor, id, query)
      : Promise.resolve(null),
  ]);
  const base = `/erp/finance/accounts/${id}`;

  return (
    <div>
      <BreadcrumbTitle segment={id} label={`${account.code} ${account.name}`} />
      <PageHeader
        title={`${account.code} · ${account.name}`}
        description={`${ACCOUNT_TYPE_LABELS[account.type]} account · normal balance ${NORMAL_BALANCE_LABELS[account.normalBalance].toLowerCase()}${account.isPostable ? "" : " · heading"}`}
        actions={
          <>
            {canUpdate && (
              <AccountFormButton
                headings={headings}
                account={{
                  id: account.id,
                  code: account.code,
                  name: account.name,
                  nameAr: account.nameAr,
                  type: account.type,
                  normalBalance: account.normalBalance,
                  parentId: account.parentId,
                  isPostable: account.isPostable,
                  description: account.description,
                  hasPostings: account.hasPostings,
                }}
              />
            )}
            {rights[ERP_PERMISSIONS.ACCOUNT_ADMINISTER] === true && (
              <AccountActiveButton
                accountId={account.id}
                code={account.code}
                isActive={account.isActive}
              />
            )}
          </>
        }
      />

      <section aria-label="Totals" className="mb-4 grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Total debits"
          value={formatAmount(account.totals.debitMinor)}
          note="Posted, EGP"
        />
        <StatCard
          label="Total credits"
          value={formatAmount(account.totals.creditMinor)}
          note="Posted, EGP"
        />
        <StatCard
          label="Balance"
          value={formatAmount(account.totals.balanceMinor)}
          note={`On the ${NORMAL_BALANCE_LABELS[account.normalBalance].toLowerCase()} side`}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel>
          <PanelHeader title="Details" />
          <dl>
            <Fact label="Status">
              <ActiveBadge isActive={account.isActive} />
            </Fact>
            <Fact label="Type">{ACCOUNT_TYPE_LABELS[account.type]}</Fact>
            <Fact label="Takes postings">
              {account.isPostable ? "Yes" : "No — heading"}
            </Fact>
            <Fact label="Parent">
              {account.parent === null ? (
                "—"
              ) : (
                <Link
                  href={`/erp/finance/accounts/${account.parent.id}`}
                  className="hover:underline"
                >
                  {account.parent.code} {account.parent.name}
                </Link>
              )}
            </Fact>
            <Fact label="Sub-accounts">{account.childCount}</Fact>
            <Fact label="Arabic name">
              {account.nameAr === null ? (
                "—"
              ) : (
                <span dir="rtl" lang="ar">
                  {account.nameAr}
                </span>
              )}
            </Fact>
          </dl>
          {account.description !== null && (
            <p dir="auto" className="text-foreground-muted rule-t px-4 py-3 text-sm">
              {account.description}
            </p>
          )}
        </Panel>

        {activity !== null && (
          <Panel className="overflow-hidden lg:col-span-2">
            <PanelHeader
              title="Activity"
              description="Posted lines on this account, newest first."
            />
            <form
              method="get"
              action={base}
              className="flex flex-wrap items-end gap-2 px-4 pt-3"
            >
              <label className="flex flex-col gap-1 text-xs font-semibold">
                From
                <input
                  type="date"
                  name="from"
                  defaultValue={query.from}
                  className="border-border-strong bg-surface min-h-9 border-2 px-2 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold">
                To
                <input
                  type="date"
                  name="to"
                  defaultValue={query.to}
                  className="border-border-strong bg-surface min-h-9 border-2 px-2 text-sm"
                />
              </label>
              <button
                type="submit"
                className="border-border bg-surface hover:bg-surface-hover min-h-9 cursor-pointer border-2 px-3 text-sm font-bold"
              >
                Apply
              </button>
            </form>
            {activity.rows.length === 0 ? (
              <EmptyState
                title="No posted activity"
                description="Posted journal lines on this account appear here."
              />
            ) : (
              <>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr>
                        <Th>Date</Th>
                        <Th>Entry</Th>
                        <Th>Description</Th>
                        <Th end>Debit</Th>
                        <Th end>Credit</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {activity.rows.map((line) => (
                        <tr key={line.lineId} className="border-border border-b">
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            {formatDate(line.entryDate)}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <Link
                              href={`/erp/finance/journals/${line.entryId}`}
                              className="font-semibold hover:underline"
                            >
                              {line.journalNumber}
                            </Link>
                            {line.entryStatus === "REVERSED" && (
                              <span className="ms-2">
                                <JournalStatusBadge status={line.entryStatus} />
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5">
                            <span dir="auto">{line.description}</span>
                            {line.costCentre !== null && (
                              <span className="text-foreground-muted block text-xs">
                                {line.costCentre.code} {line.costCentre.name}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-end tabular-nums" dir="ltr">
                            {formatAmountOrBlank(line.debitMinor)}
                          </td>
                          <td className="px-4 py-2.5 text-end tabular-nums" dir="ltr">
                            {formatAmountOrBlank(line.creditMinor)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="rule-t font-bold">
                        <td colSpan={3} className="px-4 py-2.5">
                          Total for these filters
                        </td>
                        <td className="px-4 py-2.5 text-end tabular-nums" dir="ltr">
                          {formatAmount(activity.totals.debitMinor)}
                        </td>
                        <td className="px-4 py-2.5 text-end tabular-nums" dir="ltr">
                          {formatAmount(activity.totals.creditMinor)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <Pagination
                  page={{
                    page: activity.page,
                    pageSize: activity.pageSize,
                    total: activity.total,
                  }}
                  basePath={base}
                  searchParams={query}
                />
              </>
            )}
          </Panel>
        )}
      </div>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-border flex items-baseline justify-between gap-3 border-b px-4 py-2.5 text-sm last:border-0">
      <dt className="text-foreground-muted shrink-0">{label}</dt>
      <dd className="text-foreground min-w-0 text-end">{children}</dd>
    </div>
  );
}

function Th({ children, end }: { children: ReactNode; end?: boolean }) {
  return (
    <th
      scope="col"
      className={`label-caps border-border border-b-2 px-4 py-2.5 whitespace-nowrap ${end === true ? "text-end" : "text-start"}`}
    >
      {children}
    </th>
  );
}
