"use client";

import { X } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import type { ConversationSummaryDto } from "../../contracts/types";
import { listConversationsAction } from "../actions";
import { initialsOf } from "../format";
import { useMessagingControls, usePresence } from "../messaging-provider";
import { ChatPanel } from "./chat-panel";
import { ChatWindow } from "./chat-window";
import { useMessengerActions, useMessengerState } from "./messenger-state";

/**
 * Everything the Messenger draws above the page: the conversation panel, the chat
 * windows along the bottom edge, and the chat heads of minimised chats.
 *
 * Loaded on demand (see messenger.tsx). It fetches the conversation list once when
 * it appears and again, debounced, when a Realtime signal says something changed.
 */

const REFRESH_DEBOUNCE_MS = 300;

export function MessengerSurface() {
  const { panelOpen, windows, compact } = useMessengerState();
  const actions = useMessengerActions();
  const { me, subscribe } = useMessagingControls();
  const { onlineIds } = usePresence();

  const [summaries, setSummaries] = useState<readonly ConversationSummaryDto[] | null>(
    null,
  );
  const [listError, setListError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const result = await listConversationsAction();
    if (result.ok) {
      setSummaries(result.data);
      setListError(null);
    } else {
      setListError(result.message);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void listConversationsAction().then((result) => {
      if (cancelled) return;
      if (result.ok) setSummaries(result.data);
      else setListError(result.message);
    });
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribe((signal) => {
      // Someone else's receipts change no count or preview in the list.
      if (signal.type === "receipt" && signal.data.userId !== me.id) return;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void reload();
      }, REFRESH_DEBOUNCE_MS);
    });
    return () => {
      cancelled = true;
      unsubscribe();
      if (timer !== null) clearTimeout(timer);
    };
  }, [reload, subscribe, me.id]);

  useEffect(() => {
    if (!panelOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") actions.closePanel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [panelOpen, actions]);

  const byId = useMemo(
    () => new Map((summaries ?? []).map((summary) => [summary.id, summary])),
    [summaries],
  );
  const expanded = windows.filter((window) => !window.minimized);
  const heads = windows.filter((window) => window.minimized);
  const phoneOverlay = compact && (panelOpen || expanded.length > 0);

  return (
    <>
      {!panelOpen && !phoneOverlay && heads.length > 0 && (
        <ul
          aria-label="Minimised chats"
          className="fixed end-4 bottom-22 z-40 flex flex-col-reverse items-end gap-2.5"
        >
          {heads.map((window) => (
            <ChatHead
              key={window.conversationId}
              conversationId={window.conversationId}
              summary={byId.get(window.conversationId)}
              isOnline={
                byId.get(window.conversationId) !== undefined &&
                onlineIds.has(byId.get(window.conversationId)?.counterpart.id ?? "")
              }
              onOpen={actions.openConversation}
              onClose={actions.close}
            />
          ))}
        </ul>
      )}

      {expanded.length > 0 && !(compact && panelOpen) && (
        <div
          className={cn(
            compact
              ? "fixed inset-0 z-50 flex"
              : "pointer-events-none fixed end-22 bottom-0 z-40 flex flex-row-reverse items-end gap-3",
          )}
        >
          {expanded.map((window) => (
            <ChatWindow
              key={window.conversationId}
              conversationId={window.conversationId}
              summary={byId.get(window.conversationId)}
              compact={compact}
            />
          ))}
        </div>
      )}

      {panelOpen && (
        <section
          id="messenger-panel"
          aria-label="Messages"
          className={cn(
            "bg-surface flex flex-col",
            compact
              ? "fixed inset-0 z-50"
              : "border-border-strong fixed end-4 bottom-20 z-50 h-[min(36rem,calc(100dvh-7rem))] w-[22rem] border-2 shadow-[0_16px_40px_color-mix(in_srgb,#2d2b2b_28%,transparent)]",
          )}
        >
          <ChatPanel summaries={summaries} error={listError} onChanged={reload} />
        </section>
      )}
    </>
  );
}

const ChatHead = memo(function ChatHead({
  conversationId,
  summary,
  isOnline,
  onOpen,
  onClose,
}: {
  conversationId: string;
  summary: ConversationSummaryDto | undefined;
  isOnline: boolean;
  onOpen: (conversationId: string) => void;
  onClose: (conversationId: string) => void;
}) {
  const name = summary?.counterpart.name ?? "Chat";
  const unread = summary?.unreadCount ?? 0;

  return (
    <li className="group relative">
      <button
        type="button"
        onClick={() => onOpen(conversationId)}
        title={name}
        aria-label={`Open chat with ${name}${unread > 0 ? `, ${unread} unread` : ""}`}
        className="bg-surface-raised text-foreground border-border-strong hover:bg-surface-hover grid size-12 cursor-pointer place-items-center border-2 text-sm font-extrabold shadow-[0_8px_20px_color-mix(in_srgb,#2d2b2b_24%,transparent)]"
      >
        {initialsOf(name)}
      </button>
      {summary?.counterpart.isActive === true && (
        <span
          aria-hidden="true"
          className={cn(
            "border-surface absolute end-0 bottom-0 size-3.5 border-2",
            isOnline ? "bg-success" : "bg-foreground-subtle",
          )}
        />
      )}
      {unread > 0 && (
        <span
          aria-hidden="true"
          className="bg-primary text-primary-foreground absolute -end-1 -top-1 grid h-5 min-w-5 place-items-center px-1 text-[11px] font-extrabold"
        >
          {unread > 99 ? "99+" : unread}
        </span>
      )}
      <button
        type="button"
        onClick={() => onClose(conversationId)}
        aria-label={`Close chat with ${name}`}
        className="bg-foreground text-surface absolute -start-1 -top-1 hidden size-5 cursor-pointer place-items-center group-focus-within:grid group-hover:grid"
      >
        <X aria-hidden="true" size={12} />
      </button>
    </li>
  );
});
