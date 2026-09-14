import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BreadcrumbTitle } from "@/components/shell/breadcrumbs";
import Link from "next/link";
import type { ReactNode } from "react";
import { EmptyState, PageHeader, Panel, PanelHeader } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { CRM_PERMISSIONS } from "@/modules/crm/contracts/permissions";
import {
  getOpportunity,
  listAccountOptions,
  listContactOptions,
  listStages,
  listTimeline,
} from "@/modules/crm/contracts/service";
import { LEAD_SOURCE_LABELS, LOST_REASON_LABELS } from "@/modules/crm/contracts/types";
import { ActivityTimeline } from "@/modules/crm/ui/activity-timeline";
import { AddActivityButton } from "@/modules/crm/ui/add-activity";
import { ChannelBadge, PriorityBadge, StageBadge } from "@/modules/crm/ui/badges";
import { DetailList } from "@/modules/crm/ui/detail-list";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatRelative,
} from "@/modules/crm/ui/format";
import { EditOpportunityButton } from "@/modules/crm/ui/edit-opportunity-button";
import { orNotFound, uuidParam } from "@/modules/crm/ui/page-helpers";
import { StageTracker } from "@/modules/crm/ui/stage-tracker";
import { getActor } from "@/platform/auth/current-user";
import { canAll } from "@/platform/authz/authz";
import { listDirectory } from "@/platform/iam/services/directory-service";

export const metadata: Metadata = { title: "Opportunity" };

