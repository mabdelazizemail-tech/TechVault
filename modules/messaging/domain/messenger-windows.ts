/**
 * Which Messenger chat windows are open — pure, so the rules are unit-testable and
 * shared by the browser state and its tests.
 *
 * The array is ordered by recency: index 0 is the window the person opened or
 * restored last. It records INTENT (open or minimised); how many windows actually
 * fit side by side is decided at render time by `fitWindows`, so resizing the
 * browser never rewrites what the person chose.
 */

export type ChatWindowState = { conversationId: string; minimized: boolean };
export type MessengerWindows = readonly ChatWindowState[];

export type WindowAction =
  /** Open or restore a chat. `minimized` opens it as a chat head only (a new message). */
  | { type: "open"; conversationId: string; minimized?: boolean }
  | { type: "minimize"; conversationId: string }
  | { type: "close"; conversationId: string };

/** Chats kept open at once, windows and heads together. */
export const MAX_OPEN_WINDOWS = 6;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Drops the least recently used chats beyond the limit, minimised ones first. */
function trim(windows: ChatWindowState[]): ChatWindowState[] {
  const result = [...windows];
  while (result.length > MAX_OPEN_WINDOWS) {
    let index = -1;
    for (let i = result.length - 1; i >= 0; i -= 1) {
      if (result[i]?.minimized === true) {
        index = i;
        break;
      }
    }
    result.splice(index === -1 ? result.length - 1 : index, 1);
  }
  return result;
}

export function applyWindowAction(
  windows: MessengerWindows,
  action: WindowAction,
): MessengerWindows {
  const existing = windows.find(
    (window) => window.conversationId === action.conversationId,
  );

  switch (action.type) {
    case "open": {
      if (action.minimized === true) {
        // A new message never minimises or reorders a chat the person already has.
        if (existing !== undefined) return windows;
        return trim([
          { conversationId: action.conversationId, minimized: true },
          ...windows,
        ]);
      }
      if (existing !== undefined && !existing.minimized && windows[0] === existing) {
        return windows;
      }
      return trim([
        { conversationId: action.conversationId, minimized: false },
        ...windows.filter((window) => window !== existing),
      ]);
    }
    case "minimize":
      if (existing === undefined || existing.minimized) return windows;
      return windows.map((window) =>
        window === existing ? { ...window, minimized: true } : window,
      );
    case "close":
      return existing === undefined
        ? windows
        : windows.filter((window) => window !== existing);
  }
}

/**
 * What is shown: the most recent open chats up to `maxExpanded` as windows,
 * everything else as chat heads.
 */
export function fitWindows(
  windows: MessengerWindows,
  maxExpanded: number,
): MessengerWindows {
  let expanded = 0;
  return windows.map((window) => {
    if (window.minimized) return window;
    if (expanded < maxExpanded) {
      expanded += 1;
      return window;
    }
    return { ...window, minimized: true };
  });
}

/** Windows side by side for a viewport width: one on tablets, up to three on wide screens. */
export function maxExpandedFor(width: number): number {
  if (width < 1024) return 1;
  if (width < 1280) return 2;
  return 3;
}

/** Restores saved windows, discarding anything malformed. */
export function parseWindows(value: unknown): MessengerWindows {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const windows: ChatWindowState[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const { conversationId, minimized } = entry as Record<string, unknown>;
    if (typeof conversationId !== "string" || !UUID_PATTERN.test(conversationId))
      continue;
    if (typeof minimized !== "boolean" || seen.has(conversationId)) continue;
    seen.add(conversationId);
    windows.push({ conversationId, minimized });
  }
  return trim(windows);
}
