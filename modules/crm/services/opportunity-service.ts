import type { Prisma } from "@prisma/client";
import { BusinessRuleError, NotFoundError, ValidationError } from "@/lib/errors";
import { toMinorUnits } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { diffForAudit, recordAudit } from "@/platform/audit/audit";
import { type Actor, requirePermission } from "@/platform/authz/authz";
import { publish } from "@/platform/events/publish";
import { CRM_EVENTS } from "../contracts/events";
import { CRM_PERMISSIONS } from "../contracts/permissions";
import {
  listParamsSchema,
  moveOpportunitySchema,
  opportunityEditSchema,
  opportunitySchema,
  pipelineFiltersSchema,
  type PipelineFilters,
} from "../contracts/schemas";
import {
  LOST_REASON_LABELS,
  type OpportunityDetail,
  type OpportunityListItem,
  type OpportunityStatus,
  type Paginated,
  type PipelineBoard,
  type StageDto,
} from "../contracts/types";
import {
  closedVisibleSince,
  planStageMove,
  startOfUtcMonth,
  summariseOpen,
  totalsFromGroups,
  type CloseDetails,
} from "../domain/pipeline";
import {
  opportunityDetailSelect,
  opportunityListSelect,
  stageSelect,
  toOpportunityDetail,
  toOpportunityListItem,
  toScopeTarget,
  toStageDto,
  userRefSelect,
} from "../repositories/selects";
import {
  CRM_MODULE,
  assertCanRead,
  auditFields,
  insensitive,
  isUuid,
  ownerScope,
  parseInput,
  searchTerms,
} from "./support";

/**
 * Opportunities and the pipeline.
 *
 * Stage changes — from the board, the stage tracker or anywhere else — all go
 * through `moveOpportunity`, so a drag on the board and a click on the detail
 * page produce exactly the same record, timeline entry, audit row and events.
 *
 * Every money figure is per currency. There is no code path that adds EGP to USD.
 */

/* -------------------------------------------------------------------------- */
/* Stages                                                                     */
/* -------------------------------------------------------------------------- */

