import { ConflictError, NotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { diffForAudit, recordAudit } from "@/platform/audit/audit";
import { type Actor, requirePermission } from "@/platform/authz/authz";
import { INNOVATION_PERMISSIONS } from "../contracts/permissions";
import { categorySchema, categoryUpdateSchema } from "../contracts/schemas";
import type { CategoryDto, CategoryKind } from "../contracts/types";
import {
  INNOVATION_MODULE,
  assertId,
  auditFields,
  isUniqueViolation,
  parseInput,
} from "./support";

/** Idea and knowledge categories: rows administrators maintain. */

const categorySelect = {
  id: true,
  kind: true,
  name: true,
  isActive: true,
  sortOrder: true,
} as const;

export async function listCategories(
  actor: Actor,
  kind: CategoryKind,
  options: { includeArchived?: boolean } = {},
): Promise<CategoryDto[]> {
  await requirePermission(actor, INNOVATION_PERMISSIONS.ACCESS);
  return prisma.innovationCategory.findMany({
    where: { kind, ...(options.includeArchived === true ? {} : { isActive: true }) },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: categorySelect,
  });
}

export async function createCategory(
  actor: Actor,
  rawInput: unknown,
): Promise<CategoryDto> {
  await requirePermission(actor, INNOVATION_PERMISSIONS.CATEGORY_ADMINISTER);
  const input = parseInput(categorySchema, rawInput);

  try {
    return await prisma.$transaction(async (tx) => {
      const last = await tx.innovationCategory.aggregate({
        where: { kind: input.kind },
        _max: { sortOrder: true },
      });
      const category = await tx.innovationCategory.create({
        data: {
          kind: input.kind,
          name: input.name,
          sortOrder: (last._max.sortOrder ?? 0) + 1,
          createdBy: actor.id,
          updatedBy: actor.id,
        },
        select: categorySelect,
      });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "innovation.category.created",
          module: INNOVATION_MODULE,
          entityType: "InnovationCategory",
          entityId: category.id,
          summary: `Added ${input.kind === "IDEA" ? "idea" : "knowledge"} category: ${input.name}`,
        },
        tx,
      );
      return category;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicateName();
    throw error;
  }
}

export async function updateCategory(
  actor: Actor,
  categoryId: string,
  rawInput: unknown,
): Promise<void> {
  await requirePermission(actor, INNOVATION_PERMISSIONS.CATEGORY_ADMINISTER);
  assertId(categoryId, "category");
  const input = parseInput(categoryUpdateSchema, rawInput);

  const existing = await prisma.innovationCategory.findUnique({
    where: { id: categoryId },
    select: { name: true, isActive: true },
  });
  if (existing === null) throw new NotFoundError("category");

  const changes = diffForAudit(existing, input);
  if (Object.keys(changes).length === 0) return;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.innovationCategory.update({
        where: { id: categoryId },
        data: { name: input.name, isActive: input.isActive, updatedBy: actor.id },
      });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "innovation.category.updated",
          module: INNOVATION_MODULE,
          entityType: "InnovationCategory",
          entityId: categoryId,
          summary: `Updated category: ${input.name}`,
          changes,
        },
        tx,
      );
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicateName();
    throw error;
  }
}

function duplicateName() {
  return new ConflictError("A category with this name already exists.");
}
