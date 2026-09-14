"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  applyWindowAction,
  fitWindows,
  maxExpandedFor,
  parseWindows,
  type MessengerWindows,
} from "../../domain/messenger-windows";

/**
 * Messenger UI state: the panel, the open chat windows, and unsent drafts.
 *
 * It lives in the platform layout, which Next.js keeps mounted across client-side
 * navigation, so open chats and drafts survive moving between pages. Open windows
 * are also saved to sessionStorage so a reload in the same tab restores them.
 * Plain React state — no state library (CLAUDE.md §16.4).
 *
 * Actions are a separate, stable context: opening a chat re-renders the Messenger,
 * not every component that can open one.
 */

const STORAGE_KEY = "techvault.messenger.windows.v1";
const COMPACT_WIDTH = 768;

type MessengerState = {
  panelOpen: boolean;
  /** Open chats in recency order, already fitted to the screen width. */
  windows: MessengerWindows;
  /** Phone-sized screen: one full-screen chat at a time. */
  compact: boolean;
  /** False during server render and hydration; saved windows show only after. */
  hydrated: boolean;
};

type MessengerActions = {
  togglePanel: () => void;
  openPanel: () => void;
  closePanel: () => void;
  openConversation: (conversationId: string, options?: { minimized?: boolean }) => void;
  minimize: (conversationId: string) => void;
  close: (conversationId: string) => void;
  /** Whether the chat is on screen as a window right now. */
  isExpanded: (conversationId: string) => boolean;
  getDraft: (conversationId: string) => string;
  setDraft: (conversationId: string, draft: string) => void;
};

const StateContext = createContext<MessengerState | null>(null);
const ActionsContext = createContext<MessengerActions | null>(null);

function subscribeToResize(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

/** 0 for phones; otherwise how many windows fit side by side. */
function widthBucket(): number {
  const width = window.innerWidth;
  return width < COMPACT_WIDTH ? 0 : maxExpandedFor(width);
}

const subscribeNever = () => () => undefined;

function readSavedWindows(): MessengerWindows {
  if (typeof window === "undefined") return [];
  try {
    return parseWindows(JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? "[]"));
  } catch {
    // Storage blocked or corrupt: start with no open chats.
    return [];
  }
}

export function MessengerStateProvider({ children }: { children: ReactNode }) {
  const [intent, dispatch] = useReducer(applyWindowAction, undefined, readSavedWindows);
  const [panelOpen, setPanelOpen] = useState(false);
  const bucket = useSyncExternalStore(subscribeToResize, widthBucket, () => 3);
  const hydrated = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  const compact = bucket === 0;

  const windows = useMemo(
    () => fitWindows(intent, compact ? 1 : bucket),
    [intent, bucket, compact],
  );

  const windowsRef = useRef(windows);
  const drafts = useRef(new Map<string, string>());

  useEffect(() => {
    windowsRef.current = windows;
  }, [windows]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(intent));
    } catch {
      // Storage unavailable: chats simply do not survive a reload.
      return;
    }
  }, [intent]);

  const actions = useMemo<MessengerActions>(
    () => ({
      togglePanel: () => setPanelOpen((open) => !open),
      openPanel: () => setPanelOpen(true),
      closePanel: () => setPanelOpen(false),
      openConversation: (conversationId, options) => {
        const minimized = options?.minimized === true;
        dispatch({ type: "open", conversationId, minimized });
        // Choosing a chat closes the list, as in Messenger.
        if (!minimized) setPanelOpen(false);
      },
      minimize: (conversationId) => dispatch({ type: "minimize", conversationId }),
      close: (conversationId) => {
        drafts.current.delete(conversationId);
        dispatch({ type: "close", conversationId });
      },
      isExpanded: (conversationId) =>
        windowsRef.current.some(
          (window) => window.conversationId === conversationId && !window.minimized,
        ),
      getDraft: (conversationId) => drafts.current.get(conversationId) ?? "",
      setDraft: (conversationId, draft) => {
        if (draft === "") drafts.current.delete(conversationId);
        else drafts.current.set(conversationId, draft);
      },
    }),
    [],
  );

  const state = useMemo<MessengerState>(
    () => ({ panelOpen, windows, compact, hydrated }),
    [panelOpen, windows, compact, hydrated],
  );

  return (
    <ActionsContext.Provider value={actions}>
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
    </ActionsContext.Provider>
  );
}

export function useMessengerState(): MessengerState {
  const state = useContext(StateContext);
  if (state === null) {
    throw new Error("useMessengerState must be used inside MessengerStateProvider.");
  }
  return state;
}

export function useMessengerActions(): MessengerActions {
  const actions = useContext(ActionsContext);
  if (actions === null) {
    throw new Error("useMessengerActions must be used inside MessengerStateProvider.");
  }
  return actions;
}
