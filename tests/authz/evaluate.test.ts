import { describe, expect, it } from "vitest";
import {
  describeDenial,
  evaluate,
  isWithinSubtree,
  scopeFilterFor,
} from "@/platform/authz/evaluate";
import type {
  PermissionSet,
  Principal,
  ResolvedGrant,
  ScopeType,
} from "@/platform/authz/types";

/**
 * The authorization suite (CLAUDE.md §20).
 *
 * Every protected behaviour is asserted from BOTH directions: the permitted actor
 * succeeds and the unpermitted actor is refused. A security change without a
 * negative test is not done.
 */

const PERMISSION = "crm.account.read";

function principal(overrides: Partial<Principal> = {}): Principal {
  return {
    id: "user-1",
    type: "USER",
    isActive: true,
    orgUnitId: "unit-finance",
    orgUnitPath: "/root/finance",
    ...overrides,
  };
}

function grant(overrides: Partial<ResolvedGrant> = {}): ResolvedGrant {
  return {
    permissionKey: PERMISSION,
    effect: "ALLOW",
    scopeType: "GLOBAL",
    scopeOrgUnitId: null,
    scopeOrgUnitPath: null,
    startsAt: null,
    endsAt: null,
    source: "ROLE",
    sourceLabel: "test-role",
    ...overrides,
  };
}

function setOf(grants: ResolvedGrant[], p: Principal = principal()): PermissionSet {
  return { principal: p, grants };
}

describe("evaluate — the basics", () => {
  it("allows a global grant", () => {
    const decision = evaluate(setOf([grant()]), PERMISSION, { orgUnitPath: "/root/hr" });
    expect(decision.allowed).toBe(true);
  });

  it("denies when no grant exists for the permission", () => {
    const decision = evaluate(setOf([]), PERMISSION);
    expect(decision).toEqual({ allowed: false, reason: "NO_GRANT" });
  });

  it("denies every permission to an inactive principal, even with a global grant", () => {
    const decision = evaluate(
      setOf([grant()], principal({ isActive: false })),
      PERMISSION,
    );
    expect(decision).toEqual({ allowed: false, reason: "PRINCIPAL_INACTIVE" });
  });

  it("does not treat a grant for one permission as a grant for another", () => {
    const decision = evaluate(
      setOf([grant({ permissionKey: "crm.account.update" })]),
      PERMISSION,
    );
    expect(decision.allowed).toBe(false);
  });

  it("does not let ADMINISTER imply other actions", () => {
    // There is deliberately no implication between actions: admin roles are
    // seeded with every permission explicitly (see evaluate.ts).
    const decision = evaluate(
      setOf([grant({ permissionKey: "crm.account.administer" })]),
      PERMISSION,
    );
    expect(decision.allowed).toBe(false);
  });
});

describe("evaluate — DENY precedence", () => {
  it("lets an explicit DENY override an ALLOW from a role", () => {
    const decision = evaluate(
      setOf([grant(), grant({ effect: "DENY", source: "DIRECT" })]),
      PERMISSION,
    );
    expect(decision).toEqual({ allowed: false, reason: "EXPLICIT_DENY" });
  });

  it("applies DENY regardless of the order the grants arrive in", () => {
    const decision = evaluate(
      setOf([grant({ effect: "DENY", source: "DIRECT" }), grant()]),
      PERMISSION,
    );
    expect(decision.allowed).toBe(false);
  });

  it("ignores a DENY that does not apply to the target's scope", () => {
    const decision = evaluate(
      setOf([
        grant(),
        grant({
          effect: "DENY",
          scopeType: "ORG_UNIT",
          scopeOrgUnitPath: "/root/hr",
          source: "DIRECT",
        }),
      ]),
      PERMISSION,
      { orgUnitPath: "/root/finance" },
    );
    expect(decision.allowed).toBe(true);
  });
});

