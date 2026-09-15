import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { diffForAudit, recordAudit } from "@/platform/audit/audit";
import { type Actor, requireGlobalPermission } from "@/platform/authz/authz";
import { publish } from "@/platform/events/publish";
import { ERP_EVENTS } from "../../contracts/events";
import { ERP_PERMISSIONS } from "../../contracts/permissions";
import {
  costCentreCreateSchema,
  costCentreUpdateSchema,
  listParamsSchema,
} from "../../contracts/schemas";
import type { CostCentreListItem, CostCentreRef, Paginated } from "../../contracts/types";
import { costCentreListSelect, costCentreRefSelect } from "../../repositories/selects";
import {
  ERP_MODULE,
  asFinanceError,
  assertId,
  auditFields,
  isUniqueViolation,
  likePattern,
  parseInput,
  toCostCentreListItem,
} from "./support";

/**
 * Cost centres: an optional second dimension on journal lines, arranged as a tree.
 */

const TREE_PAGE_SIZE = 100;
const OPTION_LIMIT = 500;

export async function listCostCentres(
  actor: Actor,
  rawParams: Record<string, unknown> = {},
): Promise<Paginated<CostCentreListItem>> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.COST_CENTRE_READ);
  const params = listParamsSchema.parse(rawParams);
  const pattern =
    params.q === undefined || params.q === "" ? null : likePattern(params.q);
  const active = params.active === "all" ? null : params.active === "active";

  const hits = await prisma.$queryRaw<{ id: string; depth: number; total: bigint }[]>`
    WITH RECURSIVE tree AS (
      SELECT c.id, 0 AS depth, ARRAY[c.code]::text[] AS path
        FROM erp.cost_centres c
       WHERE c.parent_id IS NULL
      UNION ALL
      SELECT child.id, t.depth + 1, t.path || child.code
        FROM erp.cost_centres child
        JOIN tree t ON child.parent_id = t.id
    )
    SELECT t.id, t.depth, count(*) OVER () AS total
      FROM tree t
      JOIN erp.cost_centres c ON c.id = t.id
     WHERE (${pattern}::text IS NULL
            OR c.code ILIKE ${pattern} OR c.name ILIKE ${pattern} OR c.name_ar ILIKE ${pattern})
       AND (${active}::boolean IS NULL OR c.is_active = ${active})
     ORDER BY t.path
     LIMIT ${TREE_PAGE_SIZE} OFFSET ${(params.page - 1) * TREE_PAGE_SIZE}`;

  const rows =
    hits.length === 0
      ? []
      : await prisma.erpCostCentre.findMany({
          where: { id: { in: hits.map((hit) => hit.id) } },
          select: costCentreListSelect,
        });
  const byId = new Map(rows.map((row) => [row.id, row]));

  return {
    rows: hits.flatMap((hit) => {
      const row = byId.get(hit.id);
      return row === undefined ? [] : [toCostCentreListItem(row, hit.depth)];
    }),
    total: Number(hits[0]?.total ?? 0),
    page: params.page,
    pageSize: TREE_PAGE_SIZE,
  };
}

/** Active cost centres for a picker. */
export async function listCostCentreOptions(actor: Actor): Promise<CostCentreRef[]> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.COST_CENTRE_READ);
  return prisma.erpCostCentre.findMany({
    where: { isActive: true },
    orderBy: { code: "asc" },
    take: OPTION_LIMIT,
    select: costCentreRefSelect,
  });
}

async function assertParent(parentId: string | null, selfId?: string): Promise<void> {
  if (parentId === null) return;
  const invalid = (message: string) =>
    new ValidationError("Please correct the highlighted fields.", {
      parentId: [message],
    });
  if (parentId === selfId) throw invalid("A cost centre cannot be its own parent.");
  const parent = await prisma.erpCostCentre.findUnique({
    where: { id: parentId },
    select: { id: true },
  });
  if (parent === null) throw invalid("Choose a valid parent cost centre.");
}

export async function createCostCentre(
  actor: Actor,
  input: unknown,
): Promise<{ id: string }> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.COST_CENTRE_CREATE);
  const data = parseInput(costCentreCreateSchema, input);
  await assertParent(data.parentId);

  try {
    return await prisma.$transaction(async (tx) => {
      const centre = await tx.erpCostCentre.create({
        data: {
          code: data.code,
          name: data.name,
          nameAr: data.nameAr,
          parentId: data.parentId,
          createdBy: actor.id,
          updatedBy: actor.id,
        },
        select: { id: true },
      });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.cost_centre.created",
          module: ERP_MODULE,
          entityType: "cost_centre",
          entityId: centre.id,
          summary: `Created cost centre ${data.code} ${data.name}`,
          changes: { code: data.code, name: data.name, parentId: data.parentId },
        },
        tx,
      );
      await publish(tx, {
        name: ERP_EVENTS.COST_CENTRE_CREATED,
        actorId: actor.id,
        correlationId: actor.correlationId ?? null,
        payload: { costCentreId: centre.id, code: data.code },
      });
      return centre;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError("A cost centre with this code already exists.");
    }
    throw asFinanceError(error);
  }
}

export async function updateCostCentre(
  actor: Actor,
  costCentreId: string,
  input: unknown,
): Promise<{ id: string }> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.COST_CENTRE_UPDATE);
  assertId(costCentreId, "cost centre");
  const data = parseInput(costCentreUpdateSchema, input);

  const before = await prisma.erpCostCentre.findUnique({
    where: { id: costCentreId },
    select: { code: true, name: true, nameAr: true, parentId: true, isActive: true },
  });
  if (before === null) throw new NotFoundError("cost centre");
  await assertParent(data.parentId, costCentreId);

  const { code, ...current } = before;
  const changes = diffForAudit(current, data);
  if (Object.keys(changes).length === 0) return { id: costCentreId };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.erpCostCentre.update({
        where: { id: costCentreId },
        data: { ...data, updatedBy: actor.id },
      });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.cost_centre.updated",
          module: ERP_MODULE,
          entityType: "cost_centre",
          entityId: costCentreId,
          summary: `Updated cost centre ${code}`,
          changes,
        },
        tx,
      );
      await publish(tx, {
        name: ERP_EVENTS.COST_CENTRE_UPDATED,
        actorId: actor.id,
        correlationId: actor.correlationId ?? null,
        payload: { costCentreId, code, changedFields: Object.keys(changes) },
      });
    });
  } catch (error) {
    throw asFinanceError(error);
  }
  return { id: costCentreId };
}
