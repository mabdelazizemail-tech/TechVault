import { describe, expect, it } from "vitest";
import {
  CRM_DELETE_PERMISSIONS,
  CRM_PERMISSIONS,
  CRM_PERMISSION_DEFINITIONS,
  CRM_SALES_PERMISSIONS,
} from "@/modules/crm/contracts/permissions";
import { deletionTargetSchema } from "@/modules/crm/contracts/schemas";
import { describeAlsoDeleted } from "@/modules/crm/ui/format";

/** Deleting CRM records is for administrators only (ADR-024). */

describe("CRM delete permissions", () => {
  it("names the five delete permissions", () => {
    expect(CRM_DELETE_PERMISSIONS).toEqual([
      CRM_PERMISSIONS.LEAD_DELETE,
      CRM_PERMISSIONS.ACCOUNT_DELETE,
      CRM_PERMISSIONS.CONTACT_DELETE,
      CRM_PERMISSIONS.OPPORTUNITY_DELETE,
      CRM_PERMISSIONS.ACTIVITY_DELETE,
    ]);
  });

  it("keeps every delete permission away from the Sales role", () => {
    for (const key of CRM_DELETE_PERMISSIONS) {
      expect(CRM_SALES_PERMISSIONS, key).not.toContain(key);
    }
    expect(CRM_SALES_PERMISSIONS).toContain(CRM_PERMISSIONS.LEAD_UPDATE);
    expect(CRM_SALES_PERMISSIONS).toContain(CRM_PERMISSIONS.ACTIVITY_CREATE);
  });

  it("catalogues them, so platform-admin — which holds the whole catalogue — has them", () => {
    const catalogued = CRM_PERMISSION_DEFINITIONS.map((definition) => definition.key);
    for (const key of CRM_DELETE_PERMISSIONS) expect(catalogued, key).toContain(key);
  });
});

describe("deletion confirmation text", () => {
  it("lists what goes with the record", () => {
    expect(describeAlsoDeleted({ contacts: 3, opportunities: 2, activities: 41 })).toBe(
      "This also deletes 3 contacts, 2 opportunities and 41 activities.",
    );
    expect(describeAlsoDeleted({ contacts: 1, opportunities: 0, activities: 1 })).toBe(
      "This also deletes 1 contact and 1 activity.",
    );
    expect(describeAlsoDeleted({ contacts: 0, opportunities: 1, activities: 0 })).toBe(
      "This also deletes 1 opportunity.",
    );
    expect(describeAlsoDeleted({ contacts: 0, opportunities: 0, activities: 0 })).toBe(
      "Nothing else is deleted with it.",
    );
  });
});

describe("deletion target", () => {
  it("accepts the four record kinds and nothing else", () => {
    for (const kind of ["lead", "account", "contact", "opportunity"]) {
      expect(deletionTargetSchema.safeParse({ kind, id: "x" }).success, kind).toBe(true);
    }
    expect(deletionTargetSchema.safeParse({ kind: "stage", id: "x" }).success).toBe(
      false,
    );
    expect(deletionTargetSchema.safeParse({ kind: "lead" }).success).toBe(false);
  });
});
