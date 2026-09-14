import type { Prisma } from "@prisma/client";
import { BusinessRuleError, NotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/platform/audit/audit";
import { type Actor, requirePermission, scopeFilter } from "@/platform/authz/authz";
import { scopeWhere } from "@/platform/authz/prisma-filter";
import { publish } from "@/platform/events/publish";
import { CRM_EVENTS } from "../contracts/events";
import { CRM_PERMISSIONS } from "../contracts/permissions";
import { activitySchema, listParamsSchema } from "../contracts/schemas";
import {
  ACTIVITY_TYPE_LABELS,
  type ActivityDto,
  type ActivityType,
  type Paginated,
  type RecordRef,
} from "../contracts/types";
import {
  activitySelect,
  toActivityDto,
  toScopeTarget,
  userRefSelect,
} from "../repositories/selects";
import {
  CRM_MODULE,
  assertCanRead,
  auditFields,
  insensitive,
  isUuid,
  parseInput,
  searchTerms,
} from "./support";

/**
 * The unified activity system: calls, emails, meetings, tasks and notes, plus the
 * status and stage changes the CRM writes itself.
 *
 * Logging an activity against a record requires being able to see that record,
 * so the timeline can never become a side channel into data a user may not read.
 */

const TIMELINE_LIMIT = 100;

/** The activity's owner for scope purposes is whoever logged it. */
async function activityScope(actor: Actor): Promise<Prisma.CrmActivityWhereInput> {
  const filter = await scopeFilter(actor, CRM_PERMISSIONS.ACTIVITY_READ);
  return scopeWhere(filter, {
    owner: ["createdBy"],
    orgUnitPath: ["creator", "orgUnit", "path"],
  }) as Prisma.CrmActivityWhereInput;
}

/* -------------------------------------------------------------------------- */
/* Timelines                                                                  */
/* -------------------------------------------------------------------------- */

export async function listTimeline(
  actor: Actor,
  record: Omit<RecordRef, "label">,
): Promise<ActivityDto[]> {
  await requirePermission(actor, CRM_PERMISSIONS.ACTIVITY_READ);
  await assertRecordReadable(actor, record);
  const scoped = await activityScope(actor);

  const link: Prisma.CrmActivityWhereInput =
    record.kind === "lead"
      ? { leadId: record.id }
      : record.kind === "account"
        ? { accountId: record.id }
        : record.kind === "contact"
          ? { contactId: record.id }
          : { opportunityId: record.id };

  const rows = await prisma.crmActivity.findMany({
    where: { AND: [{ deletedAt: null }, link, scoped] },
    orderBy: { occurredAt: "desc" },
    take: TIMELINE_LIMIT,
    select: activitySelect,
  });
  return rows.map(toActivityDto);
}

export type ActivityView = "all" | "tasks" | "notes";

export async function listActivities(
  actor: Actor,
  rawParams: Record<string, unknown> = {},
  options: {
    view: ActivityView;
    taskStatus?: "open" | "done" | "all";
    type?: ActivityType;
    mine?: boolean;
  },
): Promise<Paginated<ActivityDto>> {
  await requirePermission(actor, CRM_PERMISSIONS.ACTIVITY_READ);
  const params = listParamsSchema.parse(rawParams);
  const scoped = await activityScope(actor);

  const viewClause: Prisma.CrmActivityWhereInput =
    options.view === "tasks"
      ? {
          type: "TASK",
          ...(options.taskStatus === "done"
            ? { completedAt: { not: null } }
            : options.taskStatus === "all"
              ? {}
              : { completedAt: null }),
        }
      : options.view === "notes"
        ? { type: "NOTE" }
        : options.type !== undefined
          ? { type: options.type }
          : {};

  const where: Prisma.CrmActivityWhereInput = {
    AND: [
      { deletedAt: null },
      scoped,
      viewClause,
      options.mine === true
        ? { OR: [{ assigneeId: actor.id }, { createdBy: actor.id }] }
        : {},
      ...searchTerms(params.q).map((term) => ({
        OR: [{ subject: insensitive(term) }, { body: insensitive(term) }],
      })),
    ],
  };

  const orderBy: Prisma.CrmActivityOrderByWithRelationInput[] =
    options.view === "tasks" && options.taskStatus !== "done"
      ? [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }]
      : [{ occurredAt: "desc" }];

  const [total, rows] = await Promise.all([
    prisma.crmActivity.count({ where }),
    prisma.crmActivity.findMany({
      where,
      orderBy,
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
      select: activitySelect,
    }),
  ]);

  return {
    rows: rows.map(toActivityDto),
    total,
    page: params.page,
    pageSize: params.pageSize,
  };
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

export async function logActivity(actor: Actor, rawInput: unknown): Promise<ActivityDto> {
  await requirePermission(actor, CRM_PERMISSIONS.ACTIVITY_CREATE);
  const input = parseInput(activitySchema, rawInput);

  // Every linked record must exist and be visible to the actor.
  if (input.leadId !== null)
    await assertRecordReadable(actor, { kind: "lead", id: input.leadId });
  if (input.accountId !== null) {
    await assertRecordReadable(actor, { kind: "account", id: input.accountId });
  }

  // Fill in the company so an activity on a deal or a person also appears on the
  // company's timeline.
  let accountId = input.accountId;
  if (input.opportunityId !== null) {
    const opportunity = await assertRecordReadable(actor, {
      kind: "opportunity",
      id: input.opportunityId,
    });
    accountId ??= opportunity.accountId;
  }
  if (input.contactId !== null) {
    const contact = await assertRecordReadable(actor, {
      kind: "contact",
      id: input.contactId,
    });
    accountId ??= contact.accountId;
  }

  const isTask = input.type === "TASK";

  const created = await prisma.$transaction(async (tx) => {
    const activity = await tx.crmActivity.create({
      data: {
        type: input.type,
        subject: input.subject,
        body: input.body,
        occurredAt: input.occurredAt ?? new Date(),
        durationMinutes: input.durationMinutes ?? null,
        dueAt: isTask ? input.dueAt : null,
        priority: isTask ? (input.priority ?? "MEDIUM") : null,
        assigneeId: isTask ? (input.assigneeId ?? actor.id) : null,
        leadId: input.leadId,
        accountId,
        contactId: input.contactId,
        opportunityId: input.opportunityId,
        createdBy: actor.id,
        updatedBy: actor.id,
      },
      select: activitySelect,
    });

    await recordAudit(
      {
        ...auditFields(actor),
        action: "crm.activity.logged",
        module: CRM_MODULE,
        entityType: "CrmActivity",
        entityId: activity.id,
        summary: `Logged ${ACTIVITY_TYPE_LABELS[input.type].toLowerCase()}: ${input.subject}`,
      },
      tx,
    );
    await publish(tx, {
      name: CRM_EVENTS.ACTIVITY_LOGGED,
      actorId: actor.id,
      correlationId: actor.correlationId ?? null,
      payload: {
        activityId: activity.id,
        type: input.type,
        leadId: input.leadId,
        accountId,
        contactId: input.contactId,
        opportunityId: input.opportunityId,
      },
    });
    return activity;
  });

  return toActivityDto(created);
}

/** Marks a task done, or reopens it. */
export async function setTaskCompleted(
  actor: Actor,
  input: { activityId: string; completed: boolean },
): Promise<void> {
  if (!isUuid(input.activityId)) throw new NotFoundError("task");
  const task = await prisma.crmActivity.findFirst({
    where: { id: input.activityId, deletedAt: null },
    select: {
      type: true,
      subject: true,
      completedAt: true,
      createdBy: true,
      creator: { select: userRefSelect },
    },
  });
  if (task === null) throw new NotFoundError("task");
  const target = toScopeTarget(task.createdBy, task.creator);
  await assertCanRead(actor, CRM_PERMISSIONS.ACTIVITY_READ, target, "task");
  await requirePermission(actor, CRM_PERMISSIONS.ACTIVITY_UPDATE, target);
  if (task.type !== "TASK") throw new BusinessRuleError("Only tasks can be completed.");
  if ((task.completedAt !== null) === input.completed) return;

  await prisma.$transaction(async (tx) => {
    await tx.crmActivity.update({
      where: { id: input.activityId },
      data: { completedAt: input.completed ? new Date() : null, updatedBy: actor.id },
    });
    await recordAudit(
      {
        ...auditFields(actor),
        action: input.completed ? "crm.task.completed" : "crm.task.reopened",
        module: CRM_MODULE,
        entityType: "CrmActivity",
        entityId: input.activityId,
        summary: `${input.completed ? "Completed" : "Reopened"} task: ${task.subject}`,
      },
      tx,
    );
  });
}

/* -------------------------------------------------------------------------- */
/* Record access                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Asserts a CRM record exists and the actor may read it, returning the company it
 * belongs to (for linking). Out-of-scope records are reported as not found.
 */
async function assertRecordReadable(
  actor: Actor,
  record: Omit<RecordRef, "label">,
): Promise<{ accountId: string | null }> {
  if (!isUuid(record.id)) throw new NotFoundError("record");
  const owner = { ownerId: true, owner: { select: userRefSelect } } as const;

  switch (record.kind) {
    case "lead": {
      const row = await prisma.crmLead.findFirst({
        where: { id: record.id, deletedAt: null },
        select: { ...owner, convertedAccountId: true },
      });
      if (row === null) throw new NotFoundError("lead");
      await assertCanRead(
        actor,
        CRM_PERMISSIONS.LEAD_READ,
        toScopeTarget(row.ownerId, row.owner),
        "lead",
      );
      return { accountId: row.convertedAccountId };
    }
    case "account": {
      const row = await prisma.crmAccount.findFirst({
        where: { id: record.id, deletedAt: null },
        select: { ...owner, id: true },
      });
      if (row === null) throw new NotFoundError("company");
      await assertCanRead(
        actor,
        CRM_PERMISSIONS.ACCOUNT_READ,
        toScopeTarget(row.ownerId, row.owner),
        "company",
      );
      return { accountId: row.id };
    }
    case "contact": {
      const row = await prisma.crmContact.findFirst({
        where: { id: record.id, deletedAt: null },
        select: { ...owner, accountId: true },
      });
      if (row === null) throw new NotFoundError("contact");
      await assertCanRead(
        actor,
        CRM_PERMISSIONS.CONTACT_READ,
        toScopeTarget(row.ownerId, row.owner),
        "contact",
      );
      return { accountId: row.accountId };
    }
    case "opportunity": {
      const row = await prisma.crmOpportunity.findFirst({
        where: { id: record.id, deletedAt: null },
        select: { ...owner, accountId: true },
      });
      if (row === null) throw new NotFoundError("opportunity");
      await assertCanRead(
        actor,
        CRM_PERMISSIONS.OPPORTUNITY_READ,
        toScopeTarget(row.ownerId, row.owner),
        "opportunity",
      );
      return { accountId: row.accountId };
    }
  }
}
