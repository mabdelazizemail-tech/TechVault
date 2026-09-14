import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BreadcrumbTitle } from "@/components/shell/breadcrumbs";
import Link from "next/link";
import { Plus } from "lucide-react";
import type { ReactNode } from "react";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, PageHeader, Panel, PanelHeader } from "@/components/ui/primitives";
import { CRM_PERMISSIONS } from "@/modules/crm/contracts/permissions";
import { getAccount, listTimeline } from "@/modules/crm/contracts/service";
import { ActivityTimeline } from "@/modules/crm/ui/activity-timeline";
import { AccountFormButton } from "@/modules/crm/ui/account-form";
import { AddActivityButton } from "@/modules/crm/ui/add-activity";
import { Avatar, LeadStatusBadge } from "@/modules/crm/ui/badges";
import { ContactFormButton } from "@/modules/crm/ui/contact-form";
import { DetailList } from "@/modules/crm/ui/detail-list";
import { formatDate, formatMoney } from "@/modules/crm/ui/format";
import { orNotFound, uuidParam } from "@/modules/crm/ui/page-helpers";
import { RelatedOpportunities } from "@/modules/crm/ui/related-opportunities";
import { getActor } from "@/platform/auth/current-user";
import { canAll } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "Company" };

/** A company and everything related to it: contacts, deals, leads, activity. */
export default async function AccountPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await getActor();

  // One round: the timeline and option lists need only the id from the URL and
  // your permissions, and every service checks its own permission. A malformed id
  // is a 404 up front, so no service ever sees it.
  if (uuidParam(id) === undefined) notFound();
  const rightsPromise = canAll(actor, [
    CRM_PERMISSIONS.ACCOUNT_UPDATE,
    CRM_PERMISSIONS.CONTACT_CREATE,
    CRM_PERMISSIONS.OPPORTUNITY_CREATE,
    CRM_PERMISSIONS.ACTIVITY_READ,
    CRM_PERMISSIONS.ACTIVITY_CREATE,
    CRM_PERMISSIONS.ACTIVITY_UPDATE,
  ]);
  const [account, rights, timeline] = await Promise.all([
    orNotFound(getAccount(actor, id)),
    rightsPromise,
    rightsPromise.then((granted) =>
      granted[CRM_PERMISSIONS.ACTIVITY_READ] === true
        ? listTimeline(actor, { kind: "account", id })
        : [],
    ),
  ]);

  const location = [account.city, account.country]
    .filter((part) => part !== null)
    .join(", ");
  const thisAccount = [{ id: account.id, name: account.name }];

  return (
    <div>
      <p className="kicker text-primary-ink mb-1">Company</p>
      <BreadcrumbTitle segment={id} label={account.name} />
      <PageHeader
        title={account.name}
        description={[account.industry, location]
          .filter((part) => part !== null && part !== "")
          .join(" · ")}
        actions={
          <>
            {rights[CRM_PERMISSIONS.ACCOUNT_UPDATE] === true && (
              <AccountFormButton account={account} currentUserId={actor.id} />
            )}
            {rights[CRM_PERMISSIONS.OPPORTUNITY_CREATE] === true && (
              <ButtonLink
                href={`/crm/opportunities/new?accountId=${account.id}`}
                variant="primary"
                icon={<Plus aria-hidden="true" size={15} />}
              >
                New opportunity
              </ButtonLink>
            )}
          </>
        }
      />

      <section
        aria-label="Company figures"
        className="bg-border border-border mb-4 grid grid-cols-2 gap-px border md:grid-cols-4"
      >
        <Figure label="Open pipeline">
          {account.pipeline.length === 0
            ? "—"
            : account.pipeline.map((total) => (
                <span key={total.currency} className="block">
                  {formatMoney(total.amountMinor, total.currency)}
                </span>
              ))}
        </Figure>
        <Figure label="Open deals">{account.openOpportunityCount}</Figure>
        <Figure label="Contacts">{account.contactCount}</Figure>
        <Figure label="Activities">{account.activityCount}</Figure>
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
        <div className="flex flex-col gap-4">
          <Panel>
            <PanelHeader kicker="Company" title="Details" />
            <DetailList
              items={[
                {
                  label: "Website",
                  value:
                    account.website === null ? null : (
                      <a
                        href={account.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary-ink hover:underline"
                      >
                        {account.website.replace(/^https?:\/\//, "")}
                      </a>
                    ),
                },
                {
                  label: "Phone",
                  value:
                    account.phone === null ? null : (
                      <a
                        href={`tel:${account.phone}`}
                        className="text-primary-ink hover:underline"
                        dir="ltr"
                      >
                        {account.phone}
                      </a>
                    ),
                },
                { label: "Industry", value: account.industry },
                { label: "Employees", value: account.companySize },
                { label: "Location", value: location },
                { label: "Owner", value: account.owner?.name ?? "Unassigned" },
                { label: "Customer since", value: formatDate(account.createdAt) },
                {
                  label: "About",
                  value:
                    account.description === null ? null : (
                      <span className="whitespace-pre-line">{account.description}</span>
                    ),
                },
              ]}
            />
          </Panel>

          <Panel>
            <PanelHeader
              kicker="People"
              title={`Contacts (${account.contacts.length})`}
              actions={
                rights[CRM_PERMISSIONS.CONTACT_CREATE] === true ? (
                  <ContactFormButton
                    accounts={thisAccount}
                    currentUserId={actor.id}
                    defaultAccountId={account.id}
                    variant="secondary"
                  />
                ) : undefined
              }
            />
            {account.contacts.length === 0 ? (
              <EmptyState
                title="No contacts yet"
                description="Add the people you deal with at this company."
              />
            ) : (
              <ul>
                {account.contacts.map((contact) => (
                  <li
                    key={contact.id}
                    className="border-border hover:bg-surface-hover relative flex items-center gap-3 border-b px-4 py-2.5 last:border-0"
                  >
                    <Avatar name={contact.name} size="md" />
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/crm/contacts/${contact.id}`}
                        className="text-foreground block truncate text-[13.5px] font-extrabold after:absolute after:inset-0 hover:underline"
                        dir="auto"
                      >
                        {contact.name}
                      </Link>
                      <p className="text-foreground-muted truncate text-xs">
                        {[contact.jobTitle, contact.email]
                          .filter((part) => part !== null)
                          .join(" · ") || "—"}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {account.leads.length > 0 && (
            <Panel>
              <PanelHeader kicker="History" title={`Leads (${account.leads.length})`} />
              <ul>
                {account.leads.map((lead) => (
                  <li
                    key={lead.id}
                    className="border-border hover:bg-surface-hover relative flex items-center justify-between gap-3 border-b px-4 py-2.5 last:border-0"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/crm/leads/${lead.id}`}
                        className="text-foreground block truncate text-[13.5px] font-extrabold after:absolute after:inset-0 hover:underline"
                        dir="auto"
                      >
                        {lead.name}
                      </Link>
                      <p className="text-foreground-muted text-xs">
                        {formatDate(lead.createdAt)}
                      </p>
                    </div>
                    <LeadStatusBadge status={lead.status} />
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Panel>
            <PanelHeader
              kicker="Pipeline"
              title={`Opportunities (${account.opportunities.length})`}
            />
            <RelatedOpportunities
              opportunities={account.opportunities}
              emptyDescription="Deals with this company appear here. Start one with New opportunity."
            />
          </Panel>

          <Panel>
            <PanelHeader
              kicker="Timeline"
              title="Activity"
              actions={
                rights[CRM_PERMISSIONS.ACTIVITY_CREATE] === true ? (
                  <AddActivityButton
                    links={{ accountId: account.id }}
                    currentUserId={actor.id}
                  />
                ) : undefined
              }
            />
            <ActivityTimeline
              activities={timeline}
              currentRecordId={account.id}
              canUpdateActivities={rights[CRM_PERMISSIONS.ACTIVITY_UPDATE] === true}
            />
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="bg-surface flex min-w-0 flex-col gap-1 px-4 py-3">
      <p className="text-foreground-muted text-[10.5px] tracking-[0.08em] uppercase">
        {label}
      </p>
      <div className="text-foreground truncate text-lg leading-tight font-extrabold tracking-[-0.01em] tabular-nums">
        {children}
      </div>
    </div>
  );
}
