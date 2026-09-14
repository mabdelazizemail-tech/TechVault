import type { Prisma } from "@prisma/client";
import { BusinessRuleError } from "@/lib/errors";
import type { PrismaTransaction } from "@/lib/prisma";
import { SYSTEM_ROLES } from "@/platform/iam/permissions";

/**
 * Keeps at least one active platform administrator in the system (ADR-019).
 *
 * Any change that can take platform administration away from someone —
 * deactivating, deleting, or removing the `platform-admin` role — calls
 * `lockAdministration` and then `assertAdministrationRemains` inside its
 * transaction. The advisory lock serialises those changes, so two
 * administrators cannot remove each other at the same moment and leave nobody.
 */

export const LAST_ADMIN_MESSAGE =
  "This action is not allowed because at least one active platform administrator " +
  "must remain in the system.";

export async function lockAdministration(tx: PrismaTransaction): Promise<void> {
  // $executeRaw, not $queryRaw: the lock function returns `void`, which the driver
  // adapter cannot read back as a value.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('iam.platform-admin'))`;
}

/** An active, undeleted user holding an unscoped, currently valid platform-admin role. */
function platformAdministrators(now: Date): Prisma.UserWhereInput {
  return {
    isActive: true,
    deletedAt: null,
    roles: {
      some: {
        scopeType: "GLOBAL",
        role: { key: SYSTEM_ROLES.PLATFORM_ADMIN, isActive: true, deletedAt: null },
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        ],
      },
    },
  };
}

/**
 * Throws when `userId` is a platform administrator and nobody else is. Call it
 * after `lockAdministration`, before the change that removes their access.
 */
export async function assertAdministrationRemains(
  tx: PrismaTransaction,
  userId: string,
): Promise<void> {
  const now = new Date();
  const isAdministrator = await tx.user.count({
    where: { id: userId, ...platformAdministrators(now) },
  });
  if (isAdministrator === 0) return;

  const others = await tx.user.count({
    where: { id: { not: userId }, ...platformAdministrators(now) },
  });
  if (others === 0) throw new BusinessRuleError(LAST_ADMIN_MESSAGE);
}