describe("evaluate — validity windows", () => {
  const now = new Date("2026-06-15T12:00:00Z");

  it("refuses a grant that has not started", () => {
    const decision = evaluate(
      setOf([grant({ startsAt: new Date("2026-07-01T00:00:00Z") })]),
      PERMISSION,
      undefined,
      now,
    );
    expect(decision).toEqual({ allowed: false, reason: "GRANT_NOT_YET_VALID" });
  });

  it("refuses a grant that has expired", () => {
    const decision = evaluate(
      setOf([grant({ endsAt: new Date("2026-06-01T00:00:00Z") })]),
      PERMISSION,
      undefined,
      now,
    );
    expect(decision).toEqual({ allowed: false, reason: "GRANT_EXPIRED" });
  });

  it("accepts a grant inside its window", () => {
    const decision = evaluate(
      setOf([
        grant({
          startsAt: new Date("2026-06-01T00:00:00Z"),
          endsAt: new Date("2026-07-01T00:00:00Z"),
        }),
      ]),
      PERMISSION,
      undefined,
      now,
    );
    expect(decision.allowed).toBe(true);
  });

  it("treats the end of the window as exclusive", () => {
    const decision = evaluate(
      setOf([grant({ endsAt: now })]),
      PERMISSION,
      undefined,
      now,
    );
    expect(decision.allowed).toBe(false);
  });
});

describe("evaluate — scope", () => {
  it("allows an ORG_UNIT grant for a resource inside that subtree", () => {
    const decision = evaluate(
      setOf([grant({ scopeType: "ORG_UNIT", scopeOrgUnitPath: "/root/finance" })]),
      PERMISSION,
      { orgUnitPath: "/root/finance/accounts-payable" },
    );
    expect(decision.allowed).toBe(true);
  });

  it("refuses an ORG_UNIT grant for a resource outside that subtree", () => {
    const decision = evaluate(
      setOf([grant({ scopeType: "ORG_UNIT", scopeOrgUnitPath: "/root/finance" })]),
      PERMISSION,
      { orgUnitPath: "/root/hr" },
    );
    expect(decision).toEqual({ allowed: false, reason: "OUT_OF_SCOPE" });
  });

  it("does not let a path prefix match a sibling with a longer name", () => {
    // "/root/fin" must not grant access to "/root/finance" — this would silently
    // widen access, which is the worst kind of authorization bug.
    const decision = evaluate(
      setOf([grant({ scopeType: "ORG_UNIT", scopeOrgUnitPath: "/root/fin" })]),
      PERMISSION,
      { orgUnitPath: "/root/finance" },
    );
    expect(decision.allowed).toBe(false);
  });

  it("resolves OWN_ORG_UNIT against the principal's own unit", () => {
    const allowed = evaluate(setOf([grant({ scopeType: "OWN_ORG_UNIT" })]), PERMISSION, {
      orgUnitPath: "/root/finance/treasury",
    });
    const refused = evaluate(setOf([grant({ scopeType: "OWN_ORG_UNIT" })]), PERMISSION, {
      orgUnitPath: "/root/hr",
    });
    expect(allowed.allowed).toBe(true);
    expect(refused.allowed).toBe(false);
  });

  it("refuses OWN_ORG_UNIT when the principal has no unit", () => {
    const decision = evaluate(
      setOf([grant({ scopeType: "OWN_ORG_UNIT" })], principal({ orgUnitPath: null })),
      PERMISSION,
      { orgUnitPath: "/root/finance" },
    );
    expect(decision.allowed).toBe(false);
  });

  it("allows OWN scope only for the principal's own records", () => {
    const own = evaluate(setOf([grant({ scopeType: "OWN" })]), PERMISSION, {
      ownerId: "user-1",
    });
    const other = evaluate(setOf([grant({ scopeType: "OWN" })]), PERMISSION, {
      ownerId: "user-2",
    });
    expect(own.allowed).toBe(true);
    expect(other.allowed).toBe(false);
  });

  it("refuses OWN scope when the target names no owner", () => {
    const decision = evaluate(setOf([grant({ scopeType: "OWN" })]), PERMISSION, {
      orgUnitPath: "/root/finance",
    });
    expect(decision.allowed).toBe(false);
  });

  it("treats a missing target as 'could you ever do this', which scoped grants satisfy", () => {
    // This is what navigation gating asks. Authorising a real operation must pass
    // a target — otherwise an OWN-scoped user would pass a check for another
    // user's record.
    const decision = evaluate(setOf([grant({ scopeType: "OWN" })]), PERMISSION);
    expect(decision.allowed).toBe(true);
  });
});

describe("isWithinSubtree", () => {
  it.each([
    ["/root/finance", "/root/finance", true],
    ["/root/finance/ap", "/root/finance", true],
    ["/root/finance", "/root/finance/ap", false],
    ["/root/finance", "/root/fin", false],
    ["/root/hr", "/root/finance", false],
    [null, "/root", false],
    [undefined, "/root", false],
  ])("isWithinSubtree(%s, %s) === %s", (target, ancestor, expected) => {
    expect(isWithinSubtree(target as string | null | undefined, ancestor)).toBe(expected);
  });

  it("handles an ancestor path with a trailing separator", () => {
    expect(isWithinSubtree("/root/finance/ap", "/root/finance/")).toBe(true);
  });
});

