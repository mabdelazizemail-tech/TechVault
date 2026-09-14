"use client";

import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCheck,
  Clock,
  FileText,
  Minus,
  SendHorizontal,
  X,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";
import type { RealtimeChannel } from "@/platform/realtime/browser";
import {
  MESSAGE_MAX_LENGTH,
  MESSAGE_PAGE_SIZE,
  type ConversationDetailDto,
  type ConversationSummaryDto,
  type MessageDto,
  type MessagePage,
  type MessageStatus,
  type ReceiptDto,
} from "../../contracts/types";
import {
  buildTimeline,
  mergeMessages,
  messageStatus,
} from "../../domain/conversation-rules";
import {
  getConversationAction,
  listMessagesAction,
  markReadAction,
  sendMessageAction,
} from "../actions";
import { Avatar } from "../avatar";
import { dayKeyOf, formatActive, formatDayLabel, formatTime, latest } from "../format";
import { useMessagingControls, usePresence } from "../messaging-provider";
import { EmojiPicker } from "./emoji-picker";
import { useMessengerActions } from "./messenger-state";

/**
 * One floating chat window.
 *
 * Loading: the conversation and its newest 50 messages when the window opens;
 * older pages when the reader scrolls near the top, keeping their place. A Realtime
 * signal triggers one fetch of what is newer than the newest confirmed message.
 *
 * Sending is optimistic; the client picks the message id, so the confirmed copy
 * replaces the optimistic one and a retry can never duplicate it.
 *
 * Typing indicators use a Broadcast channel for this conversation only, open while
 * the window is expanded. A minimised chat is only a chat head and holds no
 * channel and no messages.
 */

type ShownMessage = MessageDto & { delivery?: "sending" | "failed" };

type Loaded = { conversation: ConversationDetailDto; page: MessagePage };

