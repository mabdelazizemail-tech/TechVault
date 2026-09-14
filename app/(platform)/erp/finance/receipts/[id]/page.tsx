import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { BreadcrumbTitle } from "@/components/shell/breadcrumbs";
import {
  EmptyState,
  PageHeader,
  Panel,
  PanelHeader,
  StatCard,
} from "@/components/ui/primitives";
import { ERP_PERMISSIONS } from "@/modules/erp/contracts/permissions";
import { getReceipt } from "@/modules/erp/contracts/service";
import { CustomerName, ReceiptStatusBadge } from "@/modules/erp/ui/ar-badges";
import {
  formatAmount,
  formatDate,
  formatDateTime,
  todayInCairo,
} from "@/modules/erp/ui/format";
import { orNotFound } from "@/modules/erp/ui/page-helpers";
import { ReceiptActions, UnallocateButton } from "@/modules/erp/ui/receipt-actions";
import { getActor } from "@/platform/auth/current-user";
import { canAll } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "Receipt" };

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await getActor();
  const [receipt, rights] = await Promise.all([
    orNotFound(getReceipt(actor, id)),
    canAll(actor, [
      ERP_PERMISSIONS.AR_RECEIPT_UPDATE,
      ERP_PERMISSIONS.AR_RECEIPT_POST,
      ERP_PERMISSIONS.AR_RECEIPT_ALLOCATE,
      ERP_PERMISSIONS.AR_RECEIPT_CANCEL,
      ERP_PERMISSIONS.AR_CUSTOMER_READ,
      ERP_PERMISSIONS.JOURNAL_READ,
    ]),
  ]);
  const title = receipt.receiptNumber ?? "Draft receipt";
  const canAllocate = rights[ERP_PERMISSIONS.AR_RECEIPT_ALLOCATE] === true;

  return (
    <div>
      <BreadcrumbTitle segment={id} label={title} />
      <PageHeader
        title={title}
        description={`${receipt.customer.name} · ${formatDate(receipt.receiptDate)}`}
        actions={
          <ReceiptActions
            receipt={{
              id: receipt.id,
              status: receipt.status,
              receiptNumber: receipt.receiptNumber,
              receiptDate: receipt.receiptDate,
              crmAccountId: receipt.customer.id,
              amountMinor: receipt.amountMinor,
              allocatedMinor: receipt.allocatedMinor,
            }}
            can={{
              update: rights[ERP_PERMISSIONS.AR_RECEIPT_UPDATE] === true,
              post: rights[ERP_PERMISSIONS.AR_RECEIPT_POST] === true,
              allocate: canAllocate,
              cancel: rights[ERP_PERMISSIONS.AR_RECEIPT_CANCEL] === true,
            }}
            today={todayInCairo()}
          />
        }
      />

      {receipt.status === "CANCELLED" && receipt.cancelReason !== null && (
        <p className="border-danger mb-4 border-s-4 px-3 py-2 text-sm">
          Cancelled
          {receipt.cancelledAt !== null ? ` ${formatDateTime(receipt.cancelledAt)}` : ""}:{" "}
          <span dir="auto">{receipt.cancelReason}</span>
        </p>
      )}

      <section aria-label="Amounts" className="mb-4 grid gap-4 sm:grid-cols-3">
        <StatCard label="Amount" value={formatAmount(receipt.amountMinor)} note="EGP" />
        <StatCard
          label="Allocated"
          value={formatAmount(receipt.allocatedMinor)}
          note="To invoices"
        />
        <StatCard
          label="Unallocated"
          value={formatAmount(receipt.unallocatedMinor)}
          note="Available to allocate"
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel>
          <PanelHeader title="Receipt" />
          <dl>
            <Fact label="Status">
              <ReceiptStatusBadge status={receipt.status} />
            </Fact>
            <Fact label="Customer">
              {rights[ERP_PERMISSIONS.AR_CUSTOMER_READ] === true ? (
                <Link
                  href={`/erp/finance/customers/${receipt.customer.id}`}
                  className="font-semibold hover:underline"
                >
                  <CustomerName customer={receipt.customer} />
                </Link>
              ) : (
                <CustomerName customer={receipt.customer} />
              )}
            </Fact>
            <Fact label="Date">{formatDate(receipt.receiptDate)}</Fact>
            <Fact label="Method">{receipt.paymentMethod.name}</Fact>
            <Fact label="Deposited to">
              {receipt.depositAccount.code} {receipt.depositAccount.name}
            </Fact>
            <Fact label="Receivable account">
              {receipt.receivableAccount.code} {receipt.receivableAccount.name}
            </Fact>
            <Fact label="Reference">
              {receipt.reference === null ? (
                "—"
              ) : (
                <span dir="auto">{receipt.reference}</span>
              )}
            </Fact>
            <Fact label="Journal entry">
              {receipt.journal === null ? (
                "Created when posted"
              ) : rights[ERP_PERMISSIONS.JOURNAL_READ] === true ? (
                <Link
                  href={`/erp/finance/journals/${receipt.journal.id}`}
                  className="font-bold hover:underline"
                >
                  {receipt.journal.journalNumber}
                </Link>
              ) : (
                receipt.journal.journalNumber
              )}
            </Fact>
            {receipt.voidJournal !== null && (
              <Fact label="Void entry">
                <Link
                  href={`/erp/finance/journals/${receipt.voidJournal.id}`}
                  className="font-bold hover:underline"
                >
                  {receipt.voidJournal.journalNumber}
                </Link>
              </Fact>
            )}
            {receipt.postedBy !== null && receipt.postedAt !== null && (
              <Fact label="Posted">
                {receipt.postedBy.name}, {formatDateTime(receipt.postedAt)}
              </Fact>
            )}
          </dl>
          {receipt.notes !== null && (
            <p dir="auto" className="text-foreground-muted rule-t px-4 py-3 text-sm">
              {receipt.notes}
            </p>
          )}
        </Panel>

        <Panel className="overflow-hidden lg:col-span-2">
          <PanelHeader title="Allocations" description="Invoices this receipt pays." />
          {receipt.allocations.length === 0 ? (
            <EmptyState
              title="Not allocated"
              description={
                receipt.status === "POSTED"
                  ? "Allocate this receipt to the customer's open invoices."
                  : "Post the receipt first, then allocate it to invoices."
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <Th>Invoice</Th>
                    <Th>Due</Th>
                    <Th end>Amount (EGP)</Th>
                    {canAllocate && <Th end>Actions</Th>}
                  </tr>
                </thead>
                <tbody>
                  {receipt.allocations.map((allocation) => (
                    <tr key={allocation.id} className="border-border border-b">
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/erp/finance/invoices/${allocation.invoiceId}`}
                          className="font-semibold hover:underline"
                        >
                          {allocation.invoiceNumber}
                        </Link>
                        <span className="text-foreground-muted block text-xs">
                          {formatDate(allocation.invoiceDate)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {formatDate(allocation.dueDate)}
                      </td>
                      <td
                        className="px-4 py-2.5 text-end font-bold tabular-nums"
                        dir="ltr"
                      >
                        {formatAmount(allocation.amountMinor)}
                      </td>
                      {canAllocate && (
                        <td className="px-4 py-2.5 text-end">
                          <UnallocateButton
                            receiptId={receipt.id}
                            invoiceId={allocation.invoiceId}
                            label={`${formatAmount(allocation.amountMinor)} from invoice ${allocation.invoiceNumber ?? ""}.`}
                          />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
