import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { BreadcrumbTitle } from "@/components/shell/breadcrumbs";
import { PageHeader, Panel, PanelHeader } from "@/components/ui/primitives";
import { ERP_PERMISSIONS } from "@/modules/erp/contracts/permissions";
import { getJournal } from "@/modules/erp/contracts/service";
import { ACCOUNT_TYPE_LABELS, JOURNAL_KIND_LABELS } from "@/modules/erp/contracts/types";
import { formatMinorAmount } from "@/modules/erp/domain/journal";
import {
  BalanceBadge,
  JournalStatusBadge,
  PeriodStatusBadge,
} from "@/modules/erp/ui/badges";
import {
  formatAmount,
  formatAmountOrBlank,
  formatDate,
  formatDateTime,
  todayInCairo,
} from "@/modules/erp/ui/format";
import { JournalActions } from "@/modules/erp/ui/journal-actions";
import { orNotFound } from "@/modules/erp/ui/page-helpers";
import { getActor } from "@/platform/auth/current-user";
import { canAllGlobally } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "Journal entry" };

export default async function JournalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await getActor();
  const [entry, rights] = await Promise.all([
    orNotFound(getJournal(actor, id)),
    canAllGlobally(actor, [
      ERP_PERMISSIONS.JOURNAL_UPDATE,
      ERP_PERMISSIONS.JOURNAL_DELETE,
      ERP_PERMISSIONS.JOURNAL_POST,
      ERP_PERMISSIONS.JOURNAL_REVERSE,
      ERP_PERMISSIONS.ACCOUNT_READ,
    ]),
  ]);
  const title = entry.journalNumber ?? "Draft journal entry";
  const difference = Math.abs(entry.debitTotalMinor - entry.creditTotalMinor);

  return (
    <div>
      <BreadcrumbTitle segment={id} label={title} />
      <PageHeader
        title={title}
        description={`${formatDate(entry.entryDate)} · ${entry.description}`}
        actions={
          <JournalActions
            entry={{
              id: entry.id,
              status: entry.status,
              journalNumber: entry.journalNumber,
              entryDate: entry.entryDate,
              isReversal: entry.reverses !== null,
              isSourced: entry.source !== null,
              selfPostingBlocked: entry.selfPostingBlocked,
              debitTotalMinor: entry.debitTotalMinor,
              creditTotalMinor: entry.creditTotalMinor,
            }}
            can={{
              update: rights[ERP_PERMISSIONS.JOURNAL_UPDATE] === true,
              delete: rights[ERP_PERMISSIONS.JOURNAL_DELETE] === true,
              post: rights[ERP_PERMISSIONS.JOURNAL_POST] === true,
              reverse: rights[ERP_PERMISSIONS.JOURNAL_REVERSE] === true,
            }}
            today={todayInCairo()}
          />
        }
      />

      {entry.status === "REVERSED" && entry.reversal !== null && (
        <p className="border-warning text-foreground mb-4 border-s-4 px-3 py-2 text-sm">
          Reversed by{" "}
          <Link
            href={`/erp/finance/journals/${entry.reversal.id}`}
            className="font-bold underline"
          >
            {entry.reversal.journalNumber}
          </Link>
          {entry.reversedBy !== null && entry.reversedAt !== null && (
            <>
              {" "}
              — {entry.reversedBy.name}, {formatDateTime(entry.reversedAt)}
            </>
          )}
          .
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel>
          <PanelHeader title="Entry" />
          <dl>
            <Fact label="Status">
              <JournalStatusBadge status={entry.status} />
            </Fact>
            <Fact label="Type">{JOURNAL_KIND_LABELS[entry.kind]}</Fact>
            <Fact label="Date">{formatDate(entry.entryDate)}</Fact>
            <Fact label="Period">
              {entry.period === null ? (
                "Assigned when posted"
              ) : (
                <span className="inline-flex items-center gap-2">
                  <span dir="auto">{entry.period.name}</span>
                  <PeriodStatusBadge status={entry.period.status} />
                </span>
              )}
            </Fact>
            <Fact label="Reference">
              {entry.reference === null ? "—" : <span dir="auto">{entry.reference}</span>}
            </Fact>
            {entry.source !== null &&
              (entry.source.type === "ar_invoice" ||
                entry.source.type === "ar_receipt") && (
                <Fact label="Posted from">
                  <Link
                    href={`/erp/finance/${entry.source.type === "ar_invoice" ? "invoices" : "receipts"}/${entry.source.id}`}
                    className="font-bold hover:underline"
                  >
                    {entry.source.type === "ar_invoice"
                      ? "Customer invoice"
                      : "Customer receipt"}
                  </Link>
                </Fact>
              )}
            {entry.reverses !== null && (
              <Fact label="Reverses">
                <Link
                  href={`/erp/finance/journals/${entry.reverses.id}`}
                  className="font-bold hover:underline"
                >
                  {entry.reverses.journalNumber}
                </Link>
              </Fact>
            )}
            <Fact label="Created by">
              <span dir="auto">{entry.createdBy.name}</span>
            </Fact>
            {entry.postedBy !== null && entry.postedAt !== null && (
              <Fact label="Posted">
                <span dir="auto">{entry.postedBy.name}</span>,{" "}
                {formatDateTime(entry.postedAt)}
              </Fact>
            )}
            <Fact label="Balance">
              <BalanceBadge
                debitMinor={entry.debitTotalMinor}
                creditMinor={entry.creditTotalMinor}
                difference={formatMinorAmount(difference)}
              />
            </Fact>
          </dl>
        </Panel>

        <Panel className="overflow-hidden lg:col-span-2">
          <PanelHeader title="Lines" description="Amounts in EGP." />
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <Th>#</Th>
                  <Th>Account</Th>
                  <Th>Cost centre</Th>
                  <Th end>Debit</Th>
                  <Th end>Credit</Th>
                </tr>
              </thead>
              <tbody>
                {entry.lines.map((line) => (
                  <tr key={line.id} className="border-border border-b align-top">
                    <td className="text-foreground-muted px-4 py-2.5 tabular-nums">
                      {line.lineNo}
                    </td>
                    <td className="px-4 py-2.5">
                      {rights[ERP_PERMISSIONS.ACCOUNT_READ] === true ? (
                        <Link
                          href={`/erp/finance/accounts/${line.account.id}`}
                          className="font-semibold hover:underline"
                        >
                          {line.account.code} — {line.account.name}
                        </Link>
                      ) : (
                        <span className="font-semibold">
                          {line.account.code} — {line.account.name}
                        </span>
                      )}
                      <span className="text-foreground-muted block text-xs">
                        {ACCOUNT_TYPE_LABELS[line.account.type]}
                        {line.description !== null && (
                          <>
                            {" · "}
                            <span dir="auto">{line.description}</span>
                          </>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      {line.costCentre === null
                        ? "—"
                        : `${line.costCentre.code} ${line.costCentre.name}`}
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
                    Total
                  </td>
                  <td className="px-4 py-2.5 text-end tabular-nums" dir="ltr">
                    {formatAmount(entry.debitTotalMinor)}
                  </td>
                  <td className="px-4 py-2.5 text-end tabular-nums" dir="ltr">
                    {formatAmount(entry.creditTotalMinor)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Panel>
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
