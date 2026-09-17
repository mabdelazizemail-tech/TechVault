import { describe, expect, it } from "vitest";
import {
  applySelection,
  distinctIds,
  selectionState,
  type SelectionBox,
} from "@/modules/crm/ui/bulk-selection";

/**
 * Each lead has a checkbox in the table and another in its phone card, with the
 * same value. Selecting in either layout must count and send each lead once.
 */

/** Two leads, each rendered twice: cards first, then the table, as in the DOM. */
const page = (): SelectionBox[] => [
  { value: "lead-a", checked: false },
  { value: "lead-b", checked: false },
  { value: "lead-a", checked: false },
  { value: "lead-b", checked: false },
];

describe("lead bulk selection", () => {
  it("ticks the twin checkbox and counts the lead once", () => {
    const boxes = page();
    const state = applySelection(boxes, { kind: "row", value: "lead-a", checked: true });

    expect(state).toEqual({ selected: 1, total: 2 });
    expect(
      boxes.filter((box) => box.value === "lead-a").every((box) => box.checked),
    ).toBe(true);
    expect(boxes.filter((box) => box.value === "lead-b").some((box) => box.checked)).toBe(
      false,
    );
  });

  it("unticking in the other layout clears both boxes", () => {
    const boxes = page();
    applySelection(boxes, { kind: "row", value: "lead-b", checked: true });
    const state = applySelection(boxes, { kind: "row", value: "lead-b", checked: false });

    expect(state.selected).toBe(0);
    expect(boxes.some((box) => box.checked)).toBe(false);
  });

  it("select all and clear all cover both layouts", () => {
    const boxes = page();
    expect(applySelection(boxes, { kind: "all", checked: true })).toEqual({
      selected: 2,
      total: 2,
    });
    expect(boxes.every((box) => box.checked)).toBe(true);
    expect(applySelection(boxes, { kind: "all", checked: false }).selected).toBe(0);
  });

  it("an empty page selects nothing out of nothing", () => {
    expect(selectionState([])).toEqual({ selected: 0, total: 0 });
  });

  it("sends each selected lead once, in page order", () => {
    // The form data holds both twins of every ticked lead.
    expect(distinctIds(["lead-b", "lead-a", "lead-b", "lead-a"])).toEqual([
      "lead-b",
      "lead-a",
    ]);
  });
});
