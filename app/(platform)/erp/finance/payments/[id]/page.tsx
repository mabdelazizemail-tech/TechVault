import type { Metadata } from "next";
import Link from "next/link";
import { BreadcrumbTitle } from "@/components/shell/breadcrumbs";
import { PageHeader, Panel, PanelHeader } from "@/components/ui/primitives";
import { ERP_PERMISSIONS } from "@/modules/erp/contracts/permissions";
import { getPayment } from "@/modules/erp/contracts/service";
import { formatBasisPoints } from "@/modules/erp/domain/ar";
import { PaymentStatusBadge, VendorName } from "@/modules/erp/ui/ap-badges";
import { Fact, Td, Th } from "@/modules/erp/ui/detail-parts";
import {
  formatAmount,
  formatDate,
  formatDateTime,
  todayInCairo,
} from "@/modules/erp/ui/format";
import { orNotFound } from "@/modules/erp/ui/page-helpers";
import { PaymentActions } from "@/modules/erp/ui/payment-actions";
import { getActor } from "@/platform/auth/current-user";
import { canAllGlobally } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "Payment" };

export default async function PaymentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await getActor();
  const [payment, rights] = await Promise.all([
    orNotFound(getPayment(actor, id)),
    canAllGlobally(actor, [
      ERP_PERMISSIONS.AP_PAYMENT_UPDATE,
      ERP_PERMISSIONS.AP_PAYMENT_APPROVE,
      ERP_PERMISSIONS.AP_PAYMENT_POST,
      ERP_PERMISSIONS.AP_PAYMENT_CANCEL,
      ERP_PERMISSIONS.AP_VENDOR_READ,
      ERP_PERMISSIONS.AP_BILL_READ,
      ERP_PERMISSIONS.JOURNAL_READ,
    ]),
  ]);
  const title = payment.paymentNumber ?? "Draft payment";
  const canReadBills = rights[ERP_PERMISSIONS.AP_BILL_READ] === true;

  return (
    <div>
      <BreadcrumbTitle segment={id} label={title} />
      <PageHeader
        title={title}
        description={`${payment.vendor.name} · ${formatDate(payment.paymentDate)}`}
        actions={
          <PaymentActions
            payment={{
              id: payment.id,
              status: payment.status,
              paymentNumber: payment.paymentNumber,
              paymentDate: payment.paymentDate,
              amountMinor: payment.amountMinor,
              withheldMinor: payment.withheldMinor,
              cashMinor: payment.cashMinor,
            }}
            can={{
              update: rights[ERP_PERMISSIONS.AP_PAYMENT_UPDATE] === true,
              approve: rights[ERP_PERMISSIONS.AP_PAYMENT_APPROVE] === true,
              post: rights[ERP_PERMISSIONS.AP_PAYMENT_POST] === true,
              cancel: rights[ERP_PERMISSIONS.AP_PAYMENT_CANCEL] === true,
            }}
            today={todayInCairo()}
          />
        }
      />

      {payment.status === "DRAFT" && payment.rejectionReason !== null && (
        <p className="border-warning mb-4 border-s-4 px-3 py-2 text-sm">
          Rejected
          {payment.rejectedAt !== null ? ` ${formatDateTime(payment.rejectedAt)}` : ""}:{" "}
          <span dir="auto">{payment.rejectionReason}</span>
        </p>
      )}
      {payment.status === "CANCELLED" && payment.cancelReason !== null && (
        <p className="border-danger mb-4 border-s-4 px-3 py-2 text-sm">
          Cancelled
          {payment.cancelledAt !== null ? ` ${formatDateTime(payment.cancelledAt)}` : ""}:{" "}
          <span dir="auto">{payment.cancelReason}</span>
          {payment.voidJournal !== null && (
            <>
              {" "}
              — voided by journal{" "}
              <Link
                href={`/erp/finance/journals/${payment.voidJournal.id}`}
                className="font-bold underline"
              >
                {payment.voidJournal.journalNumber}
              </Link>
            </>
          )}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel>
          <PanelHeader title="Payment" />
          <dl>
            <Fact label="Status">
              <PaymentStatusBadge status={payment.status} />
            </Fact>
            <Fact label="Vendor">
              {rights[ERP_PERMISSIONS.AP_VENDOR_READ] === true ? (
                <Link
                  href={`/erp/finance/vendors/${payment.vendor.id}`}
                  className="font-semibold hover:underline"
                >
                  <VendorName vendor={payment.vendor} />
                </Link>
              ) : (
                <VendorName vendor={payment.vendor} />
              )}
            </Fact>
            <Fact label="Payment date">{formatDate(payment.paymentDate)}</Fact>
            <Fact label="Method">
              <span dir="auto">{payment.paymentMethod.name}</span>
            </Fact>
            <Fact label="Paid from">
              {payment.bankAccount.code} {payment.bankAccount.name}
            </Fact>
            <Fact label="Payable account">
              {payment.payableAccount.code} {payment.payableAccount.name}
            </Fact>
            <Fact label="Reference">
              {payment.reference === null ? (
                "—"
              ) : (
                <span dir="auto">{payment.reference}</span>
              )}
            </Fact>
            <Fact label="Period">
              {payment.period === null ? "Assigned when posted" : payment.period.name}
            </Fact>
            <Fact label="Journal entry">
              {payment.journal === null ? (
                "Created when posted"
              ) : rights[ERP_PERMISSIONS.JOURNAL_READ] === true ? (
                <Link
                  href={`/erp/finance/journals/${payment.journal.id}`}
                  className="font-bold hover:underline"
                >
                  {payment.journal.journalNumber}
                </Link>
              ) : (
                payment.journal.journalNumber
              )}
            </Fact>
            <Fact label="Approval">
              {payment.approvalSkipped
                ? "Not required under AP settings"
                : payment.approvedBy !== null && payment.approvedAt !== null
                  ? `${payment.approvedBy.name}, ${formatDateTime(payment.approvedAt)}`
                  : payment.submittedAt !== null
                    ? "Waiting for approval"
                    : "Not submitted"}
            </Fact>
            {payment.postedBy !== null && payment.postedAt !== null && (
              <Fact label="Posted">
                {payment.postedBy.name}, {formatDateTime(payment.postedAt)}
              </Fact>
            )}
            <Fact label="Created by">{payment.createdBy.name}</Fact>
          </dl>
          {payment.notes !== null && (
            <p dir="auto" className="text-foreground-muted rule-t px-4 py-3 text-sm">
              {payment.notes}
            </p>
          )}
        </Panel>

        <Panel className="overflow-hidden lg:col-span-2">
          <PanelHeader
            title="Bills settled"
            description="Tax is withheld on the part of each amount before VAT. Amounts in EGP, calculated by the server."
          />
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <Th>Bill</Th>
                  <Th end>Settled</Th>
                  <Th end>Withholding base</Th>
                  <Th end>Withheld</Th>
                  <Th end>Paid out</Th>
                </tr>
              </thead>
              <tbody>
                {payment.lines.map((line) => (
                  <tr key={line.id} className="border-border border-b align-top">
                    <td className="px-4 py-2.5">
                      {canReadBills ? (
                        <Link
                          href={`/erp/finance/bills/${line.bill.id}`}
                          className="font-semibold hover:underline"
                          dir="ltr"
                        >
                          {line.bill.billNumber ?? "Draft"}
                        </Link>
                      ) : (
                        <span className="font-semibold" dir="ltr">
                          {line.bill.billNumber ?? "Draft"}
                        </span>
                      )}
                      <span className="text-foreground-muted block text-xs">
                        Supplier invoice{" "}
                        <span dir="auto">{line.bill.vendorInvoiceNumber}</span> · due{" "}
                        {formatDate(line.bill.dueDate)}
                      </span>
                    </td>
                    <Td>{formatAmount(line.amountMinor)}</Td>
                    <Td>
                      {line.withholdingTaxRate === null ? "" : formatAmount(line.withholdingBaseMinor)}
                    </Td>
                    <Td>
                      {line.withholdingTaxRate === null ? (
                        "—"
                      ) : (
                        <>
                          {formatAmount(line.withheldMinor)}
                          <span className="text-foreground-muted block text-xs">
                            {line.withholdingTaxRate.code}{" "}
                            {formatBasisPoints(line.withholdingBasisPoints ?? 0)}
                          </span>
                        </>
                      )}
                    </Td>
                    <Td>
                      <strong>{formatAmount(line.cashMinor)}</strong>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="rule-t ms-auto grid max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-1 px-4 py-3 text-sm tabular-nums">
            <dt className="text-foreground-muted">Bills settled</dt>
            <dd dir="ltr" className="text-end">
              {formatAmount(payment.amountMinor)}
            </dd>
            <dt className="text-foreground-muted">Tax withheld</dt>
            <dd dir="ltr" className="text-end">
              {formatAmount(payment.withheldMinor)}
            </dd>
            <dt className="font-bold">Paid out</dt>
            <dd dir="ltr" className="text-end font-bold" data-testid="payment-cash">
              {formatAmount(payment.cashMinor)}
            </dd>
          </dl>
        </Panel>
      </div>
    </div>
  );
}
