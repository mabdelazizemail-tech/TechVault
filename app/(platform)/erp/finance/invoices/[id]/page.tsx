import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { BreadcrumbTitle } from "@/components/shell/breadcrumbs";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, PageHeader, Panel, PanelHeader } from "@/components/ui/primitives";
import { ERP_PERMISSIONS } from "@/modules/erp/contracts/permissions";
import { getInvoice } from "@/modules/erp/contracts/service";
import { formatBasisPoints } from "@/modules/erp/domain/ar";
import { CustomerName, InvoiceStatusBadge } from "@/modules/erp/ui/ar-badges";
import {
  formatAmount,
  formatDate,
  formatDateTime,
  todayInCairo,
} from "@/modules/erp/ui/format";
import { InvoiceActions } from "@/modules/erp/ui/invoice-actions";
import { orNotFound } from "@/modules/erp/ui/page-helpers";
import { UnallocateButton } from "@/modules/erp/ui/receipt-actions";
import { getActor } from "@/platform/auth/current-user";
import { canAllGlobally } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "Invoice" };

export default async function InvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await getActor();
  const [invoice, rights] = await Promise.all([
    orNotFound(getInvoice(actor, id)),
    canAllGlobally(actor, [
      ERP_PERMISSIONS.AR_INVOICE_UPDATE,
      ERP_PERMISSIONS.AR_INVOICE_APPROVE,
      ERP_PERMISSIONS.AR_INVOICE_POST,
      ERP_PERMISSIONS.AR_INVOICE_CANCEL,
      ERP_PERMISSIONS.AR_CREDIT_NOTE_CREATE,
      ERP_PERMISSIONS.AR_RECEIPT_ALLOCATE,
      ERP_PERMISSIONS.AR_CUSTOMER_READ,
      ERP_PERMISSIONS.JOURNAL_READ,
    ]),
  ]);
  const title = invoice.invoiceNumber ?? "Draft invoice";
  const today = todayInCairo();
  const overdue = invoice.outstandingMinor > 0 && invoice.dueDate < today;
  // A credit note corrects a posted invoice, for at most what it still owes (ADR-029).
  const canCredit =
    rights[ERP_PERMISSIONS.AR_CREDIT_NOTE_CREATE] === true &&
    invoice.outstandingMinor > 0 &&
    (invoice.status === "POSTED" ||
      invoice.status === "PARTIALLY_PAID" ||
      invoice.status === "PAID");

  return (
    <div>
      <BreadcrumbTitle segment={id} label={title} />
      <PageHeader
        title={title}
        description={`${invoice.customer.name} · ${formatDate(invoice.invoiceDate)}`}
        actions={
          <>
            {canCredit && (
              <ButtonLink href={`/erp/finance/credit-notes/new?invoice=${invoice.id}`}>
                Credit note
              </ButtonLink>
            )}
            <InvoiceActions
              invoice={{
                id: invoice.id,
                status: invoice.status,
                invoiceNumber: invoice.invoiceNumber,
                invoiceDate: invoice.invoiceDate,
                totalMinor: invoice.totalMinor,
                paidMinor: invoice.paidMinor,
              }}
              can={{
                update: rights[ERP_PERMISSIONS.AR_INVOICE_UPDATE] === true,
                approve: rights[ERP_PERMISSIONS.AR_INVOICE_APPROVE] === true,
                post: rights[ERP_PERMISSIONS.AR_INVOICE_POST] === true,
                cancel: rights[ERP_PERMISSIONS.AR_INVOICE_CANCEL] === true,
              }}
              today={today}
            />
          </>
        }
      />

      {invoice.status === "DRAFT" && invoice.rejectionReason !== null && (
        <p className="border-warning mb-4 border-s-4 px-3 py-2 text-sm">
          Rejected
          {invoice.rejectedAt !== null
            ? ` ${formatDateTime(invoice.rejectedAt)}`
            : ""}: <span dir="auto">{invoice.rejectionReason}</span>
        </p>
      )}
      {invoice.status === "CANCELLED" && invoice.cancelReason !== null && (
        <p className="border-danger mb-4 border-s-4 px-3 py-2 text-sm">
          Cancelled
          {invoice.cancelledAt !== null
            ? ` ${formatDateTime(invoice.cancelledAt)}`
            : ""}: <span dir="auto">{invoice.cancelReason}</span>
          {invoice.voidJournal !== null && (
            <>
              {" "}
              — voided by journal{" "}
              <Link
                href={`/erp/finance/journals/${invoice.voidJournal.id}`}
                className="font-bold underline"
              >
                {invoice.voidJournal.journalNumber}
              </Link>
            </>
          )}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel>
          <PanelHeader title="Invoice" />
          <dl>
            <Fact label="Status">
              <InvoiceStatusBadge status={invoice.status} />
            </Fact>
            <Fact label="Customer">
              {rights[ERP_PERMISSIONS.AR_CUSTOMER_READ] === true ? (
                <Link
                  href={`/erp/finance/customers/${invoice.customer.id}`}
                  className="font-semibold hover:underline"
                >
                  <CustomerName customer={invoice.customer} />
                </Link>
              ) : (
                <CustomerName customer={invoice.customer} />
              )}
            </Fact>
            <Fact label="Invoice date">{formatDate(invoice.invoiceDate)}</Fact>
            <Fact label="Due date">
              <span className={overdue ? "text-danger font-semibold" : undefined}>
                {formatDate(invoice.dueDate)}
                {overdue && " (overdue)"}
              </span>
            </Fact>
            <Fact label="Reference">
              {invoice.reference === null ? (
                "—"
              ) : (
                <span dir="auto">{invoice.reference}</span>
              )}
            </Fact>
            <Fact label="Receivable account">
              {invoice.receivableAccount.code} {invoice.receivableAccount.name}
            </Fact>
            <Fact label="Period">
              {invoice.period === null ? "Assigned when posted" : invoice.period.name}
            </Fact>
            <Fact label="Journal entry">
              {invoice.journal === null ? (
                "Created when posted"
              ) : rights[ERP_PERMISSIONS.JOURNAL_READ] === true ? (
                <Link
                  href={`/erp/finance/journals/${invoice.journal.id}`}
                  className="font-bold hover:underline"
                >
                  {invoice.journal.journalNumber}
                </Link>
              ) : (
                invoice.journal.journalNumber
              )}
            </Fact>
            <Fact label="Approval">
              {invoice.approvalSkipped
                ? "Not required under AR settings"
                : invoice.approvedBy !== null && invoice.approvedAt !== null
                  ? `${invoice.approvedBy.name}, ${formatDateTime(invoice.approvedAt)}`
                  : invoice.submittedAt !== null
                    ? "Waiting for approval"
                    : "Not submitted"}
            </Fact>
            {invoice.postedBy !== null && invoice.postedAt !== null && (
              <Fact label="Posted">
                {invoice.postedBy.name}, {formatDateTime(invoice.postedAt)}
              </Fact>
            )}
            <Fact label="Created by">{invoice.createdBy.name}</Fact>
          </dl>
          {invoice.notes !== null && (
            <p dir="auto" className="text-foreground-muted rule-t px-4 py-3 text-sm">
              {invoice.notes}
            </p>
          )}
        </Panel>

        <div className="flex flex-col gap-4 lg:col-span-2">
          <Panel className="overflow-hidden">
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
                  {invoice.lines.map((line) => (
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
                {formatAmount(invoice.subtotalMinor)}
              </dd>
              <dt className="text-foreground-muted">Discount</dt>
              <dd dir="ltr" className="text-end">
                {formatAmount(invoice.discountMinor)}
              </dd>
              <dt className="text-foreground-muted">Tax</dt>
              <dd dir="ltr" className="text-end">
                {formatAmount(invoice.taxMinor)}
              </dd>
              <dt className="font-bold">Total</dt>
              <dd dir="ltr" className="text-end font-bold">
                {formatAmount(invoice.totalMinor)}
              </dd>
              <dt className="text-foreground-muted">Credited</dt>
              <dd dir="ltr" className="text-end">
                {formatAmount(invoice.creditedMinor)}
              </dd>
              <dt className="text-foreground-muted">Paid</dt>
              <dd dir="ltr" className="text-end">
                {formatAmount(invoice.paidMinor)}
              </dd>
              <dt className="font-bold">Outstanding</dt>
              <dd
                dir="ltr"
                className="text-end font-bold"
                data-testid="invoice-outstanding"
              >
                {formatAmount(invoice.outstandingMinor)}
              </dd>
            </dl>
          </Panel>

          <Panel className="overflow-hidden">
            <PanelHeader
              title="Payments"
              description="Receipts allocated to this invoice."
            />
            {invoice.allocations.length === 0 ? (
              <EmptyState
                title="No payments yet"
                description="Allocate a posted receipt of this customer to this invoice from the receipt's page."
              />
            ) : (
              <ul className="divide-border divide-y">
                {invoice.allocations.map((allocation) => (
                  <li
                    key={allocation.id}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                  >
                    <span>
                      <Link
                        href={`/erp/finance/receipts/${allocation.receiptId}`}
                        className="font-semibold hover:underline"
                      >
                        {allocation.receiptNumber}
                      </Link>
                      <span className="text-foreground-muted ms-2">
                        {formatDate(allocation.receiptDate)}
                      </span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span dir="ltr" className="font-bold tabular-nums">
                        {formatAmount(allocation.amountMinor)}
                      </span>
                      {rights[ERP_PERMISSIONS.AR_RECEIPT_ALLOCATE] === true && (
                        <UnallocateButton
                          receiptId={allocation.receiptId}
                          invoiceId={invoice.id}
                          label={`${formatAmount(allocation.amountMinor)} from receipt ${allocation.receiptNumber ?? ""}.`}
                        />
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
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
    <td className="px-4 py-2.5 text-end tabular-nums" dir="ltr">
      {children}
    </td>
  );
}
