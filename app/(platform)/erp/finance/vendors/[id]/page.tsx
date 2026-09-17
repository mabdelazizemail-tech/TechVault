import { Pencil, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { BreadcrumbTitle } from "@/components/shell/breadcrumbs";
import { ButtonLink } from "@/components/ui/button";
import {
  Badge,
  EmptyState,
  PageHeader,
  Panel,
  PanelHeader,
  StatCard,
} from "@/components/ui/primitives";
import { ERP_PERMISSIONS } from "@/modules/erp/contracts/permissions";
import { getVendor } from "@/modules/erp/contracts/service";
import { BillStatusBadge, PaymentStatusBadge } from "@/modules/erp/ui/ap-badges";
import { Fact } from "@/modules/erp/ui/detail-parts";
import { formatAmount, formatDate } from "@/modules/erp/ui/format";
import { orNotFound } from "@/modules/erp/ui/page-helpers";
import { getActor } from "@/platform/auth/current-user";
import { canAllGlobally } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "Vendor" };

/** A vendor's payables: what is owed, its aging, recent bills and payments, and its defaults. */
export default async function VendorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await getActor();
  const [vendor, rights] = await Promise.all([
    orNotFound(getVendor(actor, id)),
    canAllGlobally(actor, [
      ERP_PERMISSIONS.AP_VENDOR_UPDATE,
      ERP_PERMISSIONS.AP_BILL_CREATE,
      ERP_PERMISSIONS.AP_PAYMENT_CREATE,
      ERP_PERMISSIONS.AR_CUSTOMER_READ,
    ]),
  ]);
  const base = `/erp/finance/vendors/${id}`;

  return (
    <div>
      <BreadcrumbTitle segment={id} label={vendor.name} />
      <PageHeader
        title={vendor.name}
        description={
          vendor.taxRegistrationNumber === null
            ? "No tax registration number recorded"
            : `Tax registration ${vendor.taxRegistrationNumber}`
        }
        actions={
          <>
            {rights[ERP_PERMISSIONS.AP_VENDOR_UPDATE] === true && (
              <ButtonLink
                href={`${base}/edit`}
                icon={<Pencil aria-hidden="true" className="size-4" />}
              >
                Edit
              </ButtonLink>
            )}
            {vendor.isActive && rights[ERP_PERMISSIONS.AP_BILL_CREATE] === true && (
              <ButtonLink
                href="/erp/finance/bills/new"
                icon={<Plus aria-hidden="true" className="size-4" />}
              >
                New bill
              </ButtonLink>
            )}
            {vendor.isActive &&
              vendor.outstandingMinor > 0 &&
              rights[ERP_PERMISSIONS.AP_PAYMENT_CREATE] === true && (
                <ButtonLink
                  href={`/erp/finance/payments/new?vendor=${vendor.id}`}
                  variant="primary"
                  icon={<Plus aria-hidden="true" className="size-4" />}
                >
                  Pay bills
                </ButtonLink>
              )}
          </>
        }
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Owed"
          value={formatAmount(vendor.outstandingMinor)}
          note={`${vendor.openBillCount} open bill${vendor.openBillCount === 1 ? "" : "s"}`}
        />
        <StatCard
          label="Overdue"
          value={
            <span className={vendor.overdueMinor > 0 ? "text-danger" : undefined}>
              {formatAmount(vendor.overdueMinor)}
            </span>
          }
        />
        <StatCard label="Billed" value={formatAmount(vendor.billedMinor)} note="Posted bills" />
        <StatCard
          label="Settled"
          value={formatAmount(vendor.paidMinor)}
          note="Paid out plus tax withheld"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4">
          <Panel>
            <PanelHeader title="Vendor" />
            <dl>
              <Fact label="Status">
                {vendor.isActive ? (
                  <Badge tone="success">Active</Badge>
                ) : (
                  <Badge tone="warning">Inactive</Badge>
                )}
              </Fact>
              {vendor.nameAr !== null && (
                <Fact label="Arabic name">
                  <span dir="rtl" lang="ar">
                    {vendor.nameAr}
                  </span>
                </Fact>
              )}
              <Fact label="CRM company">
                {vendor.crmAccount === null ? (
                  "Not linked"
                ) : (
                  <span dir="auto">
                    {vendor.crmAccount.name}
                    {!vendor.crmAccount.existsInCrm && " (no longer in CRM)"}
                  </span>
                )}
              </Fact>
              <Fact label="Email">
                {vendor.email === null ? "—" : <span dir="ltr">{vendor.email}</span>}
              </Fact>
              <Fact label="Phone">
                {vendor.phone === null ? "—" : <span dir="ltr">{vendor.phone}</span>}
              </Fact>
              <Fact label="Address">
                {vendor.address === null ? "—" : <span dir="auto">{vendor.address}</span>}
              </Fact>
              <Fact label="Payment terms">
                {vendor.paymentTermsDays === null
                  ? `${vendor.defaultPaymentTermsDays} days (AP default)`
                  : `${vendor.paymentTermsDays} days`}
              </Fact>
              <Fact label="Payable account">
                {vendor.payableAccount === null
                  ? "AP default"
                  : `${vendor.payableAccount.code} ${vendor.payableAccount.name}`}
              </Fact>
              <Fact label="Default expense account">
                {vendor.defaultExpenseAccount === null
                  ? "—"
                  : `${vendor.defaultExpenseAccount.code} ${vendor.defaultExpenseAccount.name}`}
              </Fact>
              <Fact label="Default withholding">
                {vendor.defaultWithholdingTaxRate === null
                  ? "None"
                  : `${vendor.defaultWithholdingTaxRate.code} ${vendor.defaultWithholdingTaxRate.name}`}
              </Fact>
            </dl>
            {vendor.notes !== null && (
              <p dir="auto" className="text-foreground-muted rule-t px-4 py-3 text-sm">
                {vendor.notes}
              </p>
            )}
          </Panel>

          <Panel>
            <PanelHeader
              title="Aging"
              description={`Owed by days past due, as of ${formatDate(vendor.aging.asOf)}.`}
            />
            <dl>
              {vendor.aging.bucketLabels.map((label, index) => (
                <Fact key={label} label={label}>
                  <span dir="ltr" className="tabular-nums">
                    {formatAmount(vendor.aging.bucketsMinor[index] ?? 0)}
                  </span>
                </Fact>
              ))}
            </dl>
          </Panel>
        </div>

        <div className="flex flex-col gap-4 lg:col-span-2">
          <Panel className="overflow-hidden">
            <PanelHeader
              title="Recent bills"
              actions={
                <Link
                  href={`/erp/finance/bills?vendor=${vendor.id}`}
                  className="text-sm font-bold hover:underline"
                >
                  All bills
                </Link>
              }
            />
            {vendor.bills.length === 0 ? (
              <EmptyState title="No bills" description="Bills from this vendor appear here." />
            ) : (
              <ul className="divide-border divide-y">
                {vendor.bills.map((bill) => (
                  <li key={bill.id}>
                    <Link
                      href={`/erp/finance/bills/${bill.id}`}
                      className="hover:bg-surface-hover flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm"
                    >
                      <span className="min-w-0">
                        <span className="font-semibold" dir="ltr">
                          {bill.billNumber ?? "Draft"}
                        </span>
                        <span className="text-foreground-muted ms-2">
                          <span dir="auto">{bill.vendorInvoiceNumber}</span> ·{" "}
                          {formatDate(bill.billDate)}
                        </span>
                      </span>
                      <span className="flex items-center gap-3">
                        <BillStatusBadge status={bill.status} />
                        <span dir="ltr" className="font-bold tabular-nums">
                          {formatAmount(bill.totalMinor)}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel className="overflow-hidden">
            <PanelHeader
              title="Recent payments"
              actions={
                <Link
                  href={`/erp/finance/payments?vendor=${vendor.id}`}
                  className="text-sm font-bold hover:underline"
                >
                  All payments
                </Link>
              }
            />
            {vendor.payments.length === 0 ? (
              <EmptyState
                title="No payments"
                description="Payments to this vendor appear here."
              />
            ) : (
              <ul className="divide-border divide-y">
                {vendor.payments.map((payment) => (
                  <li key={payment.id}>
                    <Link
                      href={`/erp/finance/payments/${payment.id}`}
                      className="hover:bg-surface-hover flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm"
                    >
                      <span className="min-w-0">
                        <span className="font-semibold" dir="ltr">
                          {payment.paymentNumber ?? "Draft"}
                        </span>
                        <span className="text-foreground-muted ms-2">
                          {formatDate(payment.paymentDate)} · {payment.paymentMethod.name}
                        </span>
                      </span>
                      <span className="flex items-center gap-3">
                        <PaymentStatusBadge status={payment.status} />
                        <span dir="ltr" className="font-bold tabular-nums">
                          {formatAmount(payment.cashMinor)}
                        </span>
                      </span>
                    </Link>
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