export function ChatWindow({
  conversationId,
  summary,
  compact,
}: {
  conversationId: string;
  /** From the conversation list, to title the window while it loads. */
  summary: ConversationSummaryDto | undefined;
  compact: boolean;
}) {
  const actions = useMessengerActions();
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<
    { status: "ready"; data: Loaded } | { status: "error"; message: string } | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      getConversationAction(conversationId),
      listMessagesAction({ conversationId }),
    ]).then(([conversation, page]) => {
      if (cancelled) return;
      if (!conversation.ok) setLoaded({ status: "error", message: conversation.message });
      else if (!page.ok) setLoaded({ status: "error", message: page.message });
      else {
        setLoaded({
          status: "ready",
          data: { conversation: conversation.data, page: page.data },
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [conversationId, attempt]);

  const frame = cn(
    "bg-surface pointer-events-auto flex flex-col",
    compact
      ? "h-full w-full"
      : "border-border-strong h-[min(30rem,calc(100dvh-5rem))] w-[21rem] border-2 border-b-0 shadow-[0_12px_32px_color-mix(in_srgb,#2d2b2b_26%,transparent)]",
  );

  if (loaded?.status === "ready") {
    return (
      <section
        aria-label={`Chat with ${loaded.data.conversation.counterpart.name}`}
        className={frame}
      >
        <ChatBody
          key={conversationId}
          conversation={loaded.data.conversation}
          initialPage={loaded.data.page}
          compact={compact}
        />
      </section>
    );
  }

  const name = summary?.counterpart.name ?? "Chat";
  return (
    <section aria-label={`Chat with ${name}`} className={frame}>
      <WindowHeader
        name={name}
        status={loaded === null ? "Loading…" : ""}
        compact={compact}
        onMinimize={() => actions.minimize(conversationId)}
        onClose={() => actions.close(conversationId)}
      />
      <div className="flex flex-1 flex-col items-start justify-center gap-2 px-4">
        {loaded === null ? (
          <div aria-busy="true" className="flex w-full animate-pulse flex-col gap-2.5">
            <span className="sr-only" role="status">
              Loading conversation…
            </span>
            <div className="bg-surface-sunken h-8 w-44 rounded-2xl" />
            <div className="bg-surface-sunken h-10 w-52 self-end rounded-2xl" />
            <div className="bg-surface-sunken h-8 w-36 rounded-2xl" />
          </div>
        ) : (
          <>
            <p role="alert" className="text-danger text-[13px]">
              {loaded.message}
            </p>
            <button
              type="button"
              onClick={() => {
                setLoaded(null);
                setAttempt((value) => value + 1);
              }}
              className="text-primary-ink cursor-pointer text-[13px] font-extrabold underline"
            >
              Try again
            </button>
          </>
        )}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function WindowHeader({
  name,
  status,
  statusTone = "muted",
  avatar,
  compact,
  onMinimize,
  onClose,
}: {
  name: string;
  status: string;
  statusTone?: "muted" | "active";
  avatar?: ReactNode;
  compact: boolean;
  onMinimize: () => void;
  onClose: () => void;
}) {
  const actions = useMessengerActions();
  return (
    <header className="border-border flex shrink-0 items-center gap-2 border-b px-2 py-2">
      {compact && (
        <button
          type="button"
          onClick={() => {
            onMinimize();
            actions.openPanel();
          }}
          aria-label="Back to chats"
          className="text-foreground-muted hover:bg-surface-hover grid size-9 cursor-pointer place-items-center rounded-full"
        >
          <ArrowLeft aria-hidden="true" size={18} />
        </button>
      )}
      {avatar}
      <div className="min-w-0 flex-1 ps-0.5">
        <h3 dir="auto" className="text-foreground truncate text-[14px] font-extrabold">
          {name}
        </h3>
        <p
          aria-live="polite"
          suppressHydrationWarning
          className={cn(
            "truncate text-[11.5px]",
            statusTone === "active" ? "text-success" : "text-foreground-muted",
          )}
        >
          {status}
        </p>
      </div>
      {!compact && (
        <button
          type="button"
          onClick={onMinimize}
          aria-label={`Minimise chat with ${name}`}
          title="Minimise"
          className="text-foreground-muted hover:bg-surface-hover hover:text-foreground grid size-8 cursor-pointer place-items-center rounded-full"
        >
          <Minus aria-hidden="true" size={17} />
        </button>
      )}
      <button
        type="button"
        onClick={onClose}
        aria-label={`Close chat with ${name}`}
        title="Close"
        className="text-foreground-muted hover:bg-surface-hover hover:text-foreground grid size-8 cursor-pointer place-items-center rounded-full"
      >
        <X aria-hidden="true" size={17} />
      </button>
    </header>
  );
}

/* -------------------------------------------------------------------------- */

const NEAR_BOTTOM_PX = 100;
const LOAD_OLDER_WITHIN_PX = 160;
const TYPING_SEND_INTERVAL_MS = 2_500;
const TYPING_SHOWN_FOR_MS = 5_000;
/** A read watermark later than any message: "nothing was unread on opening". */
const NOTHING_UNREAD = "9999-12-31T23:59:59.999Z";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

function newestConfirmed(messages: readonly ShownMessage[]): ShownMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message !== undefined && message.delivery === undefined) return message;
  }
  return undefined;
}

function ChatBody({
  conversation,
  initialPage,
  compact,
}: {
  conversation: ConversationDetailDto;
  initialPage: MessagePage;
  compact: boolean;
}) {
  const { me, subscribe, setConversationVisible, refreshUnread } = useMessagingControls();
  const { onlineIds, leftAt } = usePresence();
  const actions = useMessengerActions();
  const { id: conversationId, counterpart } = conversation;

  const [messages, setMessages] = useState<readonly ShownMessage[]>(initialPage.messages);
  const [hasOlder, setHasOlder] = useState(initialPage.hasOlder);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<ReceiptDto[]>(conversation.receipts);
  const [typingUntil, setTypingUntil] = useState<number | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [dividerReadAt] = useState(() =>
    initialPage.messages.some(
      (message) =>
        message.senderId !== me.id &&
        (conversation.myLastReadAt === null ||
          Date.parse(message.createdAt) > Date.parse(conversation.myLastReadAt)),
    )
      ? conversation.myLastReadAt
      : NOTHING_UNREAD,
  );

  const scroller = useRef<HTMLDivElement>(null);
  const divider = useRef<HTMLLIElement>(null);
  const hasPositioned = useRef(false);
  const stickToBottom = useRef(true);
  const prependAnchor = useRef<{ height: number; top: number } | null>(null);
  const messagesRef = useRef(messages);
  const typingChannel = useRef<RealtimeChannel | null>(null);
  const lastTypingSent = useRef(0);
  const lastMarkedRead = useRef<string | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    setConversationVisible(conversationId, true);
    return () => setConversationVisible(conversationId, false);
  }, [conversationId, setConversationVisible]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  /* Live messages and receipts. ------------------------------------------- */
  const catchUp = useCallback(async () => {
    for (let round = 0; round < 5; round += 1) {
      const after = newestConfirmed(messagesRef.current)?.id;
      const result = await listMessagesAction(
        after === undefined ? { conversationId } : { conversationId, after },
      );
      if (!result.ok) return;
      const merged = mergeMessages(messagesRef.current, result.data.messages);
      messagesRef.current = merged;
      setMessages(merged);
      if (after === undefined || result.data.messages.length < MESSAGE_PAGE_SIZE) return;
    }
  }, [conversationId]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        void catchUp();
      }, 120);
    };

    const unsubscribe = subscribe((signal) => {
      if (signal.type === "reconnected") {
        schedule();
        return;
      }
      if (signal.data.conversationId !== conversationId) return;

      if (signal.type === "message") {
        const { senderId, messageId } = signal.data;
        if (senderId !== me.id) setTypingUntil(null);
        if (senderId === me.id && messagesRef.current.some((m) => m.id === messageId)) {
          return;
        }
        schedule();
        return;
      }

      const receipt = signal.data;
      if (receipt.userId === me.id) return;
      setReceipts((current) => {
        const previous = current.find((entry) => entry.userId === receipt.userId);
        const next: ReceiptDto = {
          userId: receipt.userId,
          lastReadAt: latest(previous?.lastReadAt ?? null, receipt.lastReadAt),
          lastDeliveredAt: latest(
            previous?.lastDeliveredAt ?? null,
            receipt.lastDeliveredAt,
          ),
        };
        return [...current.filter((entry) => entry.userId !== receipt.userId), next];
      });
    });

    return () => {
      unsubscribe();
      if (timer !== null) clearTimeout(timer);
    };
  }, [conversationId, me.id, subscribe, catchUp]);

  /* Reading: an open window in a visible tab reads what arrives. ----------- */
  useEffect(() => {
    const markIfVisible = () => {
      if (document.visibilityState !== "visible") return;
      let newest: ShownMessage | undefined;
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const candidate = messages[index];
        if (candidate?.delivery === undefined && candidate?.senderId !== me.id) {
          newest = candidate;
          break;
        }
      }
      if (newest === undefined || newest.id === lastMarkedRead.current) return;
      lastMarkedRead.current = newest.id;

      const alreadyRead =
        conversation.myLastReadAt !== null &&
        Date.parse(newest.createdAt) <= Date.parse(conversation.myLastReadAt);
      if (alreadyRead) return;

      void markReadAction({ conversationId, messageId: newest.id }).then((result) => {
        if (result.ok) refreshUnread();
      });
    };

    const timer = setTimeout(markIfVisible, 300);
    document.addEventListener("visibilitychange", markIfVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", markIfVisible);
    };
  }, [messages, conversationId, me.id, refreshUnread, conversation.myLastReadAt]);

  /* Typing. ---------------------------------------------------------------- */
  useEffect(() => {
    if (!conversation.canSend) return;
    let stopped = false;
    let leave: (() => Promise<void>) | null = null;

    import("@/platform/realtime/browser")
      .then(async ({ openPrivateChannel }) => {
        if (stopped) return;
        const opened = await openPrivateChannel(
          `messaging:conversation:${conversationId}`,
          (channel) => {
            channel.on("broadcast", { event: "typing" }, ({ payload }) => {
              if (!isRecord(payload) || payload.userId === me.id) return;
              setTypingUntil(
                payload.state === "stop" ? null : Date.now() + TYPING_SHOWN_FOR_MS,
              );
            });
          },
        );
        leave = opened.leave;
        if (stopped) {
          void opened.leave();
          return;
        }
        typingChannel.current = opened.channel;
      })
      // No typing indicator is a degraded experience, not an error to report.
      .catch(() => undefined);

    return () => {
      stopped = true;
      typingChannel.current = null;
      if (leave !== null) void leave();
    };
  }, [conversationId, conversation.canSend, me.id]);

  useEffect(() => {
    if (typingUntil === null) return;
    const timer = setTimeout(
      () => setTypingUntil(null),
      Math.max(0, typingUntil - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [typingUntil]);

  const sendTyping = useCallback(
    (state: "start" | "stop") => {
      const channel = typingChannel.current;
      if (channel === null) return;
      if (state === "start") {
        const at = Date.now();
        if (at - lastTypingSent.current < TYPING_SEND_INTERVAL_MS) return;
        lastTypingSent.current = at;
      } else {
        if (lastTypingSent.current === 0) return;
        lastTypingSent.current = 0;
      }
      channel
        .send({ type: "broadcast", event: "typing", payload: { userId: me.id, state } })
        .catch(() => undefined);
    },
    [me.id],
  );

  /* Older pages. ----------------------------------------------------------- */
  const loadOlder = useCallback(async () => {
    if (loadingOlder || !hasOlder) return;
    const oldest = messagesRef.current.find((message) => message.delivery === undefined);
    if (oldest === undefined) return;

    setLoadingOlder(true);
    setOlderError(null);
    const result = await listMessagesAction({ conversationId, before: oldest.id });
    setLoadingOlder(false);
    if (!result.ok) {
      setOlderError(result.message);
      return;
    }
    const element = scroller.current;
    if (element !== null) {
      prependAnchor.current = { height: element.scrollHeight, top: element.scrollTop };
    }
    setHasOlder(result.data.hasOlder);
    setMessages((current) => mergeMessages(current, result.data.messages));
  }, [conversationId, hasOlder, loadingOlder]);

  const onScroll = () => {
    const element = scroller.current;
    if (element === null) return;
    stickToBottom.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_BOTTOM_PX;
    if (element.scrollTop < LOAD_OLDER_WITHIN_PX) void loadOlder();
  };

  const isTyping = typingUntil !== null && counterpart.isActive;

  useLayoutEffect(() => {
    const element = scroller.current;
    if (element === null) return;

    if (!hasPositioned.current) {
      hasPositioned.current = true;
      if (divider.current !== null) {
        element.scrollTop = Math.max(0, divider.current.offsetTop - 40);
        stickToBottom.current = false;
        return;
      }
      element.scrollTop = element.scrollHeight;
      return;
    }

    const anchor = prependAnchor.current;
    if (anchor !== null) {
      prependAnchor.current = null;
      element.scrollTop = element.scrollHeight - anchor.height + anchor.top;
      return;
    }
    if (stickToBottom.current) element.scrollTop = element.scrollHeight;
  }, [messages, isTyping]);

  /* Sending. --------------------------------------------------------------- */
  const deliver = useCallback(
    (message: ShownMessage) => {
      void sendMessageAction({
        conversationId,
        clientMessageId: message.id,
        content: message.content ?? "",
      }).then((result) => {
        if (result.ok) {
          setMessages((current) => mergeMessages(current, [result.data]));
          return;
        }
        setMessages((current) =>
          current.map((entry) =>
            entry.id === message.id ? { ...entry, delivery: "failed" } : entry,
          ),
        );
        setSendError(result.message);
      });
    },
    [conversationId],
  );

  const send = useCallback(
    (content: string) => {
      const trimmed = content.trim();
      if (trimmed === "") return;
      const optimistic: ShownMessage = {
        id: crypto.randomUUID(),
        conversationId,
        senderId: me.id,
        type: "TEXT",
        content: trimmed,
        createdAt: new Date().toISOString(),
        editedAt: null,
        delivery: "sending",
      };
      stickToBottom.current = true;
      setSendError(null);
      setMessages((current) => mergeMessages(current, [optimistic]));
      sendTyping("stop");
      deliver(optimistic);
    },
    [conversationId, me.id, sendTyping, deliver],
  );

  const retry = useCallback(
    (messageId: string) => {
      const failed = messagesRef.current.find((message) => message.id === messageId);
      if (failed === undefined) return;
      const again: ShownMessage = { ...failed, delivery: "sending" };
      setSendError(null);
      setMessages((current) => current.map((m) => (m.id === messageId ? again : m)));
      deliver(again);
    },
    [deliver],
  );

  /* Rendering. ------------------------------------------------------------- */
  const timeline = useMemo(
    () =>
      buildTimeline(messages, { viewerId: me.id, lastReadAt: dividerReadAt, dayKeyOf }),
    [messages, me.id, dividerReadAt],
  );

  const isOnline = onlineIds.has(counterpart.id);
  const firstName = counterpart.name.split(/\s+/)[0] ?? counterpart.name;
  const status = !counterpart.isActive
    ? "Account deactivated"
    : formatActive(
        isOnline,
        latest(counterpart.lastSeenAt, leftAt.get(counterpart.id)),
        now,
      );

  return (
    <>
      <WindowHeader
        name={counterpart.name}
        status={status}
        statusTone={isOnline && counterpart.isActive ? "active" : "muted"}
        avatar={
          <Avatar
            name={counterpart.name}
            online={counterpart.isActive ? isOnline : undefined}
            className="rounded-full"
          />
        }
        compact={compact}
        onMinimize={() => actions.minimize(conversationId)}
        onClose={() => actions.close(conversationId)}
      />

      <div
        ref={scroller}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2"
      >
        {hasOlder && (
          <div className="flex justify-center pb-1.5">
            <button
              type="button"
              onClick={() => void loadOlder()}
              disabled={loadingOlder}
              className="text-primary-ink cursor-pointer text-xs font-extrabold hover:underline disabled:cursor-wait disabled:opacity-60"
            >
              {loadingOlder ? "Loading…" : "Load earlier messages"}
            </button>
          </div>
        )}
        {olderError !== null && (
          <p role="alert" className="text-danger pb-2 text-center text-xs">
            {olderError}
          </p>
        )}

        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <Avatar name={counterpart.name} className="size-14 rounded-full text-base" />
            <p dir="auto" className="text-foreground text-[14px] font-extrabold">
              {counterpart.name}
            </p>
            <p className="text-foreground-muted text-[12.5px]">
              {conversation.canSend
                ? "Say hello 👋"
                : "This conversation has no messages."}
            </p>
          </div>
        ) : (
          <ol role="log" aria-label="Messages" className="flex flex-col">
            {timeline.map((item) => {
              if (item.kind === "day") {
                return (
                  <li
                    key={item.key}
                    className="text-foreground-subtle my-2.5 text-center text-[11px] font-semibold"
                    suppressHydrationWarning
                  >
                    {formatDayLabel(item.firstAt, now)}
                  </li>
                );
              }
              if (item.kind === "unread") {
                return (
                  <li
                    key={item.key}
                    ref={divider}
                    className="text-primary-ink my-2.5 flex items-center gap-2 text-[11px] font-extrabold"
                  >
                    <span aria-hidden="true" className="bg-primary h-px flex-1" />
                    Unread
                    <span aria-hidden="true" className="bg-primary h-px flex-1" />
                  </li>
                );
              }
              const mine = item.message.senderId === me.id;
              return (
                <MessageBubble
                  key={item.key}
                  message={item.message}
                  mine={mine}
                  senderName={mine ? me.name : counterpart.name}
                  status={mine ? messageStatus(item.message, me.id, receipts) : null}
                  continuesGroup={item.continuesGroup}
                  onRetry={retry}
                />
              );
            })}
          </ol>
        )}

        {isTyping && (
          <p
            aria-live="polite"
            className="text-foreground-muted mt-2 flex items-center gap-2 text-xs"
          >
            <span
              aria-hidden="true"
              className="bg-surface-sunken inline-flex gap-0.5 rounded-full px-2 py-1.5"
            >
              <span className="bg-foreground-subtle size-1.5 animate-bounce rounded-full" />
              <span className="bg-foreground-subtle size-1.5 animate-bounce rounded-full [animation-delay:120ms]" />
              <span className="bg-foreground-subtle size-1.5 animate-bounce rounded-full [animation-delay:240ms]" />
            </span>
            <span dir="auto">{firstName} is typing…</span>
          </p>
        )}
      </div>

      {sendError !== null && (
        <p
          role="alert"
          className="border-danger/25 bg-danger-subtle text-danger mx-2 mb-1.5 border px-2.5 py-1.5 text-xs"
        >
          {sendError}
        </p>
      )}

      {conversation.canSend ? (
        <Composer
          conversationId={conversationId}
          recipientName={counterpart.name}
          onSend={send}
          onTyping={sendTyping}
        />
      ) : (
        <p className="border-border text-foreground-muted border-t px-3 py-2.5 text-[12.5px]">
          {counterpart.isActive
            ? "You do not have permission to send messages."
            : `${counterpart.name}'s account is deactivated. You can read this chat but no longer reply.`}
        </p>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */

const STATUS_LABELS: Record<MessageStatus | "sending" | "failed", string> = {
  sending: "Sending",
  failed: "Not sent",
  sent: "Sent",
  delivered: "Delivered",
  read: "Read",
};

/** Memoised: a new message renders its own bubble, not the whole conversation. */
const MessageBubble = memo(function MessageBubble({
  message,
  mine,
  senderName,
  status,
  continuesGroup,
  onRetry,
}: {
  message: ShownMessage;
  mine: boolean;
  senderName: string;
  status: MessageStatus | null;
  continuesGroup: boolean;
  onRetry: (messageId: string) => void;
}) {
  if (message.type === "SYSTEM") {
    return (
      <li dir="auto" className="text-foreground-muted my-2 text-center text-xs">
        {message.content}
      </li>
    );
  }

  const shownStatus = message.delivery ?? status;

  return (
    <li
      className={cn(
        "flex flex-col",
        mine ? "items-end" : "items-start",
        continuesGroup ? "mt-0.5" : "mt-2",
      )}
    >
      <div
        title={formatTime(message.createdAt)}
        className={cn(
          "max-w-[85%] rounded-2xl px-3 py-1.5 text-[13.5px] leading-snug",
          mine
            ? "bg-primary text-primary-foreground"
            : "bg-surface-sunken text-foreground",
          message.delivery === "sending" && "opacity-75",
        )}
      >
        <span className="sr-only">{senderName}: </span>
        {message.type === "DOCUMENT" ? (
          <span className="flex items-center gap-2 py-0.5">
            <FileText aria-hidden="true" size={16} className="shrink-0" />
            Shared a document
          </span>
        ) : (
          <p dir="auto" className="break-words whitespace-pre-wrap">
            {message.content}
          </p>
        )}
      </div>
      <span className="text-foreground-subtle mt-0.5 flex items-center gap-1 px-1 text-[10.5px]">
        <time dateTime={message.createdAt} suppressHydrationWarning>
          {formatTime(message.createdAt)}
        </time>
        {mine && shownStatus !== null && <StatusMark status={shownStatus} />}
      </span>
      {message.delivery === "failed" && (
        <p className="text-danger flex items-center gap-1 text-[11.5px]">
          <AlertCircle aria-hidden="true" size={12} />
          Not sent.
          <button
            type="button"
            onClick={() => onRetry(message.id)}
            className="cursor-pointer font-extrabold underline"
          >
            Retry
          </button>
        </p>
      )}
    </li>
  );
});

function StatusMark({ status }: { status: MessageStatus | "sending" | "failed" }) {
  const label = STATUS_LABELS[status];
  const Icon =
    status === "sending"
      ? Clock
      : status === "sent" || status === "failed"
        ? Check
        : CheckCheck;
  return (
    <span className="inline-flex items-center" title={label}>
      <Icon
        aria-hidden="true"
        size={13}
        strokeWidth={status === "read" ? 3 : 2}
        className={status === "read" ? "text-primary-ink" : undefined}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/* -------------------------------------------------------------------------- */

function Composer({
  conversationId,
  recipientName,
  onSend,
  onTyping,
}: {
  conversationId: string;
  recipientName: string;
  onSend: (content: string) => void;
  onTyping: (state: "start" | "stop") => void;
}) {
  const actions = useMessengerActions();
  // The draft survives minimising, closing the panel and moving between pages.
  const [draft, setDraftState] = useState(() => actions.getDraft(conversationId));
  const input = useRef<HTMLTextAreaElement>(null);
  const remaining = MESSAGE_MAX_LENGTH - draft.length;
  const inputId = `messenger-composer-${conversationId}`;

  const setDraft = (value: string) => {
    setDraftState(value);
    actions.setDraft(conversationId, value);
  };

  const resize = () => {
    const element = input.current;
    if (element === null) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  };

  const submit = () => {
    if (draft.trim() === "") return;
    onSend(draft);
    setDraft("");
    requestAnimationFrame(() => {
      resize();
      input.current?.focus();
    });
  };

  const insertEmoji = (emoji: string) => {
    const element = input.current;
    const start = element?.selectionStart ?? draft.length;
    const end = element?.selectionEnd ?? draft.length;
    const next = `${draft.slice(0, start)}${emoji}${draft.slice(end)}`;
    if (next.length > MESSAGE_MAX_LENGTH) return;
    setDraft(next);
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + emoji.length, start + emoji.length);
      resize();
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter is a new line; never interrupt an IME composition.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="border-border shrink-0 border-t px-2 py-2"
    >
      <div className="flex items-end gap-1">
        <EmojiPicker onPick={insertEmoji} />
        <label htmlFor={inputId} className="sr-only">
          Message {recipientName}
        </label>
        <textarea
          id={inputId}
          ref={input}
          value={draft}
          rows={1}
          maxLength={MESSAGE_MAX_LENGTH}
          dir="auto"
          placeholder="Aa"
          onChange={(event) => {
            setDraft(event.target.value);
            resize();
            onTyping(event.target.value.trim() === "" ? "stop" : "start");
          }}
          onBlur={() => onTyping("stop")}
          onKeyDown={onKeyDown}
          className="bg-surface-sunken text-foreground placeholder:text-foreground-subtle focus-visible:border-primary border-border max-h-28 min-h-9 flex-1 resize-none rounded-2xl border px-3 py-1.5 text-sm focus-visible:outline-offset-0"
        />
        <button
          type="submit"
          disabled={draft.trim() === ""}
          aria-label="Send message"
          className="text-primary-ink hover:bg-surface-hover grid size-9 shrink-0 cursor-pointer place-items-center rounded-full disabled:cursor-not-allowed disabled:opacity-40"
        >
          <SendHorizontal aria-hidden="true" size={19} />
        </button>
      </div>
      {remaining <= 200 && (
        <p aria-live="polite" className="text-foreground-muted mt-1 text-end text-[11px]">
          {remaining} characters left
        </p>
      )}
    </form>
  );
}
