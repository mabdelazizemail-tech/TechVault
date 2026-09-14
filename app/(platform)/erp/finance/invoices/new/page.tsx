import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/primitives";
import { ERP_PERMISSIONS } from "@/modules/erp/contracts/permissions";
import {
  listAccountOptions,
  listCostCentreOptions,
  listTaxRates,
} from "@/modules/erp/contracts/service";
import { todayInCairo } from "@/modules/erp/ui/format";
import { InvoiceForm } from "@/modules/erp/ui/invoice-form";
import { getActor } from "@/platform/auth/current-user";
import { canAll } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "New invoice" };

export default async function NewInvoicePage() {
  const actor = await getActor();
  const rights = await canAll(actor, [
    ERP_PERMISSIONS.AR_INVOICE_CREATE,
    ERP_PERMISSIONS.ACCOUNT_READ,
    ERP_PERMISSIONS.COST_CENTRE_READ,
  ]);
  if (rights[ERP_PERMISSIONS.AR_INVOICE_CREATE] !== true) notFound();

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
      <PageHeader
        title="New invoice"
        description="Saved as a draft. The server prices every line; submit it for approval from its page."
      />
      <InvoiceForm
        mode="create"
        revenueAccounts={accounts.filter((account) => account.type === "REVENUE")}
        taxRates={taxRates}
        costCentres={costCentres}
        defaultDate={todayInCairo()}
      />
    </div>
  );
}
