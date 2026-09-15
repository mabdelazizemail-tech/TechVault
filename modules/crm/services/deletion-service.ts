import type { Prisma } from "@prisma/client";
import { BusinessRuleError, NotFoundError } from "@/lib/errors";
import { prisma, type PrismaTransaction } from "@/lib/prisma";
import { recordAudit } from "@/platform/audit/audit";
import { type Actor, requirePermission } from "@/platform/authz/authz";
import type { ScopeTarget } from "@/platform/authz/types";
import { publish } from "@/platform/events/publish";
import { CRM_EVENTS } from "../contracts/events";
import { CRM_PERMISSIONS } from "../contracts/permissions";
import { deletionTargetSchema } from "../contracts/schemas";
import { ACTIVITY_TYPE_LABELS, type DeletionImpact } from "../contracts/types";
import { personName, toScopeTarget, userRefSelect } from "../repositories/selects";
import { CRM_MODULE, assertCanRead, auditFields, isUuid, parseInput } from "./support";

/**
 * Administrator deletion of CRM records (ADR-024).
 *
 * Deletion is soft: `deleted_at` is set, and every CRM read already ignores such
 * rows. A record takes with it what exists only under it — a company its contacts
 * and opportunities — and its activities, except those another record keeps. One
 * transaction per delete, with one audit record and one event.
 */

type DeletionSet = {
  leadIds: string[];
  accountIds: string[];
  contactIds: string[];
  opportunityIds: string[];
};

function deletionSet(ids: Partial<DeletionSet>): DeletionSet {
  return {
    leadIds: ids.leadIds ?? [],
    accountIds: ids.accountIds ?? [],
    contactIds: ids.contactIds ?? [],
    opportunityIds: ids.opportunityIds ?? [],
  };
}

/**
 * What keeps an activity when a record it is linked to is deleted.
 *
 * - `"any record"` — a lead, company, contact or opportunity that stays. Used when
 *   deleting a lead or a company.
 * - `"a lead"` — only a lead that stays. Used when deleting a contact or an
 *   opportunity: activities logged on those are filed under the company
 *   automatically, so the company must not keep them, while a converted lead's
 *   history — copied onto what the lead became — stays with the lead.
 */
type KeptBy = "any record" | "a lead";

/** Live activities that go with a deletion: linked to a record being deleted and not kept. */
function activitiesGoingWith(
  set: DeletionSet,
  keptBy: KeptBy,
): Prisma.CrmActivityWhereInput {
  const noLiveLead: Prisma.CrmActivityWhereInput = {
    OR: [
      { leadId: null },
      { leadId: { in: set.leadIds } },
      { lead: { is: { deletedAt: { not: null } } } },
    ],
  };
  const noLiveOtherRecord: Prisma.CrmActivityWhereInput[] = [
    {
      OR: [
        { accountId: null },
        { accountId: { in: set.accountIds } },
        { account: { is: { deletedAt: { not: null } } } },
      ],
    },
    {
      OR: [
        { contactId: null },
        { contactId: { in: set.contactIds } },
        { contact: { is: { deletedAt: { not: null } } } },
      ],
    },
    {
      OR: [
        { opportunityId: null },
        { opportunityId: { in: set.opportunityIds } },
        { opportunity: { is: { deletedAt: { not: null } } } },
      ],
    },
  ];

  return {
    deletedAt: null,
    OR: [
      { leadId: { in: set.leadIds } },
      { accountId: { in: set.accountIds } },
      { contactId: { in: set.contactIds } },
      { opportunityId: { in: set.opportunityIds } },
    ],
    AND: keptBy === "a lead" ? [noLiveLead] : [noLiveLead, ...noLiveOtherRecord],
  };
}

