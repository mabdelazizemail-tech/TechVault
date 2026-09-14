import type { PermissionDefinition } from "@/platform/authz/types";
import {
  IAM_PERMISSION_DEFINITIONS,
  PLATFORM_PERMISSION_DEFINITIONS,
} from "@/platform/iam/permissions";
import { CRM_PERMISSION_DEFINITIONS } from "@/modules/crm/contracts/permissions";

/**
 * The permission composition root.
 *
 * Platform services must not import domain modules (enforced by the lint boundary
 * in eslint.config.mjs), but something has to assemble the union of every
 * module's declared permissions for seeding and for the admin catalogue screen.
 * That composition happens HERE — deliberately outside any single module, and
 * outside platform/.
 *
 * When a module ships, import its `contracts/permissions.ts` definitions and add
 * them to the array below. That one line is what makes the module's permissions
 * grantable and its navigation section appear.
 */
export const PERMISSION_CATALOGUE: readonly PermissionDefinition[] = [
  ...IAM_PERMISSION_DEFINITIONS,
  ...PLATFORM_PERMISSION_DEFINITIONS,
  // Phase 3: ...ECM_PERMISSION_DEFINITIONS,
  ...CRM_PERMISSION_DEFINITIONS,
  // Phase 6: ...ERP_PERMISSION_DEFINITIONS,
  // Phase 7: ...HRIS_PERMISSION_DEFINITIONS,
  // Phase 8: ...INNOVATION_PERMISSION_DEFINITIONS,
  // Phase 9: ...BI_PERMISSION_DEFINITIONS,
];

/** Guards against two modules claiming the same permission key. */
export function findDuplicatePermissionKeys(): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const permission of PERMISSION_CATALOGUE) {
    if (seen.has(permission.key)) duplicates.add(permission.key);
    seen.add(permission.key);
  }

  return [...duplicates];
}
