import { describe, expect, it } from "vitest";
import {
  PERMISSION_CATALOGUE,
  SECTION_ROLE_KEYS,
  SYSTEM_ROLE_DEFINITIONS,
} from "@/modules/catalogue";
import { NAV_SECTIONS, sectionLabelsForAccessKeys } from "@/components/shell/navigation";
import { CRM_PERMISSIONS } from "@/modules/crm/contracts/permissions";
import { INNOVATION_PERMISSIONS } from "@/modules/innovation/contracts/permissions";

/**
 * Section roles (ADR-030): ticking a role named after a section is what shows that
 * section, and the section roles never carry the authority of the job roles.
 */

const role = (key: string) => {
  const found = SYSTEM_ROLE_DEFINITIONS.find((definition) => definition.key === key);
  if (found === undefined) throw new Error(`missing role ${key}`);
  return found;
};
const catalogued = new Set(PERMISSION_CATALOGUE.map((permission) => permission.key));
const accessOf = (key: string) =>
  sectionLabelsForAccessKeys(
    role(key).permissions.filter((p) => p.endsWith(".module.access")),
  );

describe("system roles", () => {
  it("have unique keys and only catalogued permissions", () => {
    const keys = SYSTEM_ROLE_DEFINITIONS.map((definition) => definition.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const definition of SYSTEM_ROLE_DEFINITIONS) {
      for (const permission of definition.permissions) {
        expect(catalogued.has(permission), `${definition.key}: ${permission}`).toBe(true);
      }
    }
  });

  it("give every built section its own section role, named after it", () => {
    const built = NAV_SECTIONS.filter(
      (section) => section.key !== "admin" && catalogued.has(section.permission),
    );
    const sectionRoleLabels = SECTION_ROLE_KEYS.map((key) => role(key).name);
    expect(sectionRoleLabels).toEqual(built.map((section) => section.label));
    for (const key of SECTION_ROLE_KEYS) {
      expect(accessOf(key)).toEqual([role(key).name]);
    }
  });

  it("keep section roles free of anything that changes records that matter", () => {
    for (const key of SECTION_ROLE_KEYS) {
      for (const permission of role(key).permissions) {
        expect(
          /\.(delete|post|reverse|approve|cancel|allocate|close|reopen|administer)$/.test(
            permission,
          ),
          `${key}: ${permission}`,
        ).toBe(false);
      }
    }
    expect(role("crm-user").permissions).not.toContain(CRM_PERMISSIONS.LEAD_CREATE);
    expect(role("crm-user").permissions).not.toContain(
      CRM_PERMISSIONS.OPPORTUNITY_UPDATE,
    );
    expect(role("crm-user").permissions).toContain(CRM_PERMISSIONS.ACTIVITY_CREATE);
    const erpKeys = role("erp-user").permissions.filter((p) => p.startsWith("erp."));
    expect(erpKeys.every((p) => /\.(read|access)$/.test(p))).toBe(true);
  });

  it("no longer show The Think Tank through employee or sales", () => {
    for (const key of ["employee", "sales"]) {
      expect(role(key).permissions).not.toContain(INNOVATION_PERMISSIONS.ACCESS);
    }
    expect(accessOf("employee")).toEqual([]);
    expect(accessOf("sales")).toEqual(["CRM"]);
  });
});
