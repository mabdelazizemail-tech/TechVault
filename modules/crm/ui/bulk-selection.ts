/**
 * The rules behind the leads list's bulk selection, kept free of the DOM so they
 * can be tested.
 *
 * Each lead is on the page twice — a checkbox in the table and one in its phone
 * card — sharing the lead's id as their value. Only one layout is visible at a
 * time, but both boxes are in the form, so a change to one must reach its twin,
 * and the selection is counted and sent as distinct ids.
 */

/** Anything with a value and a checked state; an `HTMLInputElement` qualifies. */
export type SelectionBox = { value: string; checked: boolean };

export type SelectionChange =
  { kind: "all"; checked: boolean } | { kind: "row"; value: string; checked: boolean };

export type SelectionState = {
  /** Distinct rows selected. */
  selected: number;
  /** Distinct rows on the page. */
  total: number;
};

/** Applies a change to the row boxes in place and returns the distinct counts. */
export function applySelection(
  boxes: readonly SelectionBox[],
  change: SelectionChange,
): SelectionState {
  for (const box of boxes) {
    if (change.kind === "all" || box.value === change.value) {
      box.checked = change.checked;
    }
  }
  return selectionState(boxes);
}

export function selectionState(boxes: readonly SelectionBox[]): SelectionState {
  return {
    selected: new Set(boxes.filter((box) => box.checked).map((box) => box.value)).size,
    total: new Set(boxes.map((box) => box.value)).size,
  };
}

/** The ids to send: each selected row once, in page order. */
export function distinctIds(values: readonly string[]): string[] {
  return [...new Set(values)];
}
