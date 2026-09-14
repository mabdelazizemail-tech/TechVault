import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, PageHeader, Panel } from "@/components/ui/primitives";
import { CRM_PERMISSIONS } from "@/modules/crm/contracts/permissions";
import {
  listAccountOptions,
  listContactOptions,
  listStages,
} from "@/modules/crm/contracts/service";
import { OpportunityForm } from "@/modules/crm/ui/opportunity-form";
import { flatParams, uuidParam } from "@/modules/crm/ui/page-helpers";
import { getActor } from "@/platform/auth/current-user";
import { canAll } from "@/platform/authz/authz";
import { listDirectory } from "@/platform/iam/services/directory-service";

export const metadata: Metadata = { title: "New opportunity" };

/** A new opportunity for an existing company — usually started from the company page. */
export default async function NewOpportunityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = flatParams(await searchParams);
  const actor = await getActor();
  const rights = await canAll(actor, [
    CRM_PERMISSIONS.OPPORTUNITY_CREATE,
    CRM_PERMISSIONS.ACCOUNT_READ,
    CRM_PERMISSIONS.CONTACT_READ,
  ]);
  if (rights[CRM_PERMISSIONS.OPPORTUNITY_CREATE] !== true) notFound();

  const [accounts, contacts, stages, owners] = await Promise.all([
    rights[CRM_PERMISSIONS.ACCOUNT_READ] === true
      ? listAccountOptions(actor)
      : Promise.resolve([]),
    rights[CRM_PERMISSIONS.CONTACT_READ] === true
      ? listContactOptions(actor)
      : Promise.resolve([]),
    listStages(actor),
    listDirectory(actor),
  ]);
  const defaultAccountId = uuidParam(params.accountId);

  return (
    <div>
      <PageHeader
        title="New opportunity"
        description="A deal with a company. It goes straight onto the pipeline in the stage you choose."
      />
      <Panel className="max-w-3xl px-4 py-5 sm:px-6">
        {accounts.length === 0 ? (
          <EmptyState
            title="Add a company first"
            description="Every opportunity belongs to a company. Create the company, then start the deal from its page."
            action={
              <ButtonLink href="/crm/accounts" variant="primary">
                Go to companies
              </ButtonLink>
            }
          />
        ) : (
          <OpportunityForm
            options={{ accounts, contacts, stages, owners }}
            currentUserId={actor.id}
            defaultAccountId={defaultAccountId}
            cancelHref={
              defaultAccountId !== undefined
                ? `/crm/accounts/${defaultAccountId}`
                : "/crm/opportunities"
            }
          />
        )}
      </Panel>
    </div>
  );
}
