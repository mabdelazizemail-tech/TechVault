import { describe, expect, it } from "vitest";
import {
  MAX_OPEN_WINDOWS,
  applyWindowAction,
  fitWindows,
  maxExpandedFor,
  parseWindows,
  type MessengerWindows,
} from "@/modules/messaging/domain/messenger-windows";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ids = (windows: MessengerWindows) => windows.map((w) => w.conversationId);

describe("applyWindowAction", () => {
  it("opens a chat at the front and restores an existing one to the front", () => {
    let windows = applyWindowAction([], { type: "open", conversationId: id(1) });
    windows = applyWindowAction(windows, { type: "open", conversationId: id(2) });
    expect(ids(windows)).toEqual([id(2), id(1)]);

    windows = applyWindowAction(windows, { type: "minimize", conversationId: id(1) });
    windows = applyWindowAction(windows, { type: "open", conversationId: id(1) });
    expect(windows).toEqual([
      { conversationId: id(1), minimized: false },
      { conversationId: id(2), minimized: false },
    ]);
  });

  it("returns the same array when nothing changes, so React skips the render", () => {
    const windows = applyWindowAction([], { type: "open", conversationId: id(1) });
    expect(applyWindowAction(windows, { type: "open", conversationId: id(1) })).toBe(
      windows,
    );
    expect(applyWindowAction(windows, { type: "close", conversationId: id(9) })).toBe(
      windows,
    );
  });

  it("adds a new message as a chat head without disturbing open chats", () => {
    const open = applyWindowAction([], { type: "open", conversationId: id(1) });
    const withHead = applyWindowAction(open, {
      type: "open",
      conversationId: id(2),
      minimized: true,
    });
    expect(withHead).toEqual([
      { conversationId: id(2), minimized: true },
      { conversationId: id(1), minimized: false },
    ]);
    expect(
      applyWindowAction(open, { type: "open", conversationId: id(1), minimized: true }),
    ).toBe(open);
  });

  it("minimises and closes", () => {
    let windows = applyWindowAction([], { type: "open", conversationId: id(1) });
    windows = applyWindowAction(windows, { type: "minimize", conversationId: id(1) });
    expect(windows[0]?.minimized).toBe(true);
    windows = applyWindowAction(windows, { type: "close", conversationId: id(1) });
    expect(windows).toEqual([]);
  });

  it("keeps at most the limit, dropping the oldest chat heads before open windows", () => {
    let windows: MessengerWindows = [];
    windows = applyWindowAction(windows, { type: "open", conversationId: id(0) });
    for (let n = 1; n <= MAX_OPEN_WINDOWS; n += 1) {
      windows = applyWindowAction(windows, {
        type: "open",
        conversationId: id(n),
        minimized: true,
      });
    }
    expect(windows).toHaveLength(MAX_OPEN_WINDOWS);
    expect(ids(windows)).toContain(id(0));
    expect(ids(windows)).not.toContain(id(1));
  });
});

describe("fitWindows", () => {
  it("shows the most recent chats as windows and turns the rest into heads", () => {
    const windows: MessengerWindows = [id(1), id(2), id(3), id(4)].map(
      (conversationId) => ({
        conversationId,
        minimized: false,
      }),
    );
    const fitted = fitWindows(windows, 2);
    expect(fitted.map((w) => w.minimized)).toEqual([false, false, true, true]);
    // What the person chose is untouched: a wider screen shows them again.
    expect(fitWindows(windows, 3).filter((w) => !w.minimized)).toHaveLength(3);
  });

  it("never expands a chat the person minimised", () => {
    const fitted = fitWindows(
      [
        { conversationId: id(1), minimized: true },
        { conversationId: id(2), minimized: false },
      ],
      3,
    );
    expect(fitted.map((w) => w.minimized)).toEqual([true, false]);
  });
});

describe("maxExpandedFor", () => {
  it("fits one window on tablets and up to three on wide screens", () => {
    expect(maxExpandedFor(800)).toBe(1);
    expect(maxExpandedFor(1100)).toBe(2);
    expect(maxExpandedFor(1600)).toBe(3);
  });
});

describe("parseWindows", () => {
  it("restores valid saved windows and discards anything malformed or duplicated", () => {
    expect(
      parseWindows([
        { conversationId: id(1), minimized: false },
        { conversationId: id(1), minimized: true },
        { conversationId: "not-an-id", minimized: false },
        { conversationId: id(2) },
        null,
        { conversationId: id(3), minimized: true },
      ]),
    ).toEqual([
      { conversationId: id(1), minimized: false },
      { conversationId: id(3), minimized: true },
    ]);
    expect(parseWindows("garbage")).toEqual([]);
  });
});