function counted(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/* -------------------------------------------------------------------------- */
/* Loading and authorising                                                    */
/* -------------------------------------------------------------------------- */

type Loaded = { id: string; label: string };

const ownerFields = {
  id: true,
  ownerId: true,
  owner: { select: userRefSelect },
} as const;

/** A record the actor may not see is not found; one they may see but not delete is forbidden. */
async function authorise(
  actor: Actor,
  read: string,
  remove: string,
  target: ScopeTarget,
  entity: string,
): Promise<void> {
  await assertCanRead(actor, read, target, entity);
  await requirePermission(actor, remove, target);
}

async function loadLead(actor: Actor, leadId: string): Promise<Loaded> {
  if (!isUuid(leadId)) throw new NotFoundError("lead");
  const row = await prisma.crmLead.findFirst({
    where: { id: leadId, deletedAt: null },
    select: { ...ownerFields, firstName: true, lastName: true },
  });
  if (row === null) throw new NotFoundError("lead");
  await authorise(
    actor,
    CRM_PERMISSIONS.LEAD_READ,
    CRM_PERMISSIONS.LEAD_DELETE,
    toScopeTarget(row.ownerId, row.owner),
    "lead",
  );
  return { id: row.id, label: personName(row) };
}

async function loadAccount(actor: Actor, accountId: string): Promise<Loaded> {
  if (!isUuid(accountId)) throw new NotFoundError("company");
  const row = await prisma.crmAccount.findFirst({
    where: { id: accountId, deletedAt: null },
    select: { ...ownerFields, name: true },
  });
  if (row === null) throw new NotFoundError("company");
  await authorise(
    actor,
    CRM_PERMISSIONS.ACCOUNT_READ,
    CRM_PERMISSIONS.ACCOUNT_DELETE,
    toScopeTarget(row.ownerId, row.owner),
    "company",
  );
  return { id: row.id, label: row.name };
}

async function loadContact(actor: Actor, contactId: string): Promise<Loaded> {
  if (!isUuid(contactId)) throw new NotFoundError("contact");
  const row = await prisma.crmContact.findFirst({
    where: { id: contactId, deletedAt: null },
    select: { ...ownerFields, firstName: true, lastName: true },
  });
  if (row === null) throw new NotFoundError("contact");
  await authorise(
    actor,
    CRM_PERMISSIONS.CONTACT_READ,
    CRM_PERMISSIONS.CONTACT_DELETE,
    toScopeTarget(row.ownerId, row.owner),
    "contact",
  );
  return { id: row.id, label: personName(row) };
}

async function loadOpportunity(actor: Actor, opportunityId: string): Promise<Loaded> {
  if (!isUuid(opportunityId)) throw new NotFoundError("opportunity");
  const row = await prisma.crmOpportunity.findFirst({
    where: { id: opportunityId, deletedAt: null },
    select: { ...ownerFields, name: true },
  });
  if (row === null) throw new NotFoundError("opportunity");
  await authorise(
    actor,
    CRM_PERMISSIONS.OPPORTUNITY_READ,
    CRM_PERMISSIONS.OPPORTUNITY_DELETE,
    toScopeTarget(row.ownerId, row.owner),
    "opportunity",
  );
  return { id: row.id, label: row.name };
}

/** The live contacts and opportunities of a company. */
async function companyDependents(
  client: PrismaTransaction,
  accountId: string,
): Promise<{ contactIds: string[]; opportunityIds: string[] }> {
  const contacts = await client.crmContact.findMany({
    where: { accountId, deletedAt: null },
    select: { id: true },
  });
  const opportunities = await client.crmOpportunity.findMany({
    where: { accountId, deletedAt: null },
    select: { id: true },
  });
  return {
    contactIds: contacts.map((row) => row.id),
    opportunityIds: opportunities.map((row) => row.id),
  };
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                    */
/* -------------------------------------------------------------------------- */

type Stamp = { deletedAt: Date; updatedBy: string };

/**
 * Marks exactly one live row. Two simultaneous deletes of the same record queue on
 * the row lock; the second then matches nothing and reports it as not found.
 */
async function markOne(
  update: Promise<{ count: number }>,
  entity: string,
): Promise<void> {
  if ((await update).count !== 1) throw new NotFoundError(entity);
}

async function deleteActivitiesGoingWith(
  tx: PrismaTransaction,
  set: DeletionSet,
  keptBy: KeptBy,
  stamp: Stamp,
): Promise<string[]> {
  const rows = await tx.crmActivity.findMany({
    where: activitiesGoingWith(set, keptBy),
    select: { id: true },
  });
  const ids = rows.map((row) => row.id);
  if (ids.length > 0) {
    await tx.crmActivity.updateMany({ where: { id: { in: ids } }, data: stamp });
  }
  return ids;
}

async function recordDeletion(
  tx: PrismaTransaction,
  actor: Actor,
  entry: {
    action: string;
    entityType: string;
    entityId: string;
    summary: string;
    changes: Record<string, unknown>;
    event: string;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  await recordAudit(
    {
      ...auditFields(actor),
      action: entry.action,
      module: CRM_MODULE,
      entityType: entry.entityType,
      entityId: entry.entityId,
      summary: entry.summary,
      changes: entry.changes,
      severity: "WARNING",
    },
    tx,
  );
  await publish(tx, {
    name: entry.event,
    actorId: actor.id,
    correlationId: actor.correlationId ?? null,
    payload: entry.payload,
  });
}

/* -------------------------------------------------------------------------- */
/* Public operations                                                          */
/* -------------------------------------------------------------------------- */

export async function deleteLead(actor: Actor, leadId: string): Promise<void> {
  const lead = await loadLead(actor, leadId);
  await prisma.$transaction(async (tx) => {
    const stamp: Stamp = { deletedAt: new Date(), updatedBy: actor.id };
    await markOne(
      tx.crmLead.updateMany({ where: { id: lead.id, deletedAt: null }, data: stamp }),
      "lead",
    );
    const activityIds = await deleteActivitiesGoingWith(
      tx,
      deletionSet({ leadIds: [lead.id] }),
      "any record",
      stamp,
    );
    await recordDeletion(tx, actor, {
      action: "crm.lead.deleted",
      entityType: "CrmLead",
      entityId: lead.id,
      summary: `Deleted lead ${lead.label} and ${counted(activityIds.length, "activity", "activities")}`,
      changes: { activityIds },
      event: CRM_EVENTS.LEAD_DELETED,
      payload: { leadId: lead.id },
    });
  });
}

export async function deleteAccount(actor: Actor, accountId: string): Promise<void> {
  const account = await loadAccount(actor, accountId);
  await prisma.$transaction(async (tx) => {
    const stamp: Stamp = { deletedAt: new Date(), updatedBy: actor.id };
    await markOne(
      tx.crmAccount.updateMany({
        where: { id: account.id, deletedAt: null },
        data: stamp,
      }),
      "company",
    );
    const { contactIds, opportunityIds } = await companyDependents(tx, account.id);
    const activityIds = await deleteActivitiesGoingWith(
      tx,
      deletionSet({ accountIds: [account.id], contactIds, opportunityIds }),
      "any record",
      stamp,
    );
    if (contactIds.length > 0) {
      await tx.crmContact.updateMany({ where: { id: { in: contactIds } }, data: stamp });
    }
    if (opportunityIds.length > 0) {
      await tx.crmOpportunity.updateMany({
        where: { id: { in: opportunityIds } },
        data: stamp,
      });
    }
    await recordDeletion(tx, actor, {
      action: "crm.account.deleted",
      entityType: "CrmAccount",
      entityId: account.id,
      summary:
        `Deleted company ${account.label} with ` +
        `${counted(contactIds.length, "contact", "contacts")}, ` +
        `${counted(opportunityIds.length, "opportunity", "opportunities")} and ` +
        `${counted(activityIds.length, "activity", "activities")}`,
      changes: { contactIds, opportunityIds, activityIds },
      event: CRM_EVENTS.CUSTOMER_DELETED,
      payload: { accountId: account.id, contactIds, opportunityIds },
    });
  });
}

export async function deleteContact(actor: Actor, contactId: string): Promise<void> {
  const contact = await loadContact(actor, contactId);
  await prisma.$transaction(async (tx) => {
    const stamp: Stamp = { deletedAt: new Date(), updatedBy: actor.id };
    await markOne(
      tx.crmContact.updateMany({
        where: { id: contact.id, deletedAt: null },
        data: stamp,
      }),
      "contact",
    );
    const activityIds = await deleteActivitiesGoingWith(
      tx,
      deletionSet({ contactIds: [contact.id] }),
      "a lead",
      stamp,
    );
    await recordDeletion(tx, actor, {
      action: "crm.contact.deleted",
      entityType: "CrmContact",
      entityId: contact.id,
      summary: `Deleted contact ${contact.label} and ${counted(activityIds.length, "activity", "activities")}`,
      changes: { activityIds },
      event: CRM_EVENTS.CONTACT_DELETED,
      payload: { contactId: contact.id },
    });
  });
}

export async function deleteOpportunity(
  actor: Actor,
  opportunityId: string,
): Promise<void> {
  const opportunity = await loadOpportunity(actor, opportunityId);
  await prisma.$transaction(async (tx) => {
    const stamp: Stamp = { deletedAt: new Date(), updatedBy: actor.id };
    await markOne(
      tx.crmOpportunity.updateMany({
        where: { id: opportunity.id, deletedAt: null },
        data: stamp,
      }),
      "opportunity",
    );
    const activityIds = await deleteActivitiesGoingWith(
      tx,
      deletionSet({ opportunityIds: [opportunity.id] }),
      "a lead",
      stamp,
    );
    await recordDeletion(tx, actor, {
      action: "crm.opportunity.deleted",
      entityType: "CrmOpportunity",
      entityId: opportunity.id,
      summary: `Deleted opportunity ${opportunity.label} and ${counted(activityIds.length, "activity", "activities")}`,
      changes: { activityIds },
      event: CRM_EVENTS.OPPORTUNITY_DELETED,
      payload: { opportunityId: opportunity.id },
    });
  });
}

/**
 * Deletes one call, email, meeting, task or note. The CRM's own status and stage
 * entries are the history of their record and go only with it.
 */
export async function deleteActivity(actor: Actor, activityId: string): Promise<void> {
  if (!isUuid(activityId)) throw new NotFoundError("activity");
  const activity = await prisma.crmActivity.findFirst({
    where: { id: activityId, deletedAt: null },
    select: {
      id: true,
      type: true,
      subject: true,
      createdBy: true,
      creator: { select: userRefSelect },
    },
  });
  if (activity === null) throw new NotFoundError("activity");
  await authorise(
    actor,
    CRM_PERMISSIONS.ACTIVITY_READ,
    CRM_PERMISSIONS.ACTIVITY_DELETE,
    toScopeTarget(activity.createdBy, activity.creator),
    "activity",
  );
  if (activity.type === "STATUS_CHANGE" || activity.type === "STAGE_CHANGE") {
    throw new BusinessRuleError(
      "Status and stage changes are part of their record's history and are deleted only with the record.",
    );
  }

  await prisma.$transaction(async (tx) => {
    await markOne(
      tx.crmActivity.updateMany({
        where: { id: activity.id, deletedAt: null },
        data: { deletedAt: new Date(), updatedBy: actor.id },
      }),
      "activity",
    );
    await recordDeletion(tx, actor, {
      action: "crm.activity.deleted",
      entityType: "CrmActivity",
      entityId: activity.id,
      summary: `Deleted ${ACTIVITY_TYPE_LABELS[activity.type].toLowerCase()}: ${activity.subject}`,
      changes: { type: activity.type },
      event: CRM_EVENTS.ACTIVITY_DELETED,
      payload: { activityId: activity.id },
    });
  });
}

/** What deleting a record would take with it — the counts the confirmation shows. */
export async function getDeletionImpact(
  actor: Actor,
  rawTarget: unknown,
): Promise<DeletionImpact> {
  const target = parseInput(deletionTargetSchema, rawTarget);
  const countActivities = (set: DeletionSet, keptBy: KeptBy) =>
    prisma.crmActivity.count({ where: activitiesGoingWith(set, keptBy) });

  switch (target.kind) {
    case "lead": {
      const lead = await loadLead(actor, target.id);
      return {
        kind: "lead",
        ...lead,
        contacts: 0,
        opportunities: 0,
        activities: await countActivities(
          deletionSet({ leadIds: [lead.id] }),
          "any record",
        ),
      };
    }
    case "account": {
      const account = await loadAccount(actor, target.id);
      const { contactIds, opportunityIds } = await companyDependents(prisma, account.id);
      return {
        kind: "account",
        ...account,
        contacts: contactIds.length,
        opportunities: opportunityIds.length,
        activities: await countActivities(
          deletionSet({ accountIds: [account.id], contactIds, opportunityIds }),
          "any record",
        ),
      };
    }
    case "contact": {
      const contact = await loadContact(actor, target.id);
      return {
        kind: "contact",
        ...contact,
        contacts: 0,
        opportunities: 0,
        activities: await countActivities(
          deletionSet({ contactIds: [contact.id] }),
          "a lead",
        ),
      };
    }
    case "opportunity": {
      const opportunity = await loadOpportunity(actor, target.id);
      return {
        kind: "opportunity",
        ...opportunity,
        contacts: 0,
        opportunities: 0,
        activities: await countActivities(
          deletionSet({ opportunityIds: [opportunity.id] }),
          "a lead",
        ),
      };
    }
  }
}