describe("scopeFilterFor", () => {
  it("returns 'all' for a global grant", () => {
    expect(scopeFilterFor(setOf([grant()]), PERMISSION)).toEqual({ kind: "all" });
  });

  it("returns 'none' when the permission is not held", () => {
    expect(scopeFilterFor(setOf([]), PERMISSION)).toEqual({ kind: "none" });
  });

  it("returns 'none' for an inactive principal", () => {
    expect(
      scopeFilterFor(setOf([grant()], principal({ isActive: false })), PERMISSION),
    ).toEqual({ kind: "none" });
  });

  it("returns 'none' when a global DENY removes the permission", () => {
    expect(
      scopeFilterFor(setOf([grant(), grant({ effect: "DENY" })]), PERMISSION),
    ).toEqual({ kind: "none" });
  });

  it("collects org-unit prefixes from scoped grants", () => {
    const filter = scopeFilterFor(
      setOf([
        grant({ scopeType: "ORG_UNIT", scopeOrgUnitPath: "/root/finance" }),
        grant({ scopeType: "ORG_UNIT", scopeOrgUnitPath: "/root/hr" }),
      ]),
      PERMISSION,
    );
    expect(filter).toEqual({
      kind: "restricted",
      orgUnitPathPrefixes: ["/root/finance", "/root/hr"],
      ownerId: null,
    });
  });

  it("includes the principal's own unit for OWN_ORG_UNIT", () => {
    const filter = scopeFilterFor(
      setOf([grant({ scopeType: "OWN_ORG_UNIT" })]),
      PERMISSION,
    );
    expect(filter).toEqual({
      kind: "restricted",
      orgUnitPathPrefixes: ["/root/finance"],
      ownerId: null,
    });
  });

  it("sets ownerId for OWN scope", () => {
    const filter = scopeFilterFor(setOf([grant({ scopeType: "OWN" })]), PERMISSION);
    expect(filter).toEqual({
      kind: "restricted",
      orgUnitPathPrefixes: [],
      ownerId: "user-1",
    });
  });

  it("excludes expired grants", () => {
    const filter = scopeFilterFor(
      setOf([grant({ endsAt: new Date("2020-01-01T00:00:00Z") })]),
      PERMISSION,
    );
    expect(filter).toEqual({ kind: "none" });
  });
});

describe("describeDenial", () => {
  it("gives the same message for every reason that could reveal existence", () => {
    // NO_GRANT, OUT_OF_SCOPE and EXPLICIT_DENY must be indistinguishable to the
    // user, or the message itself discloses information (§11.6).
    const messages = new Set(
      (["NO_GRANT", "OUT_OF_SCOPE", "EXPLICIT_DENY"] as const).map(describeDenial),
    );
    expect(messages.size).toBe(1);
  });

  it("explains a timing problem, which is safe and actionable", () => {
    expect(describeDenial("GRANT_EXPIRED")).toMatch(/expired/i);
    expect(describeDenial("GRANT_NOT_YET_VALID")).toMatch(/start/i);
  });
});

describe("grant sources", () => {
  it.each<ResolvedGrant["source"]>(["ROLE", "GROUP", "DIRECT", "DELEGATION"])(
    "honours an ALLOW from a %s grant",
    (source) => {
      const decision = evaluate(setOf([grant({ source })]), PERMISSION);
      expect(decision.allowed).toBe(true);
    },
  );

  it("reports which grant permitted the action, for the access-review screen", () => {
    const decision = evaluate(
      setOf([grant({ source: "GROUP", sourceLabel: "finance-team:approver" })]),
      PERMISSION,
    );
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.matchedGrant.sourceLabel).toBe("finance-team:approver");
    }
  });
});

describe("scope types are exhaustively handled", () => {
  const ALL_SCOPES: ScopeType[] = ["GLOBAL", "ORG_UNIT", "OWN_ORG_UNIT", "OWN"];

  it("never throws for any scope type", () => {
    for (const scopeType of ALL_SCOPES) {
      expect(() =>
        evaluate(setOf([grant({ scopeType, scopeOrgUnitPath: "/root" })]), PERMISSION, {
          orgUnitPath: "/root/finance",
          ownerId: "user-1",
        }),
      ).not.toThrow();
    }
  });
});
