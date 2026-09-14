import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/primitives";
import { CRM_PERMISSIONS } from "@/modules/crm/contracts/permissions";
import { listStages } from "@/modules/crm/contracts/service";
import { LeadWizard } from "@/modules/crm/ui/lead-wizard";
import { getActor } from "@/platform/auth/current-user";
import { can } from "@/platform/authz/authz";
import { listDirectory } from "@/platform/iam/services/directory-service";

export const metadata: Metadata = { title: "New lead" };

export default async function NewLeadPage() {
  const actor = await getActor();
  if (!(await can(actor, CRM_PERMISSIONS.LEAD_CREATE))) notFound();

  const [stages, owners] = await Promise.all([listStages(actor), listDirectory(actor)]);

  return (
    <div>
      <PageHeader
        title="New lead"
        description="Capture the lead, qualify it, and decide whether there's a deal to pursue."
      />
      <LeadWizard
        owners={owners}
        stages={stages.filter((stage) => stage.kind === "OPEN")}
        currentUserId={actor.id}
      />
    </div>
  );
}
