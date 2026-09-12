import { describe, expect, it } from "vitest";
// Imported from the pure module, so the suite does not boot a database client.
import { diffForAudit } from "@/platform/audit/diff";

describe("diffForAudit", () => {
  it("records only the fields that changed", () => {
    const changes = diffForAudit(
      { name: "Ada", email: "ada@example.com", isActive: true },
      { name: "Ada Lovelace", email: "ada@example.com", isActive: true },
    );
    expect(changes).toEqual({ name: { from: "Ada", to: "Ada Lovelace" } });
  });

  it("returns nothing when nothing changed", () => {
    expect(diffForAudit({ a: 1 }, { a: 1 })).toEqual({});
  });

  it("records that a sensitive field changed, without its values", () => {
    // The audit trail must prove a salary was altered without becoming a second
    // copy of the salary (CLAUDE.md §18.5).
    const changes = diffForAudit(
      { baseSalaryMinor: 5_000_00, title: "Analyst" },
      { baseSalaryMinor: 6_000_00, title: "Senior Analyst" },
      ["baseSalaryMinor"],
    );
    expect(changes.baseSalaryMinor).toEqual({ from: "[changed]", to: "[changed]" });
    expect(changes.title).toEqual({ from: "Analyst", to: "Senior Analyst" });
    expect(JSON.stringify(changes)).not.toContain("500000");
    expect(JSON.stringify(changes)).not.toContain("600000");
  });

  it("detects a field that was added", () => {
    expect(diffForAudit({}, { note: "added" })).toEqual({
      note: { from: undefined, to: "added" },
    });
  });

  it("detects a field that was cleared", () => {
    expect(diffForAudit({ note: "gone" }, { note: null })).toEqual({
      note: { from: "gone", to: null },
    });
  });

  it("treats equal dates as unchanged", () => {
    const a = new Date("2026-01-01T00:00:00Z");
    const b = new Date("2026-01-01T00:00:00Z");
    expect(diffForAudit({ at: a }, { at: b })).toEqual({});
  });

  it("detects a genuinely different date", () => {
    const changes = diffForAudit(
      { at: new Date("2026-01-01T00:00:00Z") },
      { at: new Date("2026-02-01T00:00:00Z") },
    );
    expect(Object.keys(changes)).toEqual(["at"]);
  });
});
