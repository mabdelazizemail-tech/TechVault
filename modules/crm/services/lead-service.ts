import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { toMinorUnits } from "@/lib/money";
import { prisma, type PrismaTransaction } from "@/lib/prisma";
import { diffForAudit, recordAudit } from "@/platform/audit/audit";
import { type Actor, canAll, requirePermission } from "@/platform/authz/authz";
import { publish } from "@/platform/events/publish";
import { CRM_EVENTS } from "../contracts/events";
import { CRM_PERMISSIONS } from "../contracts/permissions";
import {
  convertLeadSchema,
  createLeadSchema,
  listParamsSchema,
  setLeadStatusSchema,
  updateLeadSchema,
  type opportunityDraftSchema,
} from "../contracts/schemas";
import {
  LEAD_STATUS_LABELS,
  type ConversionPreview,
  type ConversionResult,
  type LeadDetail,
  type LeadListItem,
  type LeadSource,
  type LeadStatus,
  type Paginated,
} from "../contracts/types";
import { CONVERSION_STAGE_KEY } from "../domain/pipeline";
import {
  leadDetailSelect,
  leadListSelect,
  personName,
  stageSelect,
  toLeadDetail,
  toLeadListItem,
  toScopeTarget,
  toStageDto,
  userRefSelect,
} from "../repositories/selects";
import {
  CRM_MODULE,
  assertCanRead,
  auditFields,
  equalsInsensitive,
  insensitive,
  isUniqueViolation,
  isUuid,
  ownerScope,
  parseInput,
  searchTerms,
} from "./support";

/**
 * Leads (CLAUDE.md §6.1): capture, qualify, convert.
 *
 * Every operation: permission first, validate, then one transaction holding the
 * change, its activity-timeline entry, its audit record and its event.
 */

type OpportunityDraft = z.output<typeof opportunityDraftSchema>;

export type LeadListFilters = {
  status?: LeadStatus;
  source?: LeadSource;
  ownerId?: string;
};

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export async function listLeads(
  actor: Actor,
  rawParams: Record<string, unknown> = {},
  filters: LeadListFilters = {},
): Promise<Paginated<LeadListItem>> {
  await requirePermission(actor, CRM_PERMISSIONS.LEAD_READ);
  const params = listParamsSchema.parse(rawParams);
  const scoped = await ownerScope(actor, CRM_PERMISSIONS.LEAD_READ);

  const where: Prisma.CrmLeadWhereInput = {
    AND: [
      { deletedAt: null },
      scoped as Prisma.CrmLeadWhereInput,
      filters.status !== undefined ? { status: filters.status } : {},
      filters.source !== undefined ? { source: filters.source } : {},
      filters.ownerId !== undefined ? { ownerId: filters.ownerId } : {},
      ...searchTerms(params.q).map((term) => ({
        OR: [
          { firstName: insensitive(term) },
          { lastName: insensitive(term) },
          { company: insensitive(term) },
          { email: insensitive(term) },
        ],
      })),
    ],
  };

  const [total, rows] = await Promise.all([
    prisma.crmLead.count({ where }),
    prisma.crmLead.findMany({
      where,
      orderBy: leadOrderBy(params.sort, params.dir),
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
      select: leadListSelect,
    }),
  ]);

  return {
    rows: rows.map(toLeadListItem),
    total,
    page: params.page,
    pageSize: params.pageSize,
  };
}

function leadOrderBy(
  sort: string | undefined,
  dir: "asc" | "desc",
): Prisma.CrmLeadOrderByWithRelationInput[] {
  switch (sort) {
    case "name":
      return [{ lastName: dir }, { firstName: dir }];
    case "company":
      return [{ company: dir }];
    case "status":
      return [{ status: dir }, { createdAt: "desc" }];
    case "score":
      return [{ score: dir }, { createdAt: "desc" }];
    case "source":
      return [{ source: dir }, { createdAt: "desc" }];
    default:
      return [{ createdAt: dir }];
  }
}

export async function getLead(actor: Actor, leadId: string): Promise<LeadDetail> {
  if (!isUuid(leadId)) throw new NotFoundError("lead");
  const row = await prisma.crmLead.findFirst({
    where: { id: leadId, deletedAt: null },
    select: leadDetailSelect,
  });
  if (row === null) throw new NotFoundError("lead");
  await assertCanRead(
    actor,
    CRM_PERMISSIONS.LEAD_READ,
    toScopeTarget(row.ownerId, row.owner),
    "lead",
  );
  return toLeadDetail(row);
}

