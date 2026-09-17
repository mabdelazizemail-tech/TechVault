import type { Metadata } from "next";
import Link from "next/link";
import { BreadcrumbTitle } from "@/components/shell/breadcrumbs";
import { EmptyState, PageHeader, Panel, PanelHeader } from "@/components/ui/primitives";
import { ERP_PERMISSIONS } from "@/modules/erp/contracts/permissions";
import { getBill } from "@/modules/erp/contracts/service";
import { formatBasisPoints } from "@/modules/erp/domain/ar";
import { BillStatusBadge, VendorName } from "@/modules/erp/ui/ap-badges";
import { BillActions } from "@/modules/erp/ui/bill-actions";
import { Fact, Td, Th } from "@/modules/erp/ui/detail-parts";
import {
  formatAmount,
  formatDate,
  formatDateTime,
  todayInCairo,
} from "@/modules/erp/ui/format";
import { orNotFound } from "@/modules/erp/ui/page-helpers";
import { getActor } from "@/platform/auth/current-user";
import { canAllGlobally } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "Bill" };

export default async function BillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await getActor();
  const [bill, rights] = await Promise.all([
    orNotFound(getBill(actor, id)),
    canAllGlobally(actor, [
      ERP_PERMISSIONS.AP_BILL_UPDATE,
      ERP_PERMISSIONS.AP_BILL_APPROVE,
      ERP_PERMISSIONS.AP_BILL_POST,
      ERP_PERMISSIONS.AP_BILL_CANCEL,
      ERP_PERMISSIONS.AP_VENDOR_READ,
      ERP_PERMISSIONS.AP_PAYMENT_READ,
      ERP_PERMISSIONS.JOURNAL_READ,
    ]),
  ]);
  const title = bill.billNumber ?? "Draft bill";
  const today = todayInCairo();
  const overdue = bill.outstandingMinor > 0 && bill.dueDate < today;
  const canReadPayments = rights[ERP_PERMISSIONS.AP_PAYMENT_READ] === true;

  return (
    <div>
      <BreadcrumbTitle segment={id} label={title} />
      <PageHeader
        title={title}
        description={`${bill.vendor.name} · supplier invoice ${bill.vendorInvoiceNumber} · ${formatDate(bill.billDate)}`}
        actions={
          <BillActions
            bill={{
              id: bill.id,
              status: bill.status,
              billNumber: bill.billNumber,
              billDate: bill.billDate,
              totalMinor: bill.totalMinor,
              paidMinor: bill.paidMinor,
            }}
            can={{
              update: rights[ERP_PERMISSIONS.AP_BILL_UPDATE] === true,
              approve: rights[ERP_PERMISSIONS.AP_BILL_APPROVE] === true,
              post: rights[ERP_PERMISSIONS.AP_BILL_POST] === true,
              cancel: rights[ERP_PERMISSIONS.AP_BILL_CANCEL] === true,
            }}
            today={today}
          />
        }
      />

      {bill.status === "DRAFT" && bill.rejectionReason !== null && (
        <p className="border-warning mb-4 border-s-4 px-3 py-2 text-sm">
          Rejected
          {bill.rejectedAt !== null ? ` ${formatDateTime(bill.rejectedAt)}` : ""}:{" "}
          <span dir="auto">{bill.rejectionReason}</span>
        </p>
      )}
      {bill.status === "CANCELLED" && bill.cancelReason !== null && (
        <p className="border-danger mb-4 border-s-4 px-3 py-2 text-sm">
          Cancelled
          {bill.cancelledAt !== null ? ` ${formatDateTime(bill.cancelledAt)}` : ""}:{" "}
          <span dir="auto">{bill.cancelReason}</span>
          {bill.voidJournal !== null && (
            <>
              {" "}
              — voided by journal{" "}
              <Link
                href={`/erp/finance/journals/${bill.voidJournal.id}`}
                className="font-bold underline"
              >
                {bill.voidJournal.journalNumber}
              </Link>
            </>
          )}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel>
          <PanelHeader title="Bill" />
          <dl>
            <Fact label="Status">
              <BillStatusBadge status={bill.status} />
            </Fact>
            <Fact label="Vendor">
              {rights[ERP_PERMISSIONS.AP_VENDOR_READ] === true ? (
                <Link
                  href={`/erp/finance/vendors/${bill.vendor.id}`}
                  className="font-semibold hover:underline"
                >
                  <VendorName vendor={bill.vendor} />
                </Link>
              ) : (
                <VendorName vendor={bill.vendor} />
              )}
            </Fact>
            <Fact label="Supplier invoice">
              <span dir="auto">{bill.vendorInvoiceNumber}</span>
            </Fact>
            <Fact label="Bill date">{formatDate(bill.billDate)}</Fact>
            <Fact label="Due date">
              <span className={overdue ? "text-danger font-semibold" : undefined}>
                {formatDate(bill.dueDate)}
                {overdue && " (overdue)"}
              </span>
            </Fact>
            <Fact label="Reference">
              {bill.reference === null ? "—" : <span dir="auto">{bill.reference}</span>}
            </Fact>
            <Fact label="Payable account">
              {bill.payableAccount.code} {bill.payableAccount.name}
            </Fact>
            <Fact label="Period">
              {bill.period === null ? "Assigned when posted" : bill.period.name}
            </Fact>
            <Fact label="Journal entry">
              {bill.journal === null ? (
                "Created when posted"
              ) : rights[ERP_PERMISSIONS.JOURNAL_READ] === true ? (
                <Link
                  href={`/erp/finance/journals/${bill.journal.id}`}
                  className="font-bold hover:underline"
                >
                  {bill.journal.journalNumber}
                </Link>
              ) : (
                bill.journal.journalNumber
              )}
            </Fact>
            <Fact label="Approval">
              {bill.approvalSkipped
                ? "Not required under AP settings"
                : bill.approvedBy !== null && bill.approvedAt !== null
                  ? `${bill.approvedBy.name}, ${formatDateTime(bill.approvedAt)}`
                  : bill.submittedAt !== null
                    ? "Waiting for approval"
                    : "Not submitted"}
            </Fact>
            {bill.postedBy !== null && bill.postedAt !== null && (
              <Fact label="Posted">
                {bill.postedBy.name}, {formatDateTime(bill.postedAt)}
              </Fact>
            )}
            <Fact label="Created by">{bill.createdBy.name}</Fact>
          </dl>
          {bill.notes !== null && (
            <p dir="auto" className="text-foreground-muted rule-t px-4 py-3 text-sm">
              {bill.notes}
            </p>
          )}
        </Panel>

        <div className="flex flex-col gap-4 lg:col-span-2">
          <Panel className="overflow-hidden">
            <PanelHeader title="Lines" description="Amounts in EGP, calculated by the server." />
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <Th>Description</Th>
                    <Th end>Qty</Th>
                    <Th end>Unit price</Th>
                    <Th end>Discount</Th>
                    <Th end>Input VAT</Th>
                    <Th end>Total</Th>
                  </tr>
                </thead>
                <tbody>
                  {bill.lines.map((line) => (
                    <tr key={line.id} className="border-border border-b align-top">
                      <td className="px-4 py-2.5">
                        <span dir="auto" className="font-semibold">
                          {line.description}
                        </span>
                        <span className="text-foreground-muted block text-xs">
                          {line.expenseAccount.code} {line.expenseAccount.name}
                          {line.costCentre !== null && ` · ${line.costCentre.code}`}
                        </span>
                      </td>
                      <Td>{line.quantity}</Td>
                      <Td>{formatAmount(line.unitPriceMinor)}</Td>
                      <Td>{line.discountMinor === 0 ? "" : formatAmount(line.discountMinor)}</Td>
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
                {formatAmount(bill.subtotalMinor)}
              </dd>
              <dt className="text-foreground-muted">Discount</dt>
              <dd dir="ltr" className="text-end">
                {formatAmount(bill.discountMinor)}
              </dd>
              <dt className="text-foreground-muted">Input VAT</dt>
              <dd dir="ltr" className="text-end">
                {formatAmount(bill.taxMinor)}
              </dd>
              <dt className="font-bold">Total</dt>
              <dd dir="ltr" className="text-end font-bold">
                {formatAmount(bill.totalMinor)}
              </dd>
              <dt className="text-foreground-muted">Settled</dt>
              <dd dir="ltr" className="text-end">
                {formatAmount(bill.paidMinor)}
              </dd>
              <dt className="font-bold">Outstanding</dt>
              <dd dir="ltr" className="text-end font-bold" data-testid="bill-outstanding">
                {formatAmount(bill.outstandingMinor)}
              </dd>
            </dl>
          </Panel>

          <Panel className="overflow-hidden">
            <PanelHeader
              title="Payments"
              description="Posted payments settling this bill. Tax withheld counts towards the bill."
            />
            {bill.settlements.length === 0 ? (
              <EmptyState
                title="No payments yet"
                description="Pay a posted bill by recording a payment to the vendor."
              />
            ) : (
              <ul className="divide-border divide-y">
                {bill.settlements.map((settlement) => (
                  <li
                    key={settlement.paymentId}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm"
                  >
                    <span>
                      {canReadPayments ? (
                        <Link
                          href={`/erp/finance/payments/${settlement.paymentId}`}
                          className="font-semibold hover:underline"
                        >
                          {settlement.paymentNumber}
                        </Link>
                      ) : (
                        <span className="font-semibold">{settlement.paymentNumber}</span>
                      )}
                      <span className="text-foreground-muted ms-2">
                        {formatDate(settlement.paymentDate)}
                      </span>
                    </span>
                    <span className="text-foreground-muted text-xs tabular-nums">
                      paid <span dir="ltr">{formatAmount(settlement.cashMinor)}</span> +
                      withheld <span dir="ltr">{formatAmount(settlement.withheldMinor)}</span>{" "}
                      ={" "}
                      <strong dir="ltr" className="text-foreground text-sm">
                        {formatAmount(settlement.amountMinor)}
                      </strong>
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
