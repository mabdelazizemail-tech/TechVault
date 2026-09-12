import { describe, expect, it } from "vitest";
import { PERMISSION_CATALOGUE, findDuplicatePermissionKeys } from "@/modules/catalogue";
import { navigationPermissionKeys, NAV_SECTIONS } from "@/components/shell/navigation";

/**
 * Structural guards on the permission catalogue.
 *
 * These catch the class of mistake that is invisible until somebody cannot do
 * their job: a typo'd permission key, a duplicate claim, or a navigation entry
 * gated by a permission that does not exist.
 */

describe("permission catalogue", () => {
  it("is not empty", () => {
    expect(PERMISSION_CATALOGUE.length).toBeGreaterThan(0);
  });

  it("has no duplicate keys", () => {
    expect(findDuplicatePermissionKeys()).toEqual([]);
  });

  it("uses the module.resource.action shape for every key", () => {
    for (const permission of PERMISSION_CATALOGUE) {
      expect(permission.key, `malformed key: ${permission.key}`).toMatch(
        /^[a-z0-9_]+\.[a-z0-9_]+\.[a-z0-9_]+$/,
      );
    }
  });

  it("keeps the key consistent with its module, resource and action fields", () => {
    for (const permission of PERMISSION_CATALOGUE) {
      expect(permission.key).toBe(
        `${permission.module}.${permission.resource}.${permission.action.toLowerCase()}`,
      );
    }
  });

  it("gives every permission a description, since administrators grant by reading them", () => {
    for (const permission of PERMISSION_CATALOGUE) {
      expect(permission.description.length, permission.key).toBeGreaterThan(10);
    }
  });

  it("marks the permissions that confer control over access as sensitive", () => {
    const administerUsers = PERMISSION_CATALOGUE.find(
      (permission) => permission.key === "iam.user.administer",
    );
    expect(administerUsers?.isSensitive).toBe(true);
  });
});

describe("navigation", () => {
  it("gates every section and item on a permission", () => {
    for (const section of NAV_SECTIONS) {
      expect(section.permission).not.toBe("");
      for (const item of section.items) {
        expect(item.permission, `${section.key}/${item.label}`).not.toBe("");
      }
    }
  });

  it("collects each permission key exactly once", () => {
    const keys = navigationPermissionKeys();
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("uses absolute hrefs so links work from any depth", () => {
    for (const section of NAV_SECTIONS) {
      for (const item of section.items) {
        expect(item.href.startsWith("/"), item.href).toBe(true);
      }
    }
  });

  it("only references catalogued permissions for modules that are built", () => {
    // Unbuilt modules intentionally reference permissions that do not exist yet,
    // so their navigation never renders. The administration section, however, is
    // live — every permission it names must be grantable today.
    const catalogued = new Set(PERMISSION_CATALOGUE.map((p) => p.key));
    const admin = NAV_SECTIONS.find((section) => section.key === "admin");

    expect(admin).toBeDefined();
    expect(catalogued.has(admin?.permission ?? "")).toBe(true);
    for (const item of admin?.items ?? []) {
      expect(catalogued.has(item.permission), item.permission).toBe(true);
    }
  });
});
