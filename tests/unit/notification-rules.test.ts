import { describe, expect, it } from "vitest";
import { isAppPath, preview, recipientsFor } from "@/platform/notifications/rules";

/** Pure rules of the notification service (ADR-036). */

describe("recipients", () => {
  it("notifies each person once and never the person who acted", () => {
    expect(recipientsFor(["a", "b", "a", "actor", "c", "b"], "actor")).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("skips missing ids and keeps everyone when the system acts", () => {
    expect(recipientsFor(["a", null, undefined, "", "a"], null)).toEqual(["a"]);
  });

  it("is empty when the only candidate is the actor", () => {
    expect(recipientsFor(["actor", "actor"], "actor")).toEqual([]);
  });
});

describe("links", () => {
  it("accepts application paths only", () => {
    expect(isAppPath("/committees/meetings/1/tasks/2#reply-3")).toBe(true);
    expect(isAppPath("/")).toBe(true);
    expect(isAppPath("//evil.example/phish")).toBe(false);
    expect(isAppPath("/\\evil.example")).toBe(false);
    expect(isAppPath("https://evil.example")).toBe(false);
    expect(isAppPath("javascript:alert(1)")).toBe(false);
    expect(isAppPath(`/${"a".repeat(600)}`)).toBe(false);
  });
});

describe("previews", () => {
  it("keeps short text and collapses whitespace", () => {
    expect(preview("  Hello\n\n  there  ", 50)).toBe("Hello there");
  });

  it("cuts long text on a word boundary with an ellipsis", () => {
    const text = "The quarterly budget draft needs the regional figures first";
    const short = preview(text, 30);
    expect(short.length).toBeLessThanOrEqual(30);
    expect(short.endsWith("…")).toBe(true);
    expect(short).toBe("The quarterly budget draft…");
  });
});
