import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { BreadcrumbTitle } from "@/components/shell/breadcrumbs";
import { PageHeader } from "@/components/ui/primitives";
import { ERP_PERMISSIONS } from "@/modules/erp/contracts/permissions";
import {
  getCreditNote,
  getCreditableInvoice,
  listAccountOptions,
  listCostCentreOptions,
  listTaxRates,
} from "@/modules/erp/contracts/service";
import { CreditNoteForm } from "@/modules/erp/ui/credit-note-form";
import { todayInCairo } from "@/modules/erp/ui/format";
import { orNotFound } from "@/modules/erp/ui/page-helpers";
import { getActor } from "@/platform/auth/current-user";
import { canAllGlobally } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "Edit credit note" };

/** Only a draft can be edited; a posted credit note's page offers voiding instead. */
export default async function EditCreditNotePage({
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
      ERP_PERMISSIONS.AR_CREDIT_NOTE_CREATE,
      ERP_PERMISSIONS.ACCOUNT_READ,
      ERP_PERMISSIONS.COST_CENTRE_READ,
    ]),
  ]);
  if (rights[ERP_PERMISSIONS.AR_CREDIT_NOTE_UPDATE] !== true) notFound();
  if (creditNote.status !== "DRAFT") redirect(`/erp/finance/credit-notes/${id}`);

  const [invoice, taxRates, accounts, costCentres] = await Promise.all([
    orNotFound(getCreditableInvoice(actor, creditNote.invoice.id)),
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
      <BreadcrumbTitle segment={id} label="Draft credit note" />
      <PageHeader
        title="Edit draft credit note"
        description={`Against invoice ${invoice.invoiceNumber}.`}
      />
      <CreditNoteForm
        mode="edit"
        creditNoteId={id}
        invoice={invoice}
        taxRates={taxRates}
        revenueAccounts={accounts.filter((account) => account.type === "REVENUE")}
        costCentres={costCentres}
        defaultDate={todayInCairo()}
        initial={{
          creditNoteDate: creditNote.creditNoteDate,
          reason: creditNote.reason,
          notes: creditNote.notes,
          lines: creditNote.lines.map((line) => ({
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
