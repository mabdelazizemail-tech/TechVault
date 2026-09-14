import { BusinessRuleError, ConflictError, NotFoundError } from "@/lib/errors";
import { prisma, type PrismaTransaction } from "@/lib/prisma";
import { recordAudit } from "@/platform/audit/audit";
import { type Actor, requirePermission } from "@/platform/authz/authz";
import { publish } from "@/platform/events/publish";
import { ERP_EVENTS, type PeriodClosedPayload } from "../../contracts/events";
import { ERP_PERMISSIONS } from "../../contracts/permissions";
import {
  listParamsSchema,
  periodCreateSchema,
  periodReopenSchema,
} from "../../contracts/schemas";
import type { Paginated, PeriodDto } from "../../contracts/types";
import { periodSelect } from "../../repositories/selects";
import {
  ERP_MODULE,
  asFinanceError,
  assertId,
  auditFields,
  dateFromIso,
  isUniqueViolation,
  parseInput,
  toPeriodDto,
} from "./support";

/**
 * Accounting periods. Periods never overlap; posting needs the open period that
 * contains the entry date; closing stops posting; reopening is a separate, more
 * tightly held permission and is audited at CRITICAL severity with a reason.
 */

const PAGE_SIZE = 24;

export async function listPeriods(
  actor: Actor,
  rawParams: Record<string, unknown> = {},
): Promise<Paginated<PeriodDto>> {
  await requirePermission(actor, ERP_PERMISSIONS.PERIOD_READ);
  const params = listParamsSchema.parse(rawParams);

  const [total, rows] = await Promise.all([
    prisma.erpFiscalPeriod.count(),
    prisma.erpFiscalPeriod.findMany({
      orderBy: { startDate: "desc" },
      skip: (params.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: periodSelect,
    }),
  ]);

  return { rows: rows.map(toPeriodDto), total, page: params.page, pageSize: PAGE_SIZE };
}

export async function createPeriod(
  actor: Actor,
  input: unknown,
): Promise<{ id: string }> {
  await requirePermission(actor, ERP_PERMISSIONS.PERIOD_CREATE);
  const data = parseInput(periodCreateSchema, input);
  const start = dateFromIso(data.startDate);
  const end = dateFromIso(data.endDate);

  const overlap = await prisma.erpFiscalPeriod.findFirst({
    where: { startDate: { lte: end }, endDate: { gte: start } },
    select: { name: true },
  });
  if (overlap !== null) {
    throw new ConflictError(`These dates overlap the period ${overlap.name}.`);
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const period = await tx.erpFiscalPeriod.create({
        data: {
          name: data.name,
          startDate: start,
          endDate: end,
          createdBy: actor.id,
          updatedBy: actor.id,
        },
        select: { id: true },
      });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.period.created",
          module: ERP_MODULE,
          entityType: "fiscal_period",
          entityId: period.id,
          summary: `Created accounting period ${data.name} (${data.startDate} to ${data.endDate})`,
          changes: { name: data.name, startDate: data.startDate, endDate: data.endDate },
        },
        tx,
      );
      await publish(tx, {
        name: ERP_EVENTS.PERIOD_CREATED,
        actorId: actor.id,
        correlationId: actor.correlationId ?? null,
        payload: {
          fiscalPeriodId: period.id,
          name: data.name,
          startDate: data.startDate,
          endDate: data.endDate,
        },
      });
      return period;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError("A period with this name already exists.");
    }
    throw asFinanceError(error);
  }
}

type LockedPeriod = {
  id: string;
  name: string;
  status: "OPEN" | "CLOSED";
  startDate: string;
  endDate: string;
};