export async function getConversionPreview(
  actor: Actor,
  leadId: string,
): Promise<ConversionPreview> {
  const lead = await getLead(actor, leadId);

  const [matchingAccount, matchingContact, stages] = await Promise.all([
    prisma.crmAccount.findFirst({
      where: { deletedAt: null, name: equalsInsensitive(lead.company) },
      select: { id: true, name: true },
    }),
    lead.email === null
      ? Promise.resolve(null)
      : prisma.crmContact.findFirst({
          where: { deletedAt: null, email: equalsInsensitive(lead.email) },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            account: { select: { name: true } },
          },
        }),
    prisma.crmOpportunityStage.findMany({
      where: { isActive: true, kind: "OPEN" },
      orderBy: { position: "asc" },
      select: stageSelect,
    }),
  ]);

  return {
    lead,
    matchingAccount,
    matchingContact:
      matchingContact === null
        ? null
        : {
            id: matchingContact.id,
            name: personName(matchingContact),
            accountName: matchingContact.account?.name ?? null,
          },
    stages: stages.map(toStageDto),
  };
}

/* -------------------------------------------------------------------------- */
/* Create (the wizard)                                                        */
/* -------------------------------------------------------------------------- */

export type CreateLeadResult = {
  leadId: string;
  accountId: string | null;
  contactId: string | null;
  opportunityId: string | null;
};

/**
 * Creates a lead from the wizard. When the salesperson chose "Save & Create
 * Opportunity", the lead is converted in the same transaction — an opportunity
 * always belongs to a company, so creating one IS a conversion.
 */
export async function createLead(
  actor: Actor,
  rawInput: unknown,
): Promise<CreateLeadResult> {
  await requirePermission(actor, CRM_PERMISSIONS.LEAD_CREATE);
  const input = parseInput(createLeadSchema, rawInput);

  if (input.opportunity !== null) {
    await requirePermission(actor, CRM_PERMISSIONS.LEAD_UPDATE);
    await requirePermission(actor, CRM_PERMISSIONS.OPPORTUNITY_CREATE);
  }
  const creation = await creationRights(actor);

  const { info, qualification } = input;
  const ownerId = input.ownerId ?? actor.id;
  const status: LeadStatus = qualification.status;

  try {
    return await prisma.$transaction(async (tx) => {
      const lead = await tx.crmLead.create({
        data: {
          firstName: info.firstName,
          lastName: info.lastName,
          company: info.company,
          jobTitle: info.jobTitle,
          email: info.email,
          phone: info.phone,
          website: info.website,
          source: info.source,
          industry: info.industry,
          companySize: info.companySize,
          country: info.country,
          city: info.city,
          interest: qualification.interest,
          budgetMinor:
            qualification.budget === undefined
              ? null
              : toMinorUnits(qualification.budget, qualification.budgetCurrency),
          currency: qualification.budgetCurrency,
          timeline: qualification.timeline ?? null,
          decisionMaker: qualification.decisionMaker ?? null,
          currentSolution: qualification.currentSolution,
          painPoint: qualification.painPoint,
          score: qualification.score,
          status,
          ownerId,
          createdBy: actor.id,
          updatedBy: actor.id,
        },
        select: { id: true, firstName: true, lastName: true, company: true },
      });

      await tx.crmActivity.create({
        data: {
          type: "STATUS_CHANGE",
          subject: `Lead created as ${LEAD_STATUS_LABELS[status]}`,
          leadId: lead.id,
          createdBy: actor.id,
          metadata: { toStatus: status },
        },
      });

      await recordAudit(
        {
          ...auditFields(actor),
          action: "crm.lead.created",
          module: CRM_MODULE,
          entityType: "CrmLead",
          entityId: lead.id,
          summary: `Created lead ${personName(lead)} (${lead.company})`,
        },
        tx,
      );

      await publish(tx, {
        name: CRM_EVENTS.LEAD_CREATED,
        actorId: actor.id,
        correlationId: actor.correlationId ?? null,
        payload: { leadId: lead.id },
      });

      if (input.opportunity === null) {
        return { leadId: lead.id, accountId: null, contactId: null, opportunityId: null };
      }

      const conversion = await convertWithinTransaction(tx, actor, lead.id, {
        accountId: null,
        contactId: null,
        opportunity: input.opportunity,
        ...creation,
      });
      return { leadId: lead.id, ...conversion };
    });
  } catch (error) {
    throw translateUniqueViolation(error);
  }
}

