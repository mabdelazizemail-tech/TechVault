import type { Metadata } from "next";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader, Panel, PanelHeader } from "@/components/ui/primitives";
import { CRM_PERMISSIONS } from "@/modules/crm/contracts/permissions";
import { getLead, listTimeline } from "@/modules/crm/contracts/service";
import {
  DECISION_MAKER_LABELS,
  LEAD_SOURCE_LABELS,
  PURCHASE_TIMELINE_LABELS,
  type RecordRef,
} from "@/modules/crm/contracts/types";
import { ActivityTimeline } from "@/modules/crm/ui/activity-timeline";
import { AddActivityButton } from "@/modules/crm/ui/add-activity";
import { LeadStatusBadge, ScoreMeter, scoreLabel } from "@/modules/crm/ui/badges";
import { DetailList } from "@/modules/crm/ui/detail-list";
import { formatDate, formatMoney, formatRelative } from "@/modules/crm/ui/format";
import { LeadEditButton } from "@/modules/crm/ui/lead-edit";
import { LeadStatusBar } from "@/modules/crm/ui/lead-status-bar";
import { recordHref } from "@/modules/crm/ui/links";
import { orNotFound } from "@/modules/crm/ui/page-helpers";
import { getActor } from "@/platform/auth/current-user";
import { canAll } from "@/platform/authz/authz";
import { listDirectory } from "@/platform/iam/services/directory-service";

export const metadata: Metadata = { title: "Lead" };

/** A lead: its status progression, what we know about it, and its timeline. */
export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await getActor();

  const [lead, rights] = await Promise.all([
    orNotFound(getLead(actor, id)),
    canAll(actor, [
      CRM_PERMISSIONS.LEAD_UPDATE,
      CRM_PERMISSIONS.ACTIVITY_READ,
      CRM_PERMISSIONS.ACTIVITY_CREATE,
      CRM_PERMISSIONS.ACTIVITY_UPDATE,
    ]),
  ]);
  const [timeline, owners] = await Promise.all([
    rights[CRM_PERMISSIONS.ACTIVITY_READ] === true
      ? listTimeline(actor, { kind: "lead", id: lead.id })
      : Promise.resolve([]),
    listDirectory(actor),
  ]);

  const canUpdate = rights[CRM_PERMISSIONS.LEAD_UPDATE] === true;
  const converted = lead.status === "CONVERTED";
  const location = [lead.city, lead.country].filter((part) => part !== null).join(", ");

  return (
    <div>
      <p className="kicker text-primary-ink mb-1 flex items-center gap-2">
        Lead <LeadStatusBadge status={lead.status} />
      </p>
      <PageHeader
        title={lead.name}
        description={[lead.jobTitle, lead.company]
          .filter((part) => part !== null)
          .join(" · ")}
        actions={
          canUpdate && !converted ? (
            <>
              <LeadEditButton lead={lead} owners={owners} />
              <ButtonLink
                href={`/crm/leads/${lead.id}/convert`}
                variant="primary"
                icon={<Sparkles aria-hidden="true" size={15} />}
              >
                Convert
              </ButtonLink>
            </>
          ) : undefined
        }
      />

      <LeadStatusBar leadId={lead.id} status={lead.status} canUpdate={canUpdate} />

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
        <div className="flex flex-col gap-4">
          {converted && (
            <Panel className="border-primary border-s-3">
              <PanelHeader
                kicker="Converted"
                title={
                  lead.convertedAt !== null
                    ? `Converted ${formatRelative(lead.convertedAt)}`
                    : "Converted"
                }
                description="This lead now lives on as the records below."
              />
              <DetailList
                items={[
                  {
                    label: "Company",
                    value: <RecordLink record={lead.convertedAccount} />,
                  },
                  {
                    label: "Contact",
                    value: <RecordLink record={lead.convertedContact} />,
                  },
                  {
                    label: "Opportunity",
                    value: <RecordLink record={lead.convertedOpportunity} />,
                  },
                ]}
              />
            </Panel>
          )}

          <Panel>
            <PanelHeader kicker="Person" title="Contact details" />
            <DetailList
              items={[
                { label: "Name", value: lead.name },
                { label: "Job title", value: lead.jobTitle },
                {
                  label: "Email",
                  value:
                    lead.email === null ? null : (
                      <a
                        href={`mailto:${lead.email}`}
                        className="text-primary-ink hover:underline"
                      >
                        {lead.email}
                      </a>
                    ),
                },
                {
                  label: "Phone",
                  value:
                    lead.phone === null ? null : (
                      <a
                        href={`tel:${lead.phone}`}
                        className="text-primary-ink hover:underline"
                        dir="ltr"
                      >
                        {lead.phone}
                      </a>
                    ),
                },
                { label: "Lead source", value: LEAD_SOURCE_LABELS[lead.source] },
                { label: "Owner", value: lead.owner?.name ?? "Unassigned" },
                { label: "Created", value: formatDate(lead.createdAt) },
              ]}
            />
          </Panel>

          <Panel>
            <PanelHeader kicker="Company" title={lead.company} />
            <DetailList
              items={[
                {
                  label: "Website",
                  value:
                    lead.website === null ? null : (
                      <a
                        href={lead.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary-ink hover:underline"
                      >
                        {lead.website.replace(/^https?:\/\//, "")}
                      </a>
                    ),
                },
                { label: "Industry", value: lead.industry },
                { label: "Employees", value: lead.companySize },
                { label: "Location", value: location },
              ]}
            />
          </Panel>

          <Panel>
            <PanelHeader
              kicker="Qualification"
              title={`${scoreLabel(lead.score)} lead`}
            />
            <DetailList
              items={[
                { label: "Score", value: <ScoreMeter score={lead.score} /> },
                { label: "Interested in", value: lead.interest },
                {
                  label: "Budget",
                  value:
                    lead.budgetMinor === null
                      ? null
                      : formatMoney(lead.budgetMinor, lead.currency),
                },
                {
                  label: "Timeline",
                  value:
                    lead.timeline === null
                      ? null
                      : PURCHASE_TIMELINE_LABELS[lead.timeline],
                },
                {
                  label: "Decision maker",
                  value:
                    lead.decisionMaker === null
                      ? null
                      : DECISION_MAKER_LABELS[lead.decisionMaker],
                },
                { label: "Current solution", value: lead.currentSolution },
                {
                  label: "Pain point",
                  value:
                    lead.painPoint === null ? null : (
                      <span className="whitespace-pre-line">{lead.painPoint}</span>
                    ),
                },
                { label: "Status since", value: formatRelative(lead.statusChangedAt) },
              ]}
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
                  links={{
                    leadId: lead.id,
                    accountId: lead.convertedAccount?.id,
                    contactId: lead.convertedContact?.id,
                    opportunityId: lead.convertedOpportunity?.id,
                  }}
                  owners={owners}
                  currentUserId={actor.id}
                />
              ) : undefined
            }
          />
          <ActivityTimeline
            activities={timeline}
            currentRecordId={lead.id}
            canCompleteTasks={rights[CRM_PERMISSIONS.ACTIVITY_UPDATE] === true}
          />
        </Panel>
      </div>
    </div>
  );
}

function RecordLink({ record }: { record: RecordRef | null }) {
  if (record === null) return <span className="text-foreground-subtle">—</span>;
  return (
    <Link
      href={recordHref(record)}
      className="text-primary-ink font-extrabold hover:underline"
      dir="auto"
    >
      {record.label}
    </Link>
  );
}
