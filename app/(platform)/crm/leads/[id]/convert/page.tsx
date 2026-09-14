import type { Metadata } from "next";
import { BreadcrumbTitle } from "@/components/shell/breadcrumbs";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/primitives";
import { CRM_PERMISSIONS } from "@/modules/crm/contracts/permissions";
import {
  getConversionPreview,
  listAccountOptions,
} from "@/modules/crm/contracts/service";
import { ConvertLeadForm } from "@/modules/crm/ui/convert-lead-form";
import { orNotFound } from "@/modules/crm/ui/page-helpers";
import { getActor } from "@/platform/auth/current-user";
import { canAll } from "@/platform/authz/authz";
import { listDirectory } from "@/platform/iam/services/directory-service";

export const metadata: Metadata = { title: "Convert lead" };

/** Lead conversion: review what will be created or reused, then confirm. */
export default async function ConvertLeadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await getActor();

  const [preview, rights] = await Promise.all([
    orNotFound(getConversionPreview(actor, id)),
    canAll(actor, [
      CRM_PERMISSIONS.LEAD_UPDATE,
      CRM_PERMISSIONS.OPPORTUNITY_CREATE,
      CRM_PERMISSIONS.ACCOUNT_READ,
    ]),
  ]);
  if (preview.lead.status === "CONVERTED") redirect(`/crm/leads/${preview.lead.id}`);
  if (rights[CRM_PERMISSIONS.LEAD_UPDATE] !== true) notFound();

  const [owners, accounts] = await Promise.all([
    listDirectory(actor),
    rights[CRM_PERMISSIONS.ACCOUNT_READ] === true
      ? listAccountOptions(actor)
      : Promise.resolve([]),
  ]);

  return (
    <div>
      <p className="kicker text-primary-ink mb-1">Convert lead</p>
      <BreadcrumbTitle segment={id} label={preview.lead.name} />
      <PageHeader
        title={preview.lead.name}
        description="Review what conversion will create or reuse. Nothing changes until you confirm."
      />
      <ConvertLeadForm
        lead={preview.lead}
        matchingAccount={preview.matchingAccount}
        matchingContact={preview.matchingContact}
        stages={preview.stages.filter((stage) => stage.kind === "OPEN")}
        accounts={accounts}
        owners={owners}
        currentUserId={actor.id}
        canCreateOpportunity={rights[CRM_PERMISSIONS.OPPORTUNITY_CREATE] === true}
      />
    </div>
  );
}
