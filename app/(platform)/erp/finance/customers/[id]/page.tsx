import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { BreadcrumbTitle } from "@/components/shell/breadcrumbs";
import { ButtonLink } from "@/components/ui/button";
import {
  EmptyState,
  PageHeader,
  Panel,
  PanelHeader,
  StatCard,
} from "@/components/ui/primitives";
import { ERP_PERMISSIONS } from "@/modules/erp/contracts/permissions";
import { getArCustomer, listAccountOptions } from "@/modules/erp/contracts/service";
import { InvoiceStatusBadge, ReceiptStatusBadge } from "@/modules/erp/ui/ar-badges";
import { CustomerProfileFormButton } from "@/modules/erp/ui/ar-settings-forms";
import { formatAmount, formatDate } from "@/modules/erp/ui/format";
import { flatParams, orNotFound } from "@/modules/erp/ui/page-helpers";
import { getActor } from "@/platform/auth/current-user";
import { canAllGlobally } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "Customer" };

/** A CRM customer's receivables: balance, aging, statement, documents and billing profile. */
export default async function CustomerPage({
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
    orNotFound(getArCustomer(actor, id, query)),
    canAllGlobally(actor, [
      ERP_PERMISSIONS.AR_CUSTOMER_UPDATE,
      ERP_PERMISSIONS.AR_INVOICE_CREATE,
      ERP_PERMISSIONS.AR_RECEIPT_CREATE,
      ERP_PERMISSIONS.ACCOUNT_READ,
    ]),
  ]);
  const canEdit = rights[ERP_PERMISSIONS.AR_CUSTOMER_UPDATE] === true;
  const assetAccounts =
    canEdit && rights[ERP_PERMISSIONS.ACCOUNT_READ] === true
      ? (await listAccountOptions(actor, { postable: true })).filter(
          (option) => option.type === "ASSET",
        )
      : [];
  const base = `/erp/finance/customers/${id}`;

  return (
    <div>
      <BreadcrumbTitle segment={id} label={account.customer.name} />
      <PageHeader
        title={account.customer.name}
        description={
          account.customer.existsInCrm
            ? "Receivables for this CRM customer, in EGP."
            : "This company no longer exists in CRM; its receivables history remains."
        }
        actions={
          <>
            {rights[ERP_PERMISSIONS.AR_RECEIPT_CREATE] === true && (
              <ButtonLink
                href="/erp/finance/receipts/new"
                icon={<Plus aria-hidden="true" className="size-4" />}
              >
                New receipt
              </ButtonLink>
            )}
            {rights[ERP_PERMISSIONS.AR_INVOICE_CREATE] === true && (
              <ButtonLink
                href="/erp/finance/invoices/new"
                variant="primary"
                icon={<Plus aria-hidden="true" className="size-4" />}
              >
                New invoice
              </ButtonLink>
            )}
          </>
        }
      />

      <section
        aria-label="Balance"
        className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <StatCard
          label="Balance"
          value={formatAmount(account.balanceMinor)}
          note="Invoiced − received"
        />
        <StatCard
          label="Overdue"
          value={formatAmount(account.overdueMinor)}
          note="Past due date"
        />
        <StatCard
          label="Unapplied receipts"
          value={formatAmount(account.unappliedMinor)}
          note="Not yet allocated"
        />
        <StatCard
          label="Credit limit"
          value={
            account.profile?.creditLimitMinor === null || account.profile === null
              ? "—"
              : formatAmount(account.profile.creditLimitMinor)
          }
          note={
            account.creditLimitExceeded
              ? "Balance is over the limit"
              : "Shown, not enforced"
          }
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4">
          <Panel>
            <PanelHeader
              title="Billing profile"
              actions={
                canEdit && account.customer.existsInCrm ? (
                  <CustomerProfileFormButton
                    crmAccountId={id}
                    profile={account.profile}
                    assetAccounts={assetAccounts}
                    defaultPaymentTermsDays={account.defaultPaymentTermsDays}
                  />
                ) : undefined
              }
            />
            <dl>
              <Fact label="Payment terms">
                {account.profile?.paymentTermsDays ?? account.defaultPaymentTermsDays}{" "}
                days
                {(account.profile?.paymentTermsDays ?? null) === null && " (default)"}
              </Fact>
              <Fact label="Receivable account">
                {account.profile?.receivableAccount === null || account.profile === null
                  ? "AR default"
                  : `${account.profile.receivableAccount.code} ${account.profile.receivableAccount.name}`}
              </Fact>
              <Fact label="Notes">{account.profile?.notes ?? "—"}</Fact>
            </dl>
          </Panel>

          <Panel>
            <PanelHeader
              title="Aging"
              description={`Outstanding by days past due, as of ${formatDate(account.aging.asOf)}.`}
            />
            <dl>
              {account.aging.bucketLabels.map((label, index) => (
                <Fact key={label} label={label}>
                  <span dir="ltr" className="tabular-nums">
                    {formatAmount(account.aging.bucketsMinor[index] ?? 0)}
                  </span>
                </Fact>
              ))}
            </dl>
          </Panel>
        </div>

        <div className="flex flex-col gap-4 lg:col-span-2">
          <Panel>
            <PanelHeader
              title="Statement"
              description="Opening balance + invoices − receipts = closing balance. Credit notes arrive in a later phase; voided documents are excluded."
            />
            <form
              method="get"
              action={base}
              className="flex flex-wrap items-end gap-2 px-4 pt-3"
            >
              <DateInput name="from" label="From" value={query.from} />
              <DateInput name="to" label="To" value={query.to} />
              <button
                type="submit"
                className="border-border bg-surface hover:bg-surface-hover min-h-9 cursor-pointer border-2 px-3 text-sm font-bold"
              >
                Apply
              </button>
            </form>
            <dl className="grid gap-x-6 gap-y-1 px-4 py-3 text-sm tabular-nums sm:grid-cols-4">
              <Figure label="Opening" value={account.statement.openingMinor} />
              <Figure label="+ Invoices" value={account.statement.invoicedMinor} />
              <Figure label="− Receipts" value={account.statement.receivedMinor} />
              <Figure label="= Closing" value={account.statement.closingMinor} strong />
            </dl>
          </Panel>

          <Panel className="overflow-hidden">
            <PanelHeader
              title="Recent invoices"
              actions={
                <Link
                  href={`/erp/finance/invoices?q=${encodeURIComponent(account.customer.name)}`}
                  className="text-primary-ink text-xs font-bold underline"
                >
                  All invoices
                </Link>
              }
            />
            {account.invoices.length === 0 ? (
              <EmptyState
                title="No invoices"
                description="Invoices for this customer appear here."
              />
            ) : (
              <ul className="divide-border divide-y">
                {account.invoices.map((invoice) => (
                  <li key={invoice.id}>
                    <Link
                      href={`/erp/finance/invoices/${invoice.id}`}
                      className="hover:bg-surface-hover flex items-center gap-3 px-4 py-2.5 text-sm"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">
                          {invoice.invoiceNumber ?? "Draft"}
                        </span>
                        <span className="text-foreground-muted text-xs">
                          {formatDate(invoice.invoiceDate)} · due{" "}
                          {formatDate(invoice.dueDate)}
                        </span>
                      </span>
                      <InvoiceStatusBadge status={invoice.status} />
                      <span dir="ltr" className="w-28 text-end font-bold tabular-nums">
                        {formatAmount(invoice.outstandingMinor)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel className="overflow-hidden">
            <PanelHeader title="Recent receipts" />
            {account.receipts.length === 0 ? (
              <EmptyState
                title="No receipts"
                description="Receipts from this customer appear here."
              />
            ) : (
              <ul className="divide-border divide-y">
                {account.receipts.map((receipt) => (
                  <li key={receipt.id}>
                    <Link
                      href={`/erp/finance/receipts/${receipt.id}`}
                      className="hover:bg-surface-hover flex items-center gap-3 px-4 py-2.5 text-sm"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">
                          {receipt.receiptNumber ?? "Draft"}
                        </span>
                        <span className="text-foreground-muted text-xs">
                          {formatDate(receipt.receiptDate)} · {receipt.paymentMethod.name}
                        </span>
                      </span>
                      <ReceiptStatusBadge status={receipt.status} />
                      <span dir="ltr" className="w-28 text-end font-bold tabular-nums">
                        {formatAmount(receipt.amountMinor)}
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

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-border flex items-baseline justify-between gap-3 border-b px-4 py-2.5 text-sm last:border-0">
      <dt className="text-foreground-muted shrink-0">{label}</dt>
      <dd className="text-foreground min-w-0 text-end" dir="auto">
        {children}
      </dd>
    </div>
  );
}

function Figure({
  label,
  value,
  strong,
}: {
  label: string;
  value: number;
  strong?: boolean;
}) {
  return (
    <div>
      <dt className="label-caps">{label}</dt>
      <dd dir="ltr" className={strong === true ? "text-lg font-bold" : "text-lg"}>
        {formatAmount(value)}
      </dd>
    </div>
  );
}

function DateInput({
  name,
  label,
  value,
}: {
  name: string;
  label: string;
  value: string | undefined;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-semibold">
      {label}
      <input
        type="date"
        name={name}
        defaultValue={value}
        className="border-border-strong bg-surface min-h-9 border-2 px-2 text-sm"
      />
    </label>
  );
}