/** Locks the period for the transaction: a close and a posting cannot interleave. */
async function lockPeriod(
  tx: PrismaTransaction,
  periodId: string,
): Promise<LockedPeriod> {
  const rows = await tx.$queryRaw<
    {
      id: string;
      name: string;
      status: "OPEN" | "CLOSED";
      start_date: string;
      end_date: string;
    }[]
  >`
    SELECT id, name, status::text AS status,
           start_date::text AS start_date, end_date::text AS end_date
      FROM erp.fiscal_periods
     WHERE id = ${periodId}::uuid
       FOR UPDATE`;
  const row = rows[0];
  if (row === undefined) throw new NotFoundError("accounting period");
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    startDate: row.start_date,
    endDate: row.end_date,
  };
}

export async function closePeriod(actor: Actor, periodId: string): Promise<void> {
  await requirePermission(actor, ERP_PERMISSIONS.PERIOD_CLOSE);
  assertId(periodId, "accounting period");

  try {
    await prisma.$transaction(async (tx) => {
      const period = await lockPeriod(tx, periodId);
      if (period.status === "CLOSED") {
        throw new BusinessRuleError(`The period ${period.name} is already closed.`);
      }

      // A draft dated inside a closed period could never be posted; resolve it first.
      const drafts = await tx.erpJournalEntry.count({
        where: {
          status: "DRAFT",
          entryDate: {
            gte: dateFromIso(period.startDate),
            lte: dateFromIso(period.endDate),
          },
        },
      });
      if (drafts > 0) {
        throw new BusinessRuleError(
          `${drafts} draft journal ${drafts === 1 ? "entry is" : "entries are"} dated in ${period.name}. Post or delete ${drafts === 1 ? "it" : "them"} before closing the period.`,
        );
      }

      await tx.erpFiscalPeriod.update({
        where: { id: periodId },
        data: {
          status: "CLOSED",
          closedAt: new Date(),
          closedBy: actor.id,
          updatedBy: actor.id,
        },
      });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.period.closed",
          module: ERP_MODULE,
          entityType: "fiscal_period",
          entityId: periodId,
          summary: `Closed accounting period ${period.name}`,
          changes: { status: { from: "OPEN", to: "CLOSED" } },
          severity: "NOTICE",
        },
        tx,
      );
      await publish(tx, {
        name: ERP_EVENTS.PERIOD_CLOSED,
        actorId: actor.id,
        correlationId: actor.correlationId ?? null,
        payload: {
          fiscalPeriodId: periodId,
          name: period.name,
          startDate: period.startDate,
          endDate: period.endDate,
        } satisfies PeriodClosedPayload,
      });
    });
  } catch (error) {
    throw asFinanceError(error);
  }
}

export async function reopenPeriod(
  actor: Actor,
  periodId: string,
  input: unknown,
): Promise<void> {
  await requirePermission(actor, ERP_PERMISSIONS.PERIOD_REOPEN);
  assertId(periodId, "accounting period");
  const { reason } = parseInput(periodReopenSchema, input);

  try {
    await prisma.$transaction(async (tx) => {
      const period = await lockPeriod(tx, periodId);
      if (period.status === "OPEN") {
        throw new BusinessRuleError(`The period ${period.name} is already open.`);
      }

      await tx.erpFiscalPeriod.update({
        where: { id: periodId },
        data: {
          status: "OPEN",
          closedAt: null,
          closedBy: null,
          reopenedAt: new Date(),
          reopenedBy: actor.id,
          updatedBy: actor.id,
        },
      });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.period.reopened",
          module: ERP_MODULE,
          entityType: "fiscal_period",
          entityId: periodId,
          summary: `Reopened accounting period ${period.name}`,
          changes: { status: { from: "CLOSED", to: "OPEN" }, reason },
          severity: "CRITICAL",
        },
        tx,
      );
      await publish(tx, {
        name: ERP_EVENTS.PERIOD_REOPENED,
        actorId: actor.id,
        correlationId: actor.correlationId ?? null,
        payload: {
          fiscalPeriodId: periodId,
          name: period.name,
          startDate: period.startDate,
          endDate: period.endDate,
        },
      });
    });
  } catch (error) {
    throw asFinanceError(error);
  }
}
