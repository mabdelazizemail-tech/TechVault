import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { BreadcrumbTitle } from "@/components/shell/breadcrumbs";
import { PageHeader, Panel, PanelHeader } from "@/components/ui/primitives";
import { ERP_PERMISSIONS } from "@/modules/erp/contracts/permissions";
import { getCreditNote } from "@/modules/erp/contracts/service";
import { formatBasisPoints } from "@/modules/erp/domain/ar";
import { CustomerName } from "@/modules/erp/ui/ar-badges";
import {
  CreditNoteActions,
  CreditNoteStatusBadge,
} from "@/modules/erp/ui/credit-note-actions";
import {
  formatAmount,
  formatDate,
  formatDateTime,
  todayInCairo,
} from "@/modules/erp/ui/format";
import { orNotFound } from "@/modules/erp/ui/page-helpers";
import { getActor } from "@/platform/auth/current-user";
import { canAllGlobally } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "Credit note" };

export default async function CreditNotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await getActor();
  const [creditNote, rights] = await Promise.all([
    orNotFound(getCreditNote(actor, id)),
    canAllGlobally(actor, [
      ERP_PERMISSIONS.AR_CREDIT_NOTE_UPDATE,
      ERP_PERMISSIONS.AR_CREDIT_NOTE_APPROVE,
      ERP_PERMISSIONS.AR_CREDIT_NOTE_POST,
      ERP_PERMISSIONS.AR_CREDIT_NOTE_CANCEL,
      ERP_PERMISSIONS.AR_INVOICE_READ,
      ERP_PERMISSIONS.AR_CUSTOMER_READ,
      ERP_PERMISSIONS.JOURNAL_READ,
    ]),
  ]);
  const title = creditNote.creditNoteNumber ?? "Draft credit note";

  return (
    <div>
      <BreadcrumbTitle segment={id} label={title} />
      <PageHeader
        title={title}
        description={`${creditNote.customer.name} · ${formatDate(creditNote.creditNoteDate)}`}
        actions={
          <CreditNoteActions
            creditNote={{
              id: creditNote.id,
              status: creditNote.status,
              creditNoteNumber: creditNote.creditNoteNumber,
              creditNoteDate: creditNote.creditNoteDate,
              totalMinor: creditNote.totalMinor,
              invoiceNumber: creditNote.invoice.invoiceNumber,
            }}
            can={{
              update: rights[ERP_PERMISSIONS.AR_CREDIT_NOTE_UPDATE] === true,
              approve: rights[ERP_PERMISSIONS.AR_CREDIT_NOTE_APPROVE] === true,
              post: rights[ERP_PERMISSIONS.AR_CREDIT_NOTE_POST] === true,
              cancel: rights[ERP_PERMISSIONS.AR_CREDIT_NOTE_CANCEL] === true,
            }}
            today={todayInCairo()}
          />
        }
      />

      {creditNote.status === "DRAFT" && creditNote.rejectionReason !== null && (
        <p className="border-warning mb-4 border-s-4 px-3 py-2 text-sm">
          Rejected
          {creditNote.rejectedAt !== null
            ? ` ${formatDateTime(creditNote.rejectedAt)}`
            : ""}
          : <span dir="auto">{creditNote.rejectionReason}</span>
        </p>
      )}
      {creditNote.status === "CANCELLED" && creditNote.cancelReason !== null && (
        <p className="border-danger mb-4 border-s-4 px-3 py-2 text-sm">
          Cancelled
          {creditNote.cancelledAt !== null
            ? ` ${formatDateTime(creditNote.cancelledAt)}`
            : ""}
          : <span dir="auto">{creditNote.cancelReason}</span>
          {creditNote.voidJournal !== null && (
            <>
              {" "}
              — voided by journal{" "}
              <Link
                href={`/erp/finance/journals/${creditNote.voidJournal.id}`}
                className="font-bold underline"
              >
                {creditNote.voidJournal.journalNumber}
              </Link>
            </>
          )}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel>
          <PanelHeader title="Credit note" />
          <dl>
            <Fact label="Status">
              <CreditNoteStatusBadge status={creditNote.status} />
            </Fact>
            <Fact label="Customer">
              {rights[ERP_PERMISSIONS.AR_CUSTOMER_READ] === true ? (
                <Link
                  href={`/erp/finance/customers/${creditNote.customer.id}`}
                  className="font-semibold hover:underline"
                >
                  <CustomerName customer={creditNote.customer} />
                </Link>
              ) : (
                <CustomerName customer={creditNote.customer} />
              )}
            </Fact>
            <Fact label="Against invoice">
              {rights[ERP_PERMISSIONS.AR_INVOICE_READ] === true ? (
                <Link
                  href={`/erp/finance/invoices/${creditNote.invoice.id}`}
                  className="font-bold hover:underline"
                >
                  {creditNote.invoice.invoiceNumber ?? "Invoice"}
                </Link>
              ) : (
                (creditNote.invoice.invoiceNumber ?? "Invoice")
              )}
            </Fact>
            <Fact label="Invoice outstanding">
              <span dir="ltr">{formatAmount(creditNote.invoiceOutstandingMinor)}</span>
            </Fact>
            <Fact label="Date">{formatDate(creditNote.creditNoteDate)}</Fact>
            <Fact label="Reason">
              <span dir="auto">{creditNote.reason}</span>
            </Fact>
            <Fact label="Receivable account">
              {creditNote.receivableAccount.code} {creditNote.receivableAccount.name}
            </Fact>
            <Fact label="Period">
              {creditNote.period === null
                ? "Assigned when posted"
                : creditNote.period.name}
            </Fact>
            <Fact label="Journal entry">
              {creditNote.journal === null ? (
                "Created when posted"
              ) : rights[ERP_PERMISSIONS.JOURNAL_READ] === true ? (
                <Link
                  href={`/erp/finance/journals/${creditNote.journal.id}`}
                  className="font-bold hover:underline"
                >
                  {creditNote.journal.journalNumber}
                </Link>
              ) : (
                creditNote.journal.journalNumber
              )}
            </Fact>
            <Fact label="Approval">
              {creditNote.approvalSkipped
                ? "Not required under AR settings"
                : creditNote.approvedBy !== null && creditNote.approvedAt !== null
                  ? `${creditNote.approvedBy.name}, ${formatDateTime(creditNote.approvedAt)}`
                  : creditNote.submittedAt !== null
                    ? "Waiting for approval"
                    : "Not submitted"}
            </Fact>
            {creditNote.postedBy !== null && creditNote.postedAt !== null && (
              <Fact label="Posted">
                {creditNote.postedBy.name}, {formatDateTime(creditNote.postedAt)}
              </Fact>
            )}
            <Fact label="Created by">{creditNote.createdBy.name}</Fact>
          </dl>
          {creditNote.notes !== null && (
            <p dir="auto" className="text-foreground-muted rule-t px-4 py-3 text-sm">
              {creditNote.notes}
            </p>
          )}
        </Panel>

        <Panel className="overflow-hidden lg:col-span-2">
          <PanelHeader
            title="Lines"
            description="Amounts in EGP, calculated by the server."
          />
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <Th>Description</Th>
                  <Th end>Qty</Th>
                  <Th end>Unit price</Th>
                  <Th end>Discount</Th>
                  <Th end>Tax</Th>
                  <Th end>Total</Th>
                </tr>
              </thead>
              <tbody>
                {creditNote.lines.map((line) => (
                  <tr key={line.id} className="border-border border-b align-top">
                    <td className="px-4 py-2.5">
                      <span dir="auto" className="font-semibold">
                        {line.description}
                      </span>
                      <span className="text-foreground-muted block text-xs">
                        {line.revenueAccount.code} {line.revenueAccount.name}
                        {line.costCentre !== null && ` · ${line.costCentre.code}`}
                      </span>
                    </td>
                    <Td>{line.quantity}</Td>
                    <Td>{formatAmount(line.unitPriceMinor)}</Td>
                    <Td>
                      {line.discountMinor === 0 ? "" : formatAmount(line.discountMinor)}
                    </Td>
                    <Td>
                      {line.taxRate === null ? (
                        ""
                      ) : (
                        <>
                          {formatAmount(line.taxMinor)}
                          <span className="text-foreground-muted block text-xs">
                            {line.taxRate.code}{" "}
                            {formatBasisPoints(line.taxRateBasisPoints ?? 0)}
                          </span>
                        </>
                      )}
                    </Td>
                    <Td>
                      <strong>{formatAmount(line.totalMinor)}</strong>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="rule-t ms-auto grid max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-1 px-4 py-3 text-sm tabular-nums">
            <dt className="text-foreground-muted">Subtotal</dt>
            <dd dir="ltr" className="text-end">
              {formatAmount(creditNote.subtotalMinor)}
            </dd>
            <dt className="text-foreground-muted">Discount</dt>
            <dd dir="ltr" className="text-end">
              {formatAmount(creditNote.discountMinor)}
            </dd>
            <dt className="text-foreground-muted">Tax</dt>
            <dd dir="ltr" className="text-end">
              {formatAmount(creditNote.taxMinor)}
            </dd>
            <dt className="font-bold">Credit total</dt>
            <dd dir="ltr" className="text-end font-bold" data-testid="credit-note-total">
              {formatAmount(creditNote.totalMinor)}
            </dd>
          </dl>
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

function Td({ children }: { children: ReactNode }) {
  return (
    <td dir="ltr" className="px-4 py-2.5 text-end tabular-nums">
      {children}
    </td>
  );
}