/** An opportunity: its stage, its figures, who is involved, and its timeline. */
export default async function OpportunityPage({
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
    CRM_PERMISSIONS.OPPORTUNITY_UPDATE,
    CRM_PERMISSIONS.ACCOUNT_READ,
    CRM_PERMISSIONS.CONTACT_READ,
    CRM_PERMISSIONS.ACTIVITY_READ,
    CRM_PERMISSIONS.ACTIVITY_CREATE,
    CRM_PERMISSIONS.ACTIVITY_UPDATE,
  ]);
  const [opportunity, rights, timeline, stages, owners, accounts, contacts] =
    await Promise.all([
      orNotFound(getOpportunity(actor, id)),
      rightsPromise,
      rightsPromise.then((granted) =>
        granted[CRM_PERMISSIONS.ACTIVITY_READ] === true
          ? listTimeline(actor, { kind: "opportunity", id })
          : [],
      ),
      listStages(actor),
      listDirectory(actor),
      rightsPromise.then((granted) =>
        granted[CRM_PERMISSIONS.OPPORTUNITY_UPDATE] === true &&
        granted[CRM_PERMISSIONS.ACCOUNT_READ] === true
          ? listAccountOptions(actor)
          : [],
      ),
      rightsPromise.then((granted) =>
        granted[CRM_PERMISSIONS.OPPORTUNITY_UPDATE] === true &&
        granted[CRM_PERMISSIONS.CONTACT_READ] === true
          ? listContactOptions(actor)
          : [],
      ),
    ]);
  const canEdit = rights[CRM_PERMISSIONS.OPPORTUNITY_UPDATE] === true;

  const weighted = Math.round((opportunity.amountMinor * opportunity.probability) / 100);
  const contact = opportunity.primaryContactDetail;

  return (
    <div>
      <p className="kicker text-primary-ink mb-1 flex items-center gap-2">
        Opportunity{" "}
        <StageBadge name={opportunity.stage.name} kind={opportunity.stage.kind} />
      </p>
      <BreadcrumbTitle segment={id} label={opportunity.name} />
      <PageHeader
        title={opportunity.name}
        description={[opportunity.account.name, opportunity.product]
          .filter((part) => part !== null)
          .join(" · ")}
        actions={
          canEdit ? (
            <EditOpportunityButton
              opportunity={opportunity}
              options={{ accounts, contacts, stages, owners }}
              currentUserId={actor.id}
            />
          ) : undefined
        }
      />

      <StageTracker opportunity={opportunity} stages={stages} canMove={canEdit} />

      {opportunity.status === "WON" && (
        <Outcome
          tone="success"
          title={`Closed won${opportunity.wonAt !== null ? ` on ${formatDate(opportunity.wonAt)}` : ""} · ${formatMoney(opportunity.amountMinor, opportunity.currency)}`}
          notes={opportunity.closeNotes}
        />
      )}
      {opportunity.status === "LOST" && (
        <Outcome
          tone="danger"
          title={`Closed lost${opportunity.lostAt !== null ? ` on ${formatDate(opportunity.lostAt)}` : ""}${opportunity.lostReason !== null ? ` · ${LOST_REASON_LABELS[opportunity.lostReason]}` : ""}`}
          notes={opportunity.closeNotes}
        />
      )}

      <section
        aria-label="Deal figures"
        className="bg-border border-border mt-3 grid grid-cols-2 gap-px border md:grid-cols-5"
      >
        <Figure
          label="Amount"
          value={formatMoney(opportunity.amountMinor, opportunity.currency)}
        />
        <Figure label="Probability" value={`${opportunity.probability}%`} />
        <Figure
          label="Weighted"
          value={formatMoney(weighted, opportunity.currency)}
          note="Amount × probability"
        />
        <Figure
          label={opportunity.status === "OPEN" ? "Expected close" : "Close date"}
          value={formatDate(opportunity.closeDate)}
          note={
            opportunity.status === "OPEN"
              ? formatRelative(opportunity.closeDate)
              : undefined
          }
        />
        <Figure
          label="Owner"
          value={opportunity.owner?.name ?? "Unassigned"}
          className="col-span-2 md:col-span-1"
        />
      </section>

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
        <div className="flex flex-col gap-4">
          <Panel>
            <PanelHeader kicker="Deal" title="Details" />
            <DetailList
              items={[
                {
                  label: "Company",
                  value: (
                    <Link
                      href={`/crm/accounts/${opportunity.account.id}`}
                      className="text-primary-ink font-extrabold hover:underline"
                    >
                      {opportunity.account.name}
                    </Link>
                  ),
                },
                { label: "Industry", value: opportunity.industry },
                { label: "Product / service", value: opportunity.product },
                {
                  label: "Channel",
                  value: (
                    <ChannelBadge
                      channel={opportunity.channel}
                      partnerName={opportunity.partnerName}
                    />
                  ),
                },
                {
                  label: "Priority",
                  value: <PriorityBadge priority={opportunity.priority} />,
                },
                {
                  label: "Lead source",
                  value:
                    opportunity.source === null
                      ? null
                      : LEAD_SOURCE_LABELS[opportunity.source],
                },
                {
                  label: "In stage since",
                  value: formatRelative(opportunity.stageChangedAt),
                },
                { label: "Created", value: formatDateTime(opportunity.createdAt) },
                {
                  label: "Description",
                  value:
                    opportunity.description === null ? null : (
                      <span className="whitespace-pre-line">
                        {opportunity.description}
                      </span>
                    ),
                },
              ]}
            />
          </Panel>

          <Panel>
            <PanelHeader kicker="People" title="Primary contact" />
            {contact === null ? (
              <EmptyState
                title="No primary contact"
                description="Edit the opportunity to choose who you’re dealing with at the company."
              />
            ) : (
              <DetailList
                items={[
                  {
                    label: "Name",
                    value: (
                      <Link
                        href={`/crm/contacts/${contact.id}`}
                        className="text-primary-ink font-extrabold hover:underline"
                      >
                        {contact.name}
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
                ]}
              />
            )}
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
                    opportunityId: opportunity.id,
                    accountId: opportunity.account.id,
                    contactId: contact?.id,
                  }}
                  owners={owners}
                  currentUserId={actor.id}
                />
              ) : undefined
            }
          />
          <ActivityTimeline
            activities={timeline}
            currentRecordId={opportunity.id}
            canCompleteTasks={rights[CRM_PERMISSIONS.ACTIVITY_UPDATE] === true}
          />
        </Panel>
      </div>
    </div>
  );
}

function Figure({
  label,
  value,
  note,
  className,
}: {
  label: string;
  value: ReactNode;
  note?: string;
  className?: string;
}) {
  return (
    <div className={cn("bg-surface flex min-w-0 flex-col gap-1 px-4 py-3", className)}>
      <p className="text-foreground-muted text-[10.5px] tracking-[0.08em] uppercase">
        {label}
      </p>
      <p className="text-foreground truncate text-lg leading-tight font-extrabold tracking-[-0.01em] tabular-nums">
        {value}
      </p>
      {note !== undefined && <p className="text-foreground-subtle text-[11px]">{note}</p>}
    </div>
  );
}

function Outcome({
  tone,
  title,
  notes,
}: {
  tone: "success" | "danger";
  title: string;
  notes: string | null;
}) {
  return (
    <div
      className={cn(
        "mt-1 border-s-3 px-3 py-2 text-[13px]",
        tone === "success"
          ? "border-success bg-success-subtle"
          : "border-danger bg-danger-subtle",
      )}
    >
      <p
        className={cn(
          "font-extrabold",
          tone === "success" ? "text-success" : "text-danger",
        )}
      >
        {title}
      </p>
      {notes !== null && (
        <p className="text-foreground mt-0.5 whitespace-pre-line" dir="auto">
          {notes}
        </p>
      )}
    </div>
  );
}
