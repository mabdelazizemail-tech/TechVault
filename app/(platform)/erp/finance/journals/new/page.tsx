import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/primitives";
import { ERP_PERMISSIONS } from "@/modules/erp/contracts/permissions";
import {
  listAccountOptions,
  listCostCentreOptions,
} from "@/modules/erp/contracts/service";
import { todayInCairo } from "@/modules/erp/ui/format";
import { JournalForm } from "@/modules/erp/ui/journal-form";
import { getActor } from "@/platform/auth/current-user";
import { canAllGlobally } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "New journal entry" };

export default async function NewJournalPage() {
  const actor = await getActor();
  const rights = await canAllGlobally(actor, [
    ERP_PERMISSIONS.JOURNAL_CREATE,
    ERP_PERMISSIONS.ACCOUNT_READ,
    ERP_PERMISSIONS.COST_CENTRE_READ,
  ]);
  if (rights[ERP_PERMISSIONS.JOURNAL_CREATE] !== true) notFound();

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
      <PageHeader
        title="New journal entry"
        description="Saved as a draft. Debits must equal credits before it can be posted."
      />
      <JournalForm
        mode="create"
        accounts={accounts}
        costCentres={costCentres}
        defaultDate={todayInCairo()}
      />
    </div>
  );
}
