import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EmptyState, PageHeader, Panel } from "@/components/ui/primitives";
import { ERP_PERMISSIONS } from "@/modules/erp/contracts/permissions";
import {
  getCreditableInvoice,
  listAccountOptions,
  listCostCentreOptions,
  listTaxRates,
} from "@/modules/erp/contracts/service";
import { CreditNoteForm } from "@/modules/erp/ui/credit-note-form";
import { todayInCairo } from "@/modules/erp/ui/format";
import { flatParams, orNotFound } from "@/modules/erp/ui/page-helpers";
import { getActor } from "@/platform/auth/current-user";
import { canAllGlobally } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "New credit note" };

/** Raised against one posted invoice, whose id arrives as ?invoice=. */
export default async function NewCreditNotePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = flatParams(await searchParams);
  const actor = await getActor();
  const rights = await canAllGlobally(actor, [
    ERP_PERMISSIONS.AR_CREDIT_NOTE_CREATE,
    ERP_PERMISSIONS.ACCOUNT_READ,
    ERP_PERMISSIONS.COST_CENTRE_READ,
  ]);
  if (rights[ERP_PERMISSIONS.AR_CREDIT_NOTE_CREATE] !== true) notFound();
  if (params.invoice === undefined) {
    return (
      <div>
        <PageHeader title="New credit note" />
        <Panel>
          <EmptyState
            title="Choose an invoice first"
            description="A credit note always corrects one posted invoice. Open the invoice and choose Credit note."
          />
        </Panel>
      </div>
    );
  }

  const [invoice, taxRates, accounts, costCentres] = await Promise.all([
    orNotFound(getCreditableInvoice(actor, params.invoice)),
    listTaxRates(actor, { activeOnly: true }),
    rights[ERP_PERMISSIONS.ACCOUNT_READ] === true
      ? listAccountOptions(actor, { postable: true })
      : Promise.resolve([]),
    rights[ERP_PERMISSIONS.COST_CENTRE_READ] === true
      ? listCostCentreOptions(actor)
      : Promise.resolve([]),
  ]);

  return (
    <div>
      <PageHeader
        title="New credit note"
        description={`Correcting invoice ${invoice.invoiceNumber}. Saved as a draft, then submitted for approval.`}
      />
      <CreditNoteForm
        mode="create"
        invoice={invoice}
        taxRates={taxRates}
        revenueAccounts={accounts.filter((account) => account.type === "REVENUE")}
        costCentres={costCentres}
        defaultDate={todayInCairo()}
        initial={{
          creditNoteDate: "",
          reason: "",
          notes: null,
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
