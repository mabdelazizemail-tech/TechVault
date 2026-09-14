"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { RealtimeChannel } from "@/platform/realtime/browser";
import { getInboxSummaryAction } from "./actions";

/**
 * App-wide messaging connection: the unread total, who is online, and the stream
 * of Realtime signals the Messenger reacts to (ADR-020).
 *
 * One provider per signed-in session, holding exactly two channels:
 *
 *   messaging:user:<me>     "a message arrived" / "a receipt moved", ids only
 *   messaging:presence      who is connected right now
 *
 * Each expanded chat window adds a typing channel and closes it when it closes.
 * Content is never carried here — listeners fetch it through Server Actions.
 *
 * It connects when the browser is idle after the page loads, importing the
 * Realtime library then, so no page renders later or ships it up front.
 */

export type MessageSignal = {
  conversationId: string;
  messageId: string;
  senderId: string | null;
  senderName: string | null;
  createdAt: string;
};

export type ReceiptSignal = {
  conversationId: string;
  userId: string;
  lastReadAt: string | null;
  lastDeliveredAt: string | null;
};

export type MessagingSignal =
  | { type: "message"; data: MessageSignal }
  | { type: "receipt"; data: ReceiptSignal }
  /** The connection dropped and came back: signals may have been missed. */
  | { type: "reconnected" };

type Controls = {
  me: { id: string; name: string };
  subscribe: (listener: (signal: MessagingSignal) => void) => () => void;
  /** An expanded chat window reports itself, so its messages count as read, not unread. */
  setConversationVisible: (conversationId: string, visible: boolean) => void;
  /** Re-reads the unread total (debounced). */
  refreshUnread: () => void;
};

type Presence = {
  onlineIds: ReadonlySet<string>;
  /** When this browser saw someone disconnect, for "Active just now". */
  leftAt: ReadonlyMap<string, string>;
};

