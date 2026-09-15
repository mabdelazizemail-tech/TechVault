import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { BreadcrumbTitle } from "@/components/shell/breadcrumbs";
import { PageHeader } from "@/components/ui/primitives";
import { ERP_PERMISSIONS } from "@/modules/erp/contracts/permissions";
import {
  getJournal,
  listAccountOptions,
  listCostCentreOptions,
} from "@/modules/erp/contracts/service";
import { todayInCairo } from "@/modules/erp/ui/format";
import { JournalForm } from "@/modules/erp/ui/journal-form";
import { orNotFound } from "@/modules/erp/ui/page-helpers";
import { getActor } from "@/platform/auth/current-user";
import { canAllGlobally } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "Edit journal entry" };

/** Only a draft can be edited; a posted entry's page offers reversal instead. */
export default async function EditJournalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await getActor();
  const [entry, rights] = await Promise.all([
    orNotFound(getJournal(actor, id)),
    canAllGlobally(actor, [
      ERP_PERMISSIONS.JOURNAL_UPDATE,
      ERP_PERMISSIONS.ACCOUNT_READ,
      ERP_PERMISSIONS.COST_CENTRE_READ,
    ]),
  ]);
  if (rights[ERP_PERMISSIONS.JOURNAL_UPDATE] !== true) notFound();
  if (entry.status !== "DRAFT") redirect(`/erp/finance/journals/${id}`);

  const [accounts, costCentres] = await Promise.all([
    rights[ERP_PERMISSIONS.ACCOUNT_READ] === true
      ? listAccountOptions(actor, { postable: true })
      : Promise.resolve([]),
    rights[ERP_PERMISSIONS.COST_CENTRE_READ] === true
      ? listCostCentreOptions(actor)
      : Promise.resolve([]),
  ]);

  return (
    <div>
      <BreadcrumbTitle segment={id} label="Draft journal entry" />
      <PageHeader title="Edit draft journal entry" description={entry.description} />
      <JournalForm
        mode="edit"
        entryId={id}
        accounts={accounts}
        costCentres={costCentres}
        defaultDate={todayInCairo()}
        initial={{
          entryDate: entry.entryDate,
          description: entry.description,
          reference: entry.reference,
          lines: entry.lines.map((line) => ({
            accountId: line.account.id,
            costCentreId: line.costCentre?.id ?? null,
            description: line.description,
            debitMinor: line.debitMinor,
            creditMinor: line.creditMinor,
          })),
        }}
      />
    </div>
  );
}