/* -------------------------------------------------------------------------- */
/* Update                                                                     */
/* -------------------------------------------------------------------------- */

export async function updateLead(
  actor: Actor,
  leadId: string,
  rawInput: unknown,
): Promise<void> {
  const existing = await loadLeadForWrite(actor, leadId);
  const input = parseInput(updateLeadSchema, rawInput);

  // A converted lead's status is history; it cannot be edited back.
  const nextStatus: LeadStatus =
    existing.status === "CONVERTED" ? "CONVERTED" : input.status;
  const statusChanged = nextStatus !== existing.status;

  const data = {
    firstName: input.firstName,
    lastName: input.lastName,
    company: input.company,
    jobTitle: input.jobTitle,
    email: input.email,
    phone: input.phone,
    website: input.website,
    source: input.source,
    industry: input.industry,
    companySize: input.companySize,
    country: input.country,
    city: input.city,
    interest: input.interest,
    budgetMinor:
      input.budget === undefined
        ? null
        : toMinorUnits(input.budget, input.budgetCurrency),
    currency: input.budgetCurrency,
    timeline: input.timeline ?? null,
    decisionMaker: input.decisionMaker ?? null,
    currentSolution: input.currentSolution,
    painPoint: input.painPoint,
    score: input.score,
    status: nextStatus,
    ownerId: input.ownerId ?? existing.ownerId,
  };

  await prisma.$transaction(async (tx) => {
    await tx.crmLead.update({
      where: { id: leadId },
      data: {
        ...data,
        ...(statusChanged ? { statusChangedAt: new Date() } : {}),
        updatedBy: actor.id,
      },
    });

    if (statusChanged) {
      await writeStatusChange(tx, actor, leadId, existing.status, nextStatus);
    }

    await recordAudit(
      {
        ...auditFields(actor),
        action: "crm.lead.updated",
        module: CRM_MODULE,
        entityType: "CrmLead",
        entityId: leadId,
        summary: `Updated lead ${input.firstName} ${input.lastName}`,
        changes: diffForAudit(existing.snapshot, data),
      },
      tx,
    );

    await publish(tx, {
      name: CRM_EVENTS.LEAD_UPDATED,
      actorId: actor.id,
      correlationId: actor.correlationId ?? null,
      payload: { leadId },
    });
  });
}

/** Moves a lead along New → Contacted → Qualified (or Disqualified). */
export async function setLeadStatus(actor: Actor, rawInput: unknown): Promise<void> {
  const input = parseInput(setLeadStatusSchema, rawInput);
  const existing = await loadLeadForWrite(actor, input.leadId);

  if (existing.status === "CONVERTED") {
    throw new BusinessRuleError(
      "This lead has been converted; its status can no longer change.",
    );
  }
  if (existing.status === input.status) return;

  await prisma.$transaction(async (tx) => {
    await tx.crmLead.update({
      where: { id: input.leadId },
      data: { status: input.status, statusChangedAt: new Date(), updatedBy: actor.id },
    });
    await writeStatusChange(tx, actor, input.leadId, existing.status, input.status);
    await recordAudit(
      {
        ...auditFields(actor),
        action: "crm.lead.status_changed",
        module: CRM_MODULE,
        entityType: "CrmLead",
        entityId: input.leadId,
        summary: `Lead status ${LEAD_STATUS_LABELS[existing.status]} → ${LEAD_STATUS_LABELS[input.status]}`,
        changes: { status: { from: existing.status, to: input.status } },
      },
      tx,
    );
    await publish(tx, {
      name: CRM_EVENTS.LEAD_STATUS_CHANGED,
      actorId: actor.id,
      correlationId: actor.correlationId ?? null,
      payload: { leadId: input.leadId, status: input.status },
    });
  });
}

