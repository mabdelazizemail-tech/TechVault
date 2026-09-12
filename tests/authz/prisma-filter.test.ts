import { describe, expect, it } from "vitest";
import { scopeWhere } from "@/platform/authz/prisma-filter";
import type { ScopeFilter } from "@/platform/authz/types";

const MATCH_NOTHING = { id: "00000000-0000-0000-0000-000000000000" };

describe("scopeWhere", () => {
  const mapping = {
    orgUnitPath: ["orgUnit", "path"] as const,
    owner: ["createdBy"] as const,
  };

  it("adds no constraint for an unrestricted filter", () => {
    expect(scopeWhere({ kind: "all" }, mapping)).toEqual({});
  });

  it("produces an impossible predicate for 'none'", () => {
    // Critically, NOT an empty object: an empty `where` returns every row, which
    // would turn a denied user into an unrestricted one.
    expect(scopeWhere({ kind: "none" }, mapping)).toEqual(MATCH_NOTHING);
  });

  it("nests an org-unit prefix into the relation path", () => {
    const filter: ScopeFilter = {
      kind: "restricted",
      orgUnitPathPrefixes: ["/root/finance"],
      ownerId: null,
    };
    expect(scopeWhere(filter, mapping)).toEqual({
      orgUnit: { path: { startsWith: "/root/finance" } },
    });
  });

  it("combines several prefixes with OR", () => {
    const filter: ScopeFilter = {
      kind: "restricted",
      orgUnitPathPrefixes: ["/root/finance", "/root/hr"],
      ownerId: null,
    };
    expect(scopeWhere(filter, mapping)).toEqual({
      OR: [
        { orgUnit: { path: { startsWith: "/root/finance" } } },
        { orgUnit: { path: { startsWith: "/root/hr" } } },
      ],
    });
  });

  it("combines an org-unit prefix with an ownership alternative", () => {
    const filter: ScopeFilter = {
      kind: "restricted",
      orgUnitPathPrefixes: ["/root/finance"],
      ownerId: "user-1",
    };
    expect(scopeWhere(filter, mapping)).toEqual({
      OR: [
        { orgUnit: { path: { startsWith: "/root/finance" } } },
        { createdBy: "user-1" },
      ],
    });
  });

  it("fails closed when the model cannot express the restriction", () => {
    // A restricted filter against a model with no org-unit or owner field must
    // match nothing rather than everything.
    const filter: ScopeFilter = {
      kind: "restricted",
      orgUnitPathPrefixes: ["/root/finance"],
      ownerId: "user-1",
    };
    expect(scopeWhere(filter, {})).toEqual(MATCH_NOTHING);
  });

  it("ignores an owner alternative when the filter names no owner", () => {
    const filter: ScopeFilter = {
      kind: "restricted",
      orgUnitPathPrefixes: [],
      ownerId: null,
    };
    expect(scopeWhere(filter, mapping)).toEqual(MATCH_NOTHING);
  });
});
