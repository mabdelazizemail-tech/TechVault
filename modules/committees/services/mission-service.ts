import { ConflictError, NotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { diffForAudit, recordAudit } from "@/platform/audit/audit";
import {
  type Actor,
  requireGlobalPermission,
  requirePermission,
} from "@/platform/authz/authz";
import { COMMITTEES_PERMISSIONS } from "../contracts/permissions";
import { missionSchema } from "../contracts/schemas";
import {
  PAGE_SIZE,
  type MissionDto,
  type MissionOption,
  type Paginated,
} from "../contracts/types";
import {
  COMMITTEES_MODULE,
  assertId,
  auditFields,
  isUniqueViolation,
  parseInput,
} from "./support";

/**
 * Missions — the trips and visits expenses are claimed against (ADR-037). Anyone
 * who may see expenses may list them; adding, editing and deactivating needs
 * `committees.mission.administer`, organisation-wide. A mission is never deleted:
 * its expenses are its record, so it is deactivated and stops being offered.
 */

const DUPLICATE_NAME = "Another mission already has this name.";

/** Missions to choose from: the active ones, or every one for a filter. */
export async function listMissionOptions(
  actor: Actor,
  options: { includeInactive?: boolean } = {},
): Promise<MissionOption[]> {
  await requirePermission(actor, COMMITTEES_PERMISSIONS.EXPENSE_READ);
  return prisma.committeeMission.findMany({
    where: options.includeInactive === true ? {} : { isActive: true },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    take: 300,
    select: { id: true, name: true, defaultCurrency: true },
  });
}

export async function listMissions(
  actor: Actor,
  params: { page?: number; show?: "active" | "inactive"; q?: string } = {},
): Promise<Paginated<MissionDto>> {
  await requireGlobalPermission(actor, COMMITTEES_PERMISSIONS.MISSION_ADMINISTER);
  const page =
    Number.isInteger(params.page) && (params.page ?? 0) > 0 ? (params.page ?? 1) : 1;
  const query = params.q?.trim() ?? "";
  const where = {
    isActive: params.show !== "inactive",
    ...(query !== "" ? { name: { contains: query, mode: "insensitive" as const } } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.committeeMission.count({ where }),
    prisma.committeeMission.findMany({
      where,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        name: true,
        description: true,
        defaultCurrency: true,
        isActive: true,
        _count: { select: { expenses: true } },
      },
    }),
  ]);
  return {
    rows: rows.map(({ _count, ...mission }) => ({
      ...mission,
      expenseCount: _count.expenses,
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
  };
}

export async function createMission(
  actor: Actor,
  rawInput: unknown,
): Promise<{ id: string }> {
  await requireGlobalPermission(actor, COMMITTEES_PERMISSIONS.MISSION_ADMINISTER);
  const input = parseInput(missionSchema, rawInput);
  try {
    return await prisma.$transaction(async (tx) => {
      const mission = await tx.committeeMission.create({
        data: { ...input, createdBy: actor.id, updatedBy: actor.id },
        select: { id: true },
      });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "committees.mission.created",
          module: COMMITTEES_MODULE,
          entityType: "CommitteeMission",
          entityId: mission.id,
          summary: `Added mission: ${input.name}`,
        },
        tx,
      );
      return mission;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError(DUPLICATE_NAME);
    throw error;
  }
}

export async function updateMission(
  actor: Actor,
  missionId: string,
  rawInput: unknown,
): Promise<void> {
  await requireGlobalPermission(actor, COMMITTEES_PERMISSIONS.MISSION_ADMINISTER);
  assertId(missionId, "mission");
  const existing = await prisma.committeeMission.findUnique({
    where: { id: missionId },
    select: { name: true, description: true, defaultCurrency: true, isActive: true },
  });
  if (existing === null) throw new NotFoundError("mission");
  const input = parseInput(missionSchema, rawInput);
  const changes = diffForAudit(existing, input);
  if (Object.keys(changes).length === 0) return;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.committeeMission.update({
        where: { id: missionId },
        data: { ...input, updatedBy: actor.id },
      });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "committees.mission.updated",
          module: COMMITTEES_MODULE,
          entityType: "CommitteeMission",
          entityId: missionId,
          summary:
            existing.isActive && !input.isActive
              ? `Deactivated mission: ${input.name}`
              : `Edited mission: ${input.name}`,
          changes,
        },
        tx,
      );
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError(DUPLICATE_NAME);
    throw error;
  }
}