/** Applies a status and/or owner to many leads. Converted leads keep their status. */
export async function bulkUpdateLeads(
  actor: Actor,
  input: { leadIds: readonly string[]; status?: LeadStatus; ownerId?: string },
): Promise<{ updated: number; skipped: number }> {
  const ids = [...new Set(input.leadIds)].filter(isUuid).slice(0, 100);
  if (ids.length === 0) {
    throw new ValidationError("Select at least one lead.", {
      leadIds: ["Select at least one lead."],
    });
  }
  if (input.status === undefined && input.ownerId === undefined) {
    throw new ValidationError("Choose a status or an owner to apply.");
  }

  let updated = 0;
  let skipped = 0;
  for (const leadId of ids) {
    const existing = await loadLeadForWrite(actor, leadId);
    if (existing.status === "CONVERTED" && input.status !== undefined) {
      skipped += 1;
      continue;
    }
    if (input.status !== undefined && input.status !== "CONVERTED") {
      await setLeadStatus(actor, { leadId, status: input.status });
    }
    if (input.ownerId !== undefined && input.ownerId !== existing.ownerId) {
      const ownerId = input.ownerId;
      await prisma.$transaction(async (tx) => {
        await tx.crmLead.update({
          where: { id: leadId },
          data: { ownerId, updatedBy: actor.id },
        });
        await recordAudit(
          {
            ...auditFields(actor),
            action: "crm.lead.reassigned",
            module: CRM_MODULE,
            entityType: "CrmLead",
            entityId: leadId,
            summary: "Reassigned lead owner",
            changes: { ownerId: { from: existing.ownerId, to: ownerId } },
          },
          tx,
        );
      });
    }
    updated += 1;
  }
  return { updated, skipped };
}

/* -------------------------------------------------------------------------- */
/* Conversion                                                                 */
/* -------------------------------------------------------------------------- */

export async function convertLead(
  actor: Actor,
  rawInput: unknown,
): Promise<ConversionResult> {
  const input = parseInput(convertLeadSchema, rawInput);
  await loadLeadForWrite(actor, input.leadId);

  if (input.createOpportunity) {
    await requirePermission(actor, CRM_PERMISSIONS.OPPORTUNITY_CREATE);
    if (input.opportunity === null) {
      throw new ValidationError("Describe the opportunity to create.", {
        "opportunity.name": ["Opportunity name is required."],
      });
    }
  }
  if (input.accountMode === "existing" && input.accountId === null) {
    throw new ValidationError("Choose the company to use.", {
      accountId: ["Choose a company."],
    });
  }
  if (input.contactMode === "existing" && input.contactId === null) {
    throw new ValidationError("Choose the contact to use.", {
      contactId: ["Choose a contact."],
    });
  }

  const creation = await creationRights(actor);

  try {
    return await prisma.$transaction((tx) =>
      convertWithinTransaction(tx, actor, input.leadId, {
        accountId: input.accountMode === "existing" ? input.accountId : null,
        contactId: input.contactMode === "existing" ? input.contactId : null,
        opportunity: input.createOpportunity ? input.opportunity : null,
        ...creation,
      }),
    );
  } catch (error) {
    throw translateUniqueViolation(error);
  }
}

type ConversionOptions = {
  /** Reuse this company; otherwise match by company name, then create. */
  accountId: string | null;
  /** Reuse this contact; otherwise match by email, then create. */
  contactId: string | null;
  opportunity: OpportunityDraft | null;
  canCreateAccount: boolean;
  canCreateContact: boolean;
};

async function creationRights(
  actor: Actor,
): Promise<{ canCreateAccount: boolean; canCreateContact: boolean }> {
  const rights = await canAll(actor, [
    CRM_PERMISSIONS.ACCOUNT_CREATE,
    CRM_PERMISSIONS.CONTACT_CREATE,
  ]);
  return {
    canCreateAccount: rights[CRM_PERMISSIONS.ACCOUNT_CREATE] === true,
    canCreateContact: rights[CRM_PERMISSIONS.CONTACT_CREATE] === true,
  };
}

/**
 * Converts a lead inside an existing transaction.
 *
 * Existing records are reused before anything is created — a company by name, a
 * contact by email — so conversion never duplicates a customer (§6.1: the account
 * is the one authoritative customer record). The partial unique indexes on
 * company name and contact email make that hold under a race.
 */
