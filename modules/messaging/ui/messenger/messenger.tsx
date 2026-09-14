"use client";

import { MessageCircle } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect } from "react";
import { useToast } from "@/components/ui/toast";
import { useMessagingControls, useUnreadTotal } from "../messaging-provider";
import {
  MessengerStateProvider,
  useMessengerActions,
  useMessengerState,
} from "./messenger-state";

/**
 * The floating Messenger, mounted once in the platform layout (ADR-020).
 *
 * What every page pays for is only this file: a launcher button, the unread count,
 * and a listener that turns an incoming message into a chat head and a toast. The
 * panel, chat windows, composer and emoji picker are a separate chunk, fetched the
 * first time a chat is opened (or when the pointer reaches the launcher), and they
 * load no conversation data until then either.
 */

const MessengerSurface = dynamic(
  () => import("./messenger-surface").then((module) => module.MessengerSurface),
  { ssr: false },
);

const preloadSurface = () => {
  void import("./messenger-surface");
};

export function Messenger() {
  return (
    <MessengerStateProvider>
      <MessengerLauncher />
    </MessengerStateProvider>
  );
}

function MessengerLauncher() {
  const { panelOpen, windows, hydrated } = useMessengerState();
  const actions = useMessengerActions();
  const { me, subscribe } = useMessagingControls();
  const unread = useUnreadTotal();
  const notify = useToast();

  useEffect(
    () =>
      subscribe((signal) => {
        if (signal.type !== "message" || signal.data.senderId === me.id) return;
        const { conversationId, senderName } = signal.data;
        if (actions.isExpanded(conversationId)) return;

        actions.openConversation(conversationId, { minimized: true });
        notify(`${senderName ?? "Someone"} sent you a message`, "info", {
          label: "Open",
          onSelect: () => actions.openConversation(conversationId),
        });
      }),
    [subscribe, me.id, actions, notify],
  );

  const count = unread ?? 0;
  const showSurface = hydrated && (panelOpen || windows.length > 0);

  return (
    <>
      {showSurface && <MessengerSurface />}
      <button
        type="button"
        onClick={actions.togglePanel}
        onPointerEnter={preloadSurface}
        onFocus={preloadSurface}
        aria-expanded={panelOpen}
        aria-controls="messenger-panel"
        aria-label={count > 0 ? `Messages, ${count} unread` : "Messages"}
        title="Messages"
        className="bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-pressed fixed end-4 bottom-4 z-40 grid size-14 cursor-pointer place-items-center rounded-full shadow-[0_12px_32px_color-mix(in_srgb,#2d2b2b_30%,transparent)]"
      >
        <MessageCircle aria-hidden="true" size={24} />
        {count > 0 && (
          <span
            aria-hidden="true"
            className="bg-surface text-primary-ink border-primary absolute -end-1 -top-1 grid h-6 min-w-6 place-items-center rounded-full border-2 px-1 text-[11px] font-extrabold"
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>
    </>
  );
}