const ControlsContext = createContext<Controls | null>(null);
const UnreadContext = createContext<number | null>(null);
const PresenceContext = createContext<Presence>({
  onlineIds: new Set(),
  leftAt: new Map(),
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const text = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

/** Signals arrive from the network: trust nothing about their shape. */
function toMessageSignal(payload: unknown): MessageSignal | null {
  if (!isRecord(payload)) return null;
  const conversationId = text(payload.conversationId);
  const messageId = text(payload.messageId);
  const createdAt = text(payload.createdAt);
  if (conversationId === null || messageId === null || createdAt === null) return null;
  return {
    conversationId,
    messageId,
    createdAt,
    senderId: text(payload.senderId),
    senderName: text(payload.senderName),
  };
}

function toReceiptSignal(payload: unknown): ReceiptSignal | null {
  if (!isRecord(payload)) return null;
  const conversationId = text(payload.conversationId);
  const userId = text(payload.userId);
  if (conversationId === null || userId === null) return null;
  return {
    conversationId,
    userId,
    lastReadAt: text(payload.lastReadAt),
    lastDeliveredAt: text(payload.lastDeliveredAt),
  };
}

/** Last seen is best-effort bookkeeping; a failed write must never surface. */
function reportConnected(): void {
  fetch("/api/messaging/presence", { method: "POST", keepalive: true }).catch(
    () => undefined,
  );
}

export function MessagingProvider({
  me,
  children,
}: {
  me: { id: string; name: string };
  children: ReactNode;
}) {
  const [unreadTotal, setUnreadTotal] = useState<number | null>(null);
  const [presence, setPresence] = useState<Presence>({
    onlineIds: new Set(),
    leftAt: new Map(),
  });

  const listeners = useRef(new Set<(signal: MessagingSignal) => void>());
  /** Expanded windows per conversation (a conversation could be shown twice). */
  const visible = useRef(new Map<string, number>());
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const controls = useMemo<Controls>(() => {
    const refreshUnread = () => {
      if (refreshTimer.current !== null) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => {
        refreshTimer.current = null;
        void getInboxSummaryAction().then((result) => {
          if (result.ok) setUnreadTotal(result.data.unreadTotal);
        });
      }, 400);
    };
    return {
      me: { id: me.id, name: me.name },
      refreshUnread,
      setConversationVisible: (conversationId, isVisible) => {
        const count = (visible.current.get(conversationId) ?? 0) + (isVisible ? 1 : -1);
        if (count <= 0) visible.current.delete(conversationId);
        else visible.current.set(conversationId, count);
      },
      subscribe: (listener) => {
        listeners.current.add(listener);
        return () => {
          listeners.current.delete(listener);
        };
      },
    };
  }, [me.id, me.name]);

  useEffect(() => {
    let stopped = false;
    let everSubscribed = false;
    const leaves: Array<() => Promise<void>> = [];
    const emit = (signal: MessagingSignal) => {
      for (const listener of listeners.current) listener(signal);
    };

    const onMessage = (signal: MessageSignal) => {
      emit({ type: "message", data: signal });
      if (signal.senderId === me.id) return;

      const onScreen =
        visible.current.has(signal.conversationId) &&
        document.visibilityState === "visible";
      if (onScreen) return;

      // Show it now, then let the server settle the exact figure (and record
      // delivery) once a burst of messages has passed.
      setUnreadTotal((total) => (total ?? 0) + 1);
      controls.refreshUnread();
    };

    const onReceipt = (signal: ReceiptSignal) => {
      emit({ type: "receipt", data: signal });
      // This person read something, perhaps in another tab: the badge follows.
      if (signal.userId === me.id) controls.refreshUnread();
    };

    async function start() {
      void getInboxSummaryAction().then((result) => {
        if (result.ok && !stopped) setUnreadTotal(result.data.unreadTotal);
      });
      reportConnected();

      const { openPrivateChannel } = await import("@/platform/realtime/browser");
      if (stopped) return;

      const inbox = await openPrivateChannel(
        `messaging:user:${me.id}`,
        (channel) => {
          channel.on("broadcast", { event: "message.created" }, ({ payload }) => {
            const signal = toMessageSignal(payload);
            if (signal !== null) onMessage(signal);
          });
          channel.on("broadcast", { event: "receipt.updated" }, ({ payload }) => {
            const signal = toReceiptSignal(payload);
            if (signal !== null) onReceipt(signal);
          });
        },
        {
          onStatus: (status) => {
            if (status !== "SUBSCRIBED") return;
            if (everSubscribed) {
              emit({ type: "reconnected" });
              controls.refreshUnread();
            }
            everSubscribed = true;
          },
        },
      );
      leaves.push(inbox.leave);
      if (stopped) return;

      let presenceChannel: RealtimeChannel | null = null;
      const online = await openPrivateChannel(
        "messaging:presence",
        (channel) => {
          presenceChannel = channel;
          channel.on("presence", { event: "sync" }, () => {
            const ids = new Set(Object.keys(channel.presenceState()));
            setPresence((current) => ({ ...current, onlineIds: ids }));
          });
          channel.on("presence", { event: "leave" }, ({ key }) => {
            // A person with two tabs open is still online when one closes.
            if (key in channel.presenceState()) return;
            setPresence((current) => ({
              ...current,
              leftAt: new Map(current.leftAt).set(key, new Date().toISOString()),
            }));
          });
        },
        {
          presenceKey: me.id,
          onStatus: (status) => {
            if (status === "SUBSCRIBED") {
              presenceChannel
                ?.track({ at: new Date().toISOString() })
                .catch(() => undefined);
            }
          },
        },
      );
      leaves.push(online.leave);
    }

    const begin = () => {
      // Realtime unavailable means no live updates; the Messenger still works by
      // loading, so a failed connection is not an error to show.
      start().catch(() => undefined);
    };
    const idle =
      typeof window.requestIdleCallback === "function"
        ? {
            id: window.requestIdleCallback(begin, { timeout: 2000 }),
            kind: "idle" as const,
          }
        : { id: window.setTimeout(begin, 500), kind: "timeout" as const };

    const onPageHide = () => navigator.sendBeacon("/api/messaging/presence");
    window.addEventListener("pagehide", onPageHide);

    return () => {
      stopped = true;
      if (idle.kind === "idle") window.cancelIdleCallback(idle.id);
      else window.clearTimeout(idle.id);
      window.removeEventListener("pagehide", onPageHide);
      for (const leave of leaves) void leave();
    };
  }, [me.id, controls]);

  return (
    <ControlsContext.Provider value={controls}>
      <UnreadContext.Provider value={unreadTotal}>
        <PresenceContext.Provider value={presence}>{children}</PresenceContext.Provider>
      </UnreadContext.Provider>
    </ControlsContext.Provider>
  );
}

export function useMessagingControls(): Controls {
  const controls = useContext(ControlsContext);
  if (controls === null) {
    throw new Error("useMessagingControls must be used inside MessagingProvider.");
  }
  return controls;
}

/** The unread total, or null before it has loaded or outside the provider. */
export function useUnreadTotal(): number | null {
  return useContext(UnreadContext);
}

export function usePresence(): Presence {
  return useContext(PresenceContext);
}