async function convertWithinTransaction(
  tx: PrismaTransaction,
  actor: Actor,
  leadId: string,
  options: ConversionOptions,
): Promise<ConversionResult> {
  const lead = await tx.crmLead.findFirst({
    where: { id: leadId, deletedAt: null },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      company: true,
      jobTitle: true,
      email: true,
      phone: true,
      website: true,
      industry: true,
      companySize: true,
      country: true,
      city: true,
      source: true,
      status: true,
      ownerId: true,
      painPoint: true,
    },
  });
  if (lead === null) throw new NotFoundError("lead");
  if (lead.status === "CONVERTED") {
    throw new BusinessRuleError("This lead has already been converted.");
  }

  const now = new Date();
  const ownerId = lead.ownerId ?? actor.id;

  // Company -----------------------------------------------------------------
  let account: { id: string; name: string } | null = null;
  let accountCreated = false;
  if (options.accountId !== null) {
    account = await tx.crmAccount.findFirst({
      where: { id: options.accountId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (account === null) throw new NotFoundError("company");
  } else {
    account = await tx.crmAccount.findFirst({
      where: { deletedAt: null, name: equalsInsensitive(lead.company) },
      select: { id: true, name: true },
    });
    if (account === null) {
      if (!options.canCreateAccount) {
        throw new ForbiddenError("You do not have permission to create companies.");
      }
      account = await tx.crmAccount.create({
        data: {
          name: lead.company,
          website: lead.website,
          industry: lead.industry,
          companySize: lead.companySize,
          country: lead.country,
          city: lead.city,
          ownerId,
          createdBy: actor.id,
          updatedBy: actor.id,
        },
        select: { id: true, name: true },
      });
      accountCreated = true;
    }
  }

  // Contact -----------------------------------------------------------------
  let contact: { id: string; accountId: string | null } | null = null;
  if (options.contactId !== null) {
    contact = await tx.crmContact.findFirst({
      where: { id: options.contactId, deletedAt: null },
      select: { id: true, accountId: true },
    });
    if (contact === null) throw new NotFoundError("contact");
  } else if (lead.email !== null) {
    contact = await tx.crmContact.findFirst({
      where: { deletedAt: null, email: equalsInsensitive(lead.email) },
      select: { id: true, accountId: true },
    });
  }

  if (contact === null) {
    if (!options.canCreateContact) {
      throw new ForbiddenError("You do not have permission to create contacts.");
    }
    contact = await tx.crmContact.create({
      data: {
        firstName: lead.firstName,
        lastName: lead.lastName,
        jobTitle: lead.jobTitle,
        email: lead.email,
        phone: lead.phone,
        country: lead.country,
        city: lead.city,
        accountId: account.id,
        ownerId,
        createdBy: actor.id,
        updatedBy: actor.id,
      },
      select: { id: true, accountId: true },
    });
    await publish(tx, {
      name: CRM_EVENTS.CONTACT_CREATED,
      actorId: actor.id,
      correlationId: actor.correlationId ?? null,
      payload: { contactId: contact.id, accountId: account.id },
    });
  } else if (contact.accountId === null) {
    // A floating contact found by email now belongs to the converted company.
    await tx.crmContact.update({
      where: { id: contact.id },
      data: { accountId: account.id, updatedBy: actor.id },
    });
  }

  // Opportunity -------------------------------------------------------------
  let opportunityId: string | null = null;
  if (options.opportunity !== null) {
    const draft = options.opportunity;
    const stage =
      draft.stageId !== null
        ? await tx.crmOpportunityStage.findFirst({
            where: { id: draft.stageId, isActive: true },
            select: stageSelect,
          })
        : ((await tx.crmOpportunityStage.findFirst({
            where: { key: CONVERSION_STAGE_KEY, isActive: true },
            select: stageSelect,
          })) ??
          (await tx.crmOpportunityStage.findFirst({
            where: { isActive: true, kind: "OPEN" },
            orderBy: { position: "asc" },
            select: stageSelect,
          })));

    if (stage === null || stage.kind !== "OPEN") {
      throw new BusinessRuleError(
        "Choose an open pipeline stage for the new opportunity.",
      );
    }

    const opportunity = await tx.crmOpportunity.create({
      data: {
        name: draft.name,
        accountId: account.id,
        stageId: stage.id,
        status: "OPEN",
        amountMinor: toMinorUnits(draft.amount, draft.currency),
        currency: draft.currency,
        closeDate: draft.closeDate,
        probability: draft.probability,
        channel: draft.channel,
        partnerName: draft.channel === "INDIRECT" ? draft.partnerName : null,
        source: lead.source,
        product: draft.product,
        description: lead.painPoint === null ? null : `Pain point: ${lead.painPoint}`,
        ownerId: draft.ownerId ?? ownerId,
        stageChangedAt: now,
        createdBy: actor.id,
        updatedBy: actor.id,
        contacts: { create: { contactId: contact.id, isPrimary: true } },
      },
      select: { id: true, name: true },
    });
    opportunityId = opportunity.id;

    await tx.crmActivity.create({
      data: {
        type: "STAGE_CHANGE",
        subject: `Opportunity created in ${stage.name}`,
        opportunityId,
        accountId: account.id,
        contactId: contact.id,
        leadId,
        createdBy: actor.id,
        metadata: { toStage: stage.name, toStageId: stage.id },
      },
    });

    await publish(tx, {
      name: CRM_EVENTS.OPPORTUNITY_CREATED,
      actorId: actor.id,
      correlationId: actor.correlationId ?? null,
      payload: { opportunityId, accountId: account.id, stageId: stage.id },
    });
  }

  // The lead ----------------------------------------------------------------
  await tx.crmLead.update({
    where: { id: leadId },
    data: {
      status: "CONVERTED",
      statusChangedAt: now,
      convertedAt: now,
      convertedAccountId: account.id,
      convertedContactId: contact.id,
      convertedOpportunityId: opportunityId,
      updatedBy: actor.id,
    },
  });

  // Carry the lead's history onto what it became, so the company, contact and
  // opportunity timelines start with the conversation that created them.
  await tx.crmActivity.updateMany({
    where: { leadId, accountId: null },
    data: { accountId: account.id },
  });
  await tx.crmActivity.updateMany({
    where: { leadId, contactId: null },
    data: { contactId: contact.id },
  });
  if (opportunityId !== null) {
    await tx.crmActivity.updateMany({
      where: { leadId, opportunityId: null },
      data: { opportunityId },
    });
  }

  await tx.crmActivity.create({
    data: {
      type: "STATUS_CHANGE",
      subject: "Lead converted",
      body:
        opportunityId === null
          ? `Converted to ${account.name}.`
          : `Converted to ${account.name} with a new opportunity.`,
      leadId,
      accountId: account.id,
      contactId: contact.id,
      opportunityId,
      createdBy: actor.id,
      metadata: { fromStatus: lead.status, toStatus: "CONVERTED" },
    },
  });

  await recordAudit(
    {
      ...auditFields(actor),
      action: "crm.lead.converted",
      module: CRM_MODULE,
      entityType: "CrmLead",
      entityId: leadId,
      summary: `Converted lead ${personName(lead)} into ${account.name}`,
      changes: {
        accountId: account.id,
        accountCreated,
        contactId: contact.id,
        opportunityId,
      },
      severity: "NOTICE",
    },
    tx,
  );

  if (accountCreated) {
    await publish(tx, {
      name: CRM_EVENTS.CUSTOMER_CREATED,
      actorId: actor.id,
      correlationId: actor.correlationId ?? null,
      payload: { accountId: account.id },
    });
  }

  await publish(tx, {
    name: CRM_EVENTS.LEAD_CONVERTED,
    actorId: actor.id,
    correlationId: actor.correlationId ?? null,
    payload: { leadId, accountId: account.id, contactId: contact.id, opportunityId },
  });

  return { accountId: account.id, contactId: contact.id, opportunityId };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Loads a lead the actor may update, enforcing read (404) then update (403). */
async function loadLeadForWrite(actor: Actor, leadId: string) {
  if (!isUuid(leadId)) throw new NotFoundError("lead");
  const row = await prisma.crmLead.findFirst({
    where: { id: leadId, deletedAt: null },
    select: {
      id: true,
      status: true,
      ownerId: true,
      firstName: true,
      lastName: true,
      company: true,
      email: true,
      score: true,
      source: true,
      owner: { select: userRefSelect },
    },
  });
  if (row === null) throw new NotFoundError("lead");

  const target = toScopeTarget(row.ownerId, row.owner);
  await assertCanRead(actor, CRM_PERMISSIONS.LEAD_READ, target, "lead");
  await requirePermission(actor, CRM_PERMISSIONS.LEAD_UPDATE, target);

  return {
    status: row.status,
    ownerId: row.ownerId,
    snapshot: {
      firstName: row.firstName,
      lastName: row.lastName,
      company: row.company,
      email: row.email,
      score: row.score,
      source: row.source,
      status: row.status,
      ownerId: row.ownerId,
    } as Record<string, unknown>,
  };
}

async function writeStatusChange(
  tx: PrismaTransaction,
  actor: Actor,
  leadId: string,
  from: LeadStatus,
  to: LeadStatus,
): Promise<void> {
  await tx.crmActivity.create({
    data: {
      type: "STATUS_CHANGE",
      subject: `Status changed to ${LEAD_STATUS_LABELS[to]}`,
      leadId,
      createdBy: actor.id,
      metadata: { fromStatus: from, toStatus: to },
    },
  });
}

function translateUniqueViolation(error: unknown): unknown {
  if (isUniqueViolation(error)) {
    return new ConflictError(
      "A company or contact with these details was just created by someone else. Please try again.",
    );
  }
  return error;
}