export async function listStages(actor: Actor): Promise<StageDto[]> {
  await requirePermission(actor, CRM_PERMISSIONS.ACCESS);
  const rows = await prisma.crmOpportunityStage.findMany({
    where: { isActive: true },
    orderBy: { position: "asc" },
    select: stageSelect,
  });
  return rows.map(toStageDto);
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

function filterWhere(filters: PipelineFilters): Prisma.CrmOpportunityWhereInput[] {
  const clauses: Prisma.CrmOpportunityWhereInput[] = [];
  if (filters.ownerId !== null) clauses.push({ ownerId: filters.ownerId });
  if (filters.stageId !== null) clauses.push({ stageId: filters.stageId });
  if (filters.currency !== undefined) clauses.push({ currency: filters.currency });
  if (filters.channel !== undefined) clauses.push({ channel: filters.channel });
  // Amounts compare in each deal's own currency (both use 100 minor units).
  if (filters.minAmount !== undefined) {
    clauses.push({ amountMinor: { gte: toMinorUnits(filters.minAmount, "EGP") } });
  }
  if (filters.maxAmount !== undefined) {
    clauses.push({ amountMinor: { lte: toMinorUnits(filters.maxAmount, "EGP") } });
  }
  if (filters.closeFrom !== undefined) {
    clauses.push({ closeDate: { gte: new Date(`${filters.closeFrom}T00:00:00.000Z`) } });
  }
  if (filters.closeTo !== undefined) {
    clauses.push({ closeDate: { lte: new Date(`${filters.closeTo}T00:00:00.000Z`) } });
  }
  if (filters.industry !== undefined && filters.industry !== "") {
    clauses.push({
      account: { industry: { equals: filters.industry, mode: "insensitive" } },
    });
  }
  if (filters.source !== undefined) clauses.push({ source: filters.source });
  for (const term of searchTerms(filters.q)) {
    clauses.push({
      OR: [
        { name: insensitive(term) },
        { account: { name: insensitive(term) } },
        { partnerName: insensitive(term) },
        { product: insensitive(term) },
      ],
    });
  }
  return clauses;
}

export async function listOpportunities(
  actor: Actor,
  rawParams: Record<string, unknown> = {},
  rawFilters: Record<string, unknown> = {},
  status?: OpportunityStatus,
): Promise<Paginated<OpportunityListItem>> {
  await requirePermission(actor, CRM_PERMISSIONS.OPPORTUNITY_READ);
  const params = listParamsSchema.parse(rawParams);
  const filters = pipelineFiltersSchema.parse(rawFilters);
  const scoped = await ownerScope(actor, CRM_PERMISSIONS.OPPORTUNITY_READ);

  const where: Prisma.CrmOpportunityWhereInput = {
    AND: [
      { deletedAt: null },
      scoped as Prisma.CrmOpportunityWhereInput,
      status !== undefined ? { status } : {},
      ...filterWhere({ ...filters, q: params.q ?? filters.q }),
    ],
  };

  const orderBy: Prisma.CrmOpportunityOrderByWithRelationInput[] = (() => {
    switch (params.sort) {
      case "name":
        return [{ name: params.dir }];
      case "amount":
        return [{ currency: "asc" }, { amountMinor: params.dir }];
      case "stage":
        return [{ stage: { position: params.dir } }, { closeDate: "asc" }];
      case "probability":
        return [{ probability: params.dir }];
      case "account":
        return [{ account: { name: params.dir } }];
      case "closeDate":
        return [{ closeDate: params.dir }];
      default:
        return [{ closeDate: "asc" }];
    }
  })();

  const [total, rows] = await Promise.all([
    prisma.crmOpportunity.count({ where }),
    prisma.crmOpportunity.findMany({
      where,
      orderBy,
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
      select: opportunityListSelect,
    }),
  ]);

  return {
    rows: rows.map(toOpportunityListItem),
    total,
    page: params.page,
    pageSize: params.pageSize,
  };
}

/** Cards rendered per column. Counts and totals always cover every match. */
const MAX_CARDS_PER_COLUMN = 100;

/**
 * The kanban board. Open deals are all shown; closed deals only from the last
 * `CLOSED_VISIBLE_DAYS`, so Closed Won does not grow forever. Column counts and
 * per-currency totals are computed in the database over exactly what the column
 * represents.
 */
export async function getPipeline(
  actor: Actor,
  rawFilters: Record<string, unknown> = {},
  now: Date = new Date(),
): Promise<PipelineBoard> {
  await requirePermission(actor, CRM_PERMISSIONS.OPPORTUNITY_READ);
  const filters = pipelineFiltersSchema.parse(rawFilters);
  const scoped = await ownerScope(actor, CRM_PERMISSIONS.OPPORTUNITY_READ);
  const since = closedVisibleSince(now);
  const monthStart = startOfUtcMonth(now);

  const base: Prisma.CrmOpportunityWhereInput[] = [
    { deletedAt: null },
    scoped as Prisma.CrmOpportunityWhereInput,
    ...filterWhere(filters),
  ];
  const boardWhere: Prisma.CrmOpportunityWhereInput = {
    AND: [
      ...base,
      {
        OR: [
          { status: "OPEN" },
          { status: "WON", wonAt: { gte: since } },
          { status: "LOST", lostAt: { gte: since } },
        ],
      },
    ],
  };

  const [stageRows, cards, columnGroups, openRows, wonGroups, lostGroups] =
    await Promise.all([
      prisma.crmOpportunityStage.findMany({
        where: {
          isActive: true,
          ...(filters.stageId !== null ? { id: filters.stageId } : {}),
        },
        orderBy: { position: "asc" },
        select: stageSelect,
      }),
      prisma.crmOpportunity.findMany({
        where: boardWhere,
        orderBy: [{ closeDate: "asc" }, { amountMinor: "desc" }],
        take: MAX_CARDS_PER_COLUMN * 8,
        select: opportunityListSelect,
      }),
      prisma.crmOpportunity.groupBy({
        by: ["stageId", "currency"],
        where: boardWhere,
        _count: { _all: true },
        _sum: { amountMinor: true },
      }),
      prisma.crmOpportunity.findMany({
        where: { AND: [...base, { status: "OPEN" }] },
        select: { currency: true, amountMinor: true, probability: true },
      }),
      prisma.crmOpportunity.groupBy({
        by: ["currency"],
        where: { AND: [...base, { status: "WON", wonAt: { gte: monthStart } }] },
        _sum: { amountMinor: true },
      }),
      prisma.crmOpportunity.groupBy({
        by: ["currency"],
        where: { AND: [...base, { status: "LOST", lostAt: { gte: monthStart } }] },
        _sum: { amountMinor: true },
      }),
    ]);

  const open = summariseOpen(openRows);

  return {
    summary: {
      openCount: openRows.length,
      open: open.open,
      weighted: open.weighted,
      wonThisMonth: totalsFromGroups(wonGroups),
      lostThisMonth: totalsFromGroups(lostGroups),
    },
    columns: stageRows.map((stage) => {
      const groups = columnGroups.filter((group) => group.stageId === stage.id);
      return {
        stage: toStageDto(stage),
        count: groups.reduce((sum, group) => sum + group._count._all, 0),
        totals: totalsFromGroups(groups),
        cards: cards
          .filter((card) => card.stageId === stage.id)
          .slice(0, MAX_CARDS_PER_COLUMN)
          .map(toOpportunityListItem),
      };
    }),
  };
}

export async function getOpportunity(
  actor: Actor,
  opportunityId: string,
): Promise<OpportunityDetail> {
  if (!isUuid(opportunityId)) throw new NotFoundError("opportunity");
  const row = await prisma.crmOpportunity.findFirst({
    where: { id: opportunityId, deletedAt: null },
    select: opportunityDetailSelect,
  });
  if (row === null) throw new NotFoundError("opportunity");
  await assertCanRead(
    actor,
    CRM_PERMISSIONS.OPPORTUNITY_READ,
    toScopeTarget(row.ownerId, row.owner),
    "opportunity",
  );
  return toOpportunityDetail(row);
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

export async function createOpportunity(
  actor: Actor,
  rawInput: unknown,
): Promise<{ id: string }> {
  await requirePermission(actor, CRM_PERMISSIONS.OPPORTUNITY_CREATE);
  const input = parseInput(opportunitySchema, rawInput);

  const [account, stage] = await Promise.all([
    prisma.crmAccount.findFirst({
      where: { id: input.accountId, deletedAt: null },
      select: { id: true, name: true, ownerId: true, owner: { select: userRefSelect } },
    }),
    prisma.crmOpportunityStage.findFirst({
      where: { id: input.stageId, isActive: true },
      select: stageSelect,
    }),
  ]);
  if (account === null) throw new NotFoundError("company");
  await assertCanRead(
    actor,
    CRM_PERMISSIONS.ACCOUNT_READ,
    toScopeTarget(account.ownerId, account.owner),
    "company",
  );
  if (stage === null) throw new NotFoundError("stage");
  if (stage.kind !== "OPEN") {
    throw new BusinessRuleError(
      "Create the opportunity in an open stage, then close it from the pipeline.",
    );
  }
  await assertContactExists(input.primaryContactId);

  return prisma.$transaction(async (tx) => {
    const opportunity = await tx.crmOpportunity.create({
      data: {
        name: input.name,
        accountId: account.id,
        stageId: stage.id,
        status: "OPEN",
        amountMinor: toMinorUnits(input.amount, input.currency),
        currency: input.currency,
        closeDate: input.closeDate,
        probability: input.probability,
        priority: input.priority,
        channel: input.channel,
        partnerName: input.channel === "INDIRECT" ? input.partnerName : null,
        source: input.source,
        product: input.product,
        description: input.description,
        ownerId: input.ownerId ?? actor.id,
        createdBy: actor.id,
        updatedBy: actor.id,
        ...(input.primaryContactId !== null
          ? {
              contacts: {
                create: { contactId: input.primaryContactId, isPrimary: true },
              },
            }
          : {}),
      },
      select: { id: true, name: true },
    });

    await tx.crmActivity.create({
      data: {
        type: "STAGE_CHANGE",
        subject: `Opportunity created in ${stage.name}`,
        opportunityId: opportunity.id,
        accountId: account.id,
        contactId: input.primaryContactId,
        createdBy: actor.id,
        metadata: { toStage: stage.name, toStageId: stage.id },
      },
    });
    await recordAudit(
      {
        ...auditFields(actor),
        action: "crm.opportunity.created",
        module: CRM_MODULE,
        entityType: "CrmOpportunity",
        entityId: opportunity.id,
        summary: `Created opportunity ${opportunity.name} for ${account.name}`,
      },
      tx,
    );
    await publish(tx, {
      name: CRM_EVENTS.OPPORTUNITY_CREATED,
      actorId: actor.id,
      correlationId: actor.correlationId ?? null,
      payload: {
        opportunityId: opportunity.id,
        accountId: account.id,
        stageId: stage.id,
      },
    });
    return { id: opportunity.id };
  });
}

/** Edits deal details. The stage is changed only through `moveOpportunity`. */
export async function updateOpportunity(
  actor: Actor,
  opportunityId: string,
  rawInput: unknown,
): Promise<void> {
  const existing = await loadOpportunityForWrite(actor, opportunityId);
  const input = parseInput(opportunityEditSchema, rawInput);

  const account = await prisma.crmAccount.findFirst({
    where: { id: input.accountId, deletedAt: null },
    select: { id: true },
  });
  if (account === null) throw new NotFoundError("company");
  await assertContactExists(input.primaryContactId);

  const data = {
    name: input.name,
    accountId: input.accountId,
    amountMinor: toMinorUnits(input.amount, input.currency),
    currency: input.currency,
    closeDate: input.closeDate,
    probability: input.probability,
    priority: input.priority,
    channel: input.channel,
    partnerName: input.channel === "INDIRECT" ? input.partnerName : null,
    source: input.source,
    product: input.product,
    description: input.description,
    ownerId: input.ownerId ?? existing.ownerId,
  };

  await prisma.$transaction(async (tx) => {
    await tx.crmOpportunity.update({
      where: { id: opportunityId },
      data: { ...data, updatedBy: actor.id },
    });

    if (input.primaryContactId !== existing.primaryContactId) {
      await tx.crmOpportunityContact.updateMany({
        where: { opportunityId, isPrimary: true },
        data: { isPrimary: false },
      });
      if (input.primaryContactId !== null) {
        await tx.crmOpportunityContact.upsert({
          where: {
            opportunityId_contactId: { opportunityId, contactId: input.primaryContactId },
          },
          create: { opportunityId, contactId: input.primaryContactId, isPrimary: true },
          update: { isPrimary: true },
        });
      }
    }

    await recordAudit(
      {
        ...auditFields(actor),
        action: "crm.opportunity.updated",
        module: CRM_MODULE,
        entityType: "CrmOpportunity",
        entityId: opportunityId,
        summary: `Updated opportunity ${input.name}`,
        changes: diffForAudit(existing.snapshot, data),
      },
      tx,
    );
    await publish(tx, {
      name: CRM_EVENTS.OPPORTUNITY_UPDATED,
      actorId: actor.id,
      correlationId: actor.correlationId ?? null,
      payload: { opportunityId },
    });
  });
}

/**
 * Moves an opportunity to another stage — the drag-and-drop operation.
 *
 * Closing (WON/LOST) requires its details; the rules live in `planStageMove`.
 * Returns the updated card so the board can reconcile its optimistic state with
 * what the server actually stored.
 */
export async function moveOpportunity(
  actor: Actor,
  rawInput: unknown,
  now: Date = new Date(),
): Promise<OpportunityListItem> {
  const input = parseInput(moveOpportunitySchema, rawInput);
  const existing = await loadOpportunityForWrite(actor, input.opportunityId);

  const target = await prisma.crmOpportunityStage.findFirst({
    where: { id: input.stageId, isActive: true },
    select: stageSelect,
  });
  if (target === null) throw new NotFoundError("stage");

  if (target.id === existing.stageId) {
    return getCard(input.opportunityId);
  }

  const close: CloseDetails | null =
    input.close === null
      ? null
      : input.close.kind === "WON"
        ? {
            kind: "WON",
            actualCloseDate: input.close.actualCloseDate,
            // The final value is in the deal's own currency.
            finalAmountMinor: toMinorUnits(input.close.finalAmount, existing.currency),
            notes: input.close.notes,
          }
        : { kind: "LOST", lostReason: input.close.lostReason, notes: input.close.notes };

  const outcome = planStageMove(target, close, now);
  if (!outcome.ok) {
    throw new ValidationError(outcome.message, { close: [outcome.message] });
  }
  const plan = outcome.plan;

  await prisma.$transaction(async (tx) => {
    await tx.crmOpportunity.update({
      where: { id: input.opportunityId },
      data: {
        stageId: target.id,
        status: plan.status,
        probability: plan.probability,
        ...(plan.amountMinor !== undefined ? { amountMinor: plan.amountMinor } : {}),
        ...(plan.closeDate !== undefined ? { closeDate: plan.closeDate } : {}),
        wonAt: plan.wonAt,
        lostAt: plan.lostAt,
        lostReason: plan.lostReason,
        closeNotes: plan.closeNotes,
        stageChangedAt: now,
        updatedBy: actor.id,
      },
    });

    const closingLine =
      plan.status === "LOST" && plan.lostReason !== null
        ? `Lost reason: ${LOST_REASON_LABELS[plan.lostReason]}.`
        : null;
    const body = [closingLine, plan.closeNotes].filter((part) => part !== null).join(" ");

    await tx.crmActivity.create({
      data: {
        type: "STAGE_CHANGE",
        subject: `Moved from ${existing.stageName} to ${target.name}`,
        body: body === "" ? null : body,
        opportunityId: input.opportunityId,
        accountId: existing.accountId,
        createdBy: actor.id,
        occurredAt: now,
        metadata: {
          fromStage: existing.stageName,
          fromStageId: existing.stageId,
          toStage: target.name,
          toStageId: target.id,
          status: plan.status,
        },
      },
    });

    await recordAudit(
      {
        ...auditFields(actor),
        action:
          plan.status === "WON"
            ? "crm.opportunity.won"
            : plan.status === "LOST"
              ? "crm.opportunity.lost"
              : "crm.opportunity.stage_changed",
        module: CRM_MODULE,
        entityType: "CrmOpportunity",
        entityId: input.opportunityId,
        summary: `${existing.name}: ${existing.stageName} → ${target.name}`,
        changes: {
          stage: { from: existing.stageName, to: target.name },
          status: { from: existing.status, to: plan.status },
        },
        severity: plan.status === "OPEN" ? "INFO" : "NOTICE",
      },
      tx,
    );

    await publish(tx, {
      name: CRM_EVENTS.OPPORTUNITY_STAGE_CHANGED,
      actorId: actor.id,
      correlationId: actor.correlationId ?? null,
      payload: {
        opportunityId: input.opportunityId,
        fromStageId: existing.stageId,
        toStageId: target.id,
      },
    });
    if (plan.status === "WON" || plan.status === "LOST") {
      await publish(tx, {
        name:
          plan.status === "WON"
            ? CRM_EVENTS.OPPORTUNITY_WON
            : CRM_EVENTS.OPPORTUNITY_LOST,
        actorId: actor.id,
        correlationId: actor.correlationId ?? null,
        payload: { opportunityId: input.opportunityId, accountId: existing.accountId },
      });
    }
  });

  return getCard(input.opportunityId);
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

async function getCard(opportunityId: string): Promise<OpportunityListItem> {
  const row = await prisma.crmOpportunity.findFirst({
    where: { id: opportunityId, deletedAt: null },
    select: opportunityListSelect,
  });
  if (row === null) throw new NotFoundError("opportunity");
  return toOpportunityListItem(row);
}

async function loadOpportunityForWrite(actor: Actor, opportunityId: string) {
  if (!isUuid(opportunityId)) throw new NotFoundError("opportunity");
  const row = await prisma.crmOpportunity.findFirst({
    where: { id: opportunityId, deletedAt: null },
    select: {
      id: true,
      name: true,
      accountId: true,
      stageId: true,
      status: true,
      amountMinor: true,
      currency: true,
      closeDate: true,
      probability: true,
      priority: true,
      channel: true,
      partnerName: true,
      source: true,
      product: true,
      description: true,
      ownerId: true,
      owner: { select: userRefSelect },
      stage: { select: { name: true } },
      contacts: { where: { isPrimary: true }, take: 1, select: { contactId: true } },
    },
  });
  if (row === null) throw new NotFoundError("opportunity");

  const target = toScopeTarget(row.ownerId, row.owner);
  await assertCanRead(actor, CRM_PERMISSIONS.OPPORTUNITY_READ, target, "opportunity");
  await requirePermission(actor, CRM_PERMISSIONS.OPPORTUNITY_UPDATE, target);

  return {
    name: row.name,
    accountId: row.accountId,
    stageId: row.stageId,
    stageName: row.stage.name,
    status: row.status,
    currency: row.currency,
    ownerId: row.ownerId,
    primaryContactId: row.contacts[0]?.contactId ?? null,
    snapshot: {
      name: row.name,
      accountId: row.accountId,
      amountMinor: row.amountMinor,
      currency: row.currency,
      closeDate: row.closeDate,
      probability: row.probability,
      priority: row.priority,
      channel: row.channel,
      partnerName: row.partnerName,
      source: row.source,
      product: row.product,
      description: row.description,
      ownerId: row.ownerId,
    } as Record<string, unknown>,
  };
}

async function assertContactExists(contactId: string | null): Promise<void> {
  if (contactId === null) return;
  const contact = await prisma.crmContact.findFirst({
    where: { id: contactId, deletedAt: null },
    select: { id: true },
  });
  if (contact === null) throw new NotFoundError("contact");
}
