import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { BreadcrumbTitle } from "@/components/shell/breadcrumbs";
import { PageHeader } from "@/components/ui/primitives";
import { ERP_PERMISSIONS } from "@/modules/erp/contracts/permissions";
import {
  getInvoice,
  listAccountOptions,
  listCostCentreOptions,
  listTaxRates,
} from "@/modules/erp/contracts/service";
import { todayInCairo } from "@/modules/erp/ui/format";
import { InvoiceForm } from "@/modules/erp/ui/invoice-form";
import { orNotFound } from "@/modules/erp/ui/page-helpers";
import { getActor } from "@/platform/auth/current-user";
import { canAll } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "Edit invoice" };

/** Only a draft can be edited; a rejected invoice returns to draft. */
export default async function EditInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await getActor();
  const [invoice, rights] = await Promise.all([
    orNotFound(getInvoice(actor, id)),
    canAll(actor, [
      ERP_PERMISSIONS.AR_INVOICE_UPDATE,
      ERP_PERMISSIONS.ACCOUNT_READ,
      ERP_PERMISSIONS.COST_CENTRE_READ,
    ]),
  ]);
  if (rights[ERP_PERMISSIONS.AR_INVOICE_UPDATE] !== true) notFound();
  if (invoice.status !== "DRAFT") redirect(`/erp/finance/invoices/${id}`);

  const [accounts, taxRates, costCentres] = await Promise.all([
    rights[ERP_PERMISSIONS.ACCOUNT_READ] === true
      ? listAccountOptions(actor, { postable: true })
      : Promise.resolve([]),
    listTaxRates(actor, { activeOnly: true }),
    rights[ERP_PERMISSIONS.COST_CENTRE_READ] === true
      ? listCostCentreOptions(actor)
      : Promise.resolve([]),
  ]);

  return (
    <div>
      <BreadcrumbTitle segment={id} label="Draft invoice" />
      <PageHeader title="Edit draft invoice" description={invoice.customer.name} />
      <InvoiceForm
        mode="edit"
        invoiceId={id}
        revenueAccounts={accounts.filter((account) => account.type === "REVENUE")}
        taxRates={taxRates}
        costCentres={costCentres}
        defaultDate={todayInCairo()}
        initial={{
          customer: invoice.customer,
          invoiceDate: invoice.invoiceDate,
          dueDate: invoice.dueDate,
          reference: invoice.reference,
          notes: invoice.notes,
          lines: invoice.lines.map((line) => ({
            description: line.description,
            quantity: line.quantity,
            unitPriceMinor: line.unitPriceMinor,
            discountMinor: line.discountMinor,
            taxRateId: line.taxRate?.id ?? null,
            revenueAccountId: line.revenueAccount.id,
            costCentreId: line.costCentre?.id ?? null,
          })),
        }}
      />
    </div>
  );
}
