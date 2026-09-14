import type { Metadata } from "next";
import { BreadcrumbTitle } from "@/components/shell/breadcrumbs";
import Link from "next/link";
import { Plus } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader, Panel, PanelHeader } from "@/components/ui/primitives";
import { CRM_PERMISSIONS } from "@/modules/crm/contracts/permissions";
import {
  getContact,
  listAccountOptions,
  listTimeline,
} from "@/modules/crm/contracts/service";
import { ActivityTimeline } from "@/modules/crm/ui/activity-timeline";
import { AddActivityButton } from "@/modules/crm/ui/add-activity";
import { ContactFormButton } from "@/modules/crm/ui/contact-form";
import { DetailList } from "@/modules/crm/ui/detail-list";
import { formatDate } from "@/modules/crm/ui/format";
import { orNotFound } from "@/modules/crm/ui/page-helpers";
import { RelatedOpportunities } from "@/modules/crm/ui/related-opportunities";
import { getActor } from "@/platform/auth/current-user";
import { canAll } from "@/platform/authz/authz";
import { listDirectory } from "@/platform/iam/services/directory-service";

export const metadata: Metadata = { title: "Contact" };

/** A contact: who they are, the deals they're part of, and every interaction. */
export default async function ContactPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await getActor();

  const [contact, rights] = await Promise.all([
    orNotFound(getContact(actor, id)),
    canAll(actor, [
      CRM_PERMISSIONS.CONTACT_UPDATE,
      CRM_PERMISSIONS.ACCOUNT_READ,
      CRM_PERMISSIONS.OPPORTUNITY_CREATE,
      CRM_PERMISSIONS.ACTIVITY_READ,
      CRM_PERMISSIONS.ACTIVITY_CREATE,
      CRM_PERMISSIONS.ACTIVITY_UPDATE,
    ]),
  ]);
  const canEdit = rights[CRM_PERMISSIONS.CONTACT_UPDATE] === true;

  const [timeline, owners, accounts] = await Promise.all([
    rights[CRM_PERMISSIONS.ACTIVITY_READ] === true
      ? listTimeline(actor, { kind: "contact", id: contact.id })
      : Promise.resolve([]),
    listDirectory(actor),
    canEdit && rights[CRM_PERMISSIONS.ACCOUNT_READ] === true
      ? listAccountOptions(actor)
      : Promise.resolve([]),
  ]);

  const location = [contact.city, contact.country]
    .filter((part) => part !== null)
    .join(", ");

  return (
    <div>
      <p className="kicker text-primary-ink mb-1">Contact</p>
      <BreadcrumbTitle segment={id} label={contact.name} />
      <PageHeader
        title={contact.name}
        description={[contact.jobTitle, contact.account?.name ?? null]
          .filter((part) => part !== null)
          .join(" · ")}
        actions={
          <>
            {canEdit && (
              <ContactFormButton
                contact={contact}
                accounts={accounts}
                owners={owners}
                currentUserId={actor.id}
              />
            )}
            {contact.account !== null &&
              rights[CRM_PERMISSIONS.OPPORTUNITY_CREATE] === true && (
                <ButtonLink
                  href={`/crm/opportunities/new?accountId=${contact.account.id}`}
                  variant="primary"
                  icon={<Plus aria-hidden="true" size={15} />}
                >
                  New opportunity
                </ButtonLink>
              )}
          </>
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
        <div className="flex flex-col gap-4">
          <Panel>
            <PanelHeader kicker="Person" title="Details" />
            <DetailList
              items={[
                {
                  label: "Company",
                  value:
                    contact.account === null ? null : (
                      <Link
                        href={`/crm/accounts/${contact.account.id}`}
                        className="text-primary-ink font-extrabold hover:underline"
                      >
                        {contact.account.name}
                      </Link>
                    ),
                },
                { label: "Job title", value: contact.jobTitle },
                {
                  label: "Email",
                  value:
                    contact.email === null ? null : (
                      <a
                        href={`mailto:${contact.email}`}
                        className="text-primary-ink hover:underline"
                      >
                        {contact.email}
                      </a>
                    ),
                },
                {
                  label: "Phone",
                  value:
                    contact.phone === null ? null : (
                      <a
                        href={`tel:${contact.phone}`}
                        className="text-primary-ink hover:underline"
                        dir="ltr"
                      >
                        {contact.phone}
                      </a>
                    ),
                },
                { label: "Location", value: location },
                { label: "Owner", value: contact.owner?.name ?? "Unassigned" },
                { label: "Added", value: formatDate(contact.createdAt) },
              ]}
            />
          </Panel>

          <Panel>
            <PanelHeader
              kicker="Pipeline"
              title={`Opportunities (${contact.opportunities.length})`}
            />
            <RelatedOpportunities
              opportunities={contact.opportunities}
              emptyDescription="Deals where this person is the primary contact appear here."
            />
          </Panel>
        </div>

        <Panel>
          <PanelHeader
            kicker="Timeline"
            title="Activity"
            actions={
              rights[CRM_PERMISSIONS.ACTIVITY_CREATE] === true ? (
                <AddActivityButton
                  links={{ contactId: contact.id, accountId: contact.account?.id }}
                  owners={owners}
                  currentUserId={actor.id}
                />
              ) : undefined
            }
          />
          <ActivityTimeline
            activities={timeline}
            currentRecordId={contact.id}
            canCompleteTasks={rights[CRM_PERMISSIONS.ACTIVITY_UPDATE] === true}
          />
        </Panel>
      </div>
    </div>
  );
}
