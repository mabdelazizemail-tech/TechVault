"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Bell } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import {
  getNotificationSummaryAction,
  markAllNotificationsReadAction,
  setNotificationReadAction,
} from "@/platform/notifications/actions";
import type { NotificationDto } from "@/platform/notifications/notifications";

/**
 * The notification bell (CLAUDE.md §16.2, ADR-036): the unread count, the newest
 * notifications, and a way to the full list.
 *
 * It loads once the browser is idle, then listens on the person's private
 * Realtime topic, `platform:user:<id>`, for "a notification arrived" — an id only.
 * On a signal it re-reads the summary through a Server Action, which authorises
 * the read, and shows a toast. Realtime is a convenience: the bell also refreshes
 * when it is opened and when the window regains focus, so it is right without it.
 */

type Summary = { unreadCount: number; latest: NotificationDto[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export function NotificationBell({ userId }: { userId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async (): Promise<Summary | null> => {
    const result = await getNotificationSummaryAction();
    if (!result.ok) return null;
    setSummary(result.data);
    return result.data;
  }, []);

  useEffect(() => {
    let stopped = false;
    let leave: (() => Promise<void>) | null = null;

    const onSignal = (payload: unknown) => {
      const id = isRecord(payload) && typeof payload.id === "string" ? payload.id : null;
      if (timer.current !== null) clearTimeout(timer.current);
      // A burst of signals (a task assigned to you in a busy meeting) settles first.
      timer.current = setTimeout(() => {
        timer.current = null;
        void refresh().then((next) => {
          const arrived = next?.latest.find((item) => item.id === id);
          if (arrived !== undefined && !stopped) {
            toast(arrived.title, "info", { label: "Open", href: arrived.link });
          }
        });
      }, 300);
    };

    async function start() {
      void refresh();
      const { openPrivateChannel } = await import("@/platform/realtime/browser");
      if (stopped) return;
      const channel = await openPrivateChannel(`platform:user:${userId}`, (ch) => {
        ch.on("broadcast", { event: "notification.created" }, ({ payload }) =>
          onSignal(payload),
        );
      });
      if (stopped) void channel.leave();
      else leave = channel.leave;
    }

    const begin = () => {
      // Without Realtime the bell still works by refreshing; nothing to report.
      start().catch(() => undefined);
    };
    const idle =
      typeof window.requestIdleCallback === "function"
        ? {
            id: window.requestIdleCallback(begin, { timeout: 2500 }),
            kind: "idle" as const,
          }
        : { id: window.setTimeout(begin, 600), kind: "timeout" as const };

    const onFocus = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      stopped = true;
      if (idle.kind === "idle") window.cancelIdleCallback(idle.id);
      else window.clearTimeout(idle.id);
      if (timer.current !== null) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onFocus);
      if (leave !== null) void leave();
    };
  }, [userId, refresh, toast]);

  const unread = summary?.unreadCount ?? 0;
  const label =
    unread === 0
      ? "Notifications"
      : `Notifications, ${unread > 99 ? "99+" : unread} unread`;

  const openNotification = (item: NotificationDto) => {
    if (!item.isRead) {
      setSummary((current) =>
        current === null
          ? current
          : {
              unreadCount: Math.max(0, current.unreadCount - 1),
              latest: current.latest.map((entry) =>
                entry.id === item.id ? { ...entry, isRead: true } : entry,
              ),
            },
      );
      void setNotificationReadAction(item.id, true);
    }
    router.push(item.link);
  };

  return (
    <DropdownMenu.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void refresh();
      }}
    >
      <DropdownMenu.Trigger
        aria-label={label}
        className="border-border text-foreground hover:bg-surface-hover relative grid size-9 shrink-0 cursor-pointer place-items-center border-2 pointer-coarse:size-11"
      >
        <Bell aria-hidden="true" className="size-4" />
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="bg-primary text-primary-foreground absolute -end-1.5 -top-1.5 min-w-4.5 px-1 text-center text-[10px] leading-4.5 font-bold tabular-nums"
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="panel z-50 flex max-h-[min(32rem,80dvh)] w-[min(24rem,calc(100vw-1rem))] flex-col"
        >
          <div className="rule-b flex items-center justify-between gap-2 px-3 py-2">
            <p className="text-foreground text-sm font-bold tracking-tight uppercase">
              Notifications
            </p>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => {
                  setSummary((current) =>
                    current === null
                      ? current
                      : {
                          unreadCount: 0,
                          latest: current.latest.map((entry) => ({
                            ...entry,
                            isRead: true,
                          })),
                        },
                  );
                  void markAllNotificationsReadAction().then(() => refresh());
                }}
                className="text-primary-ink cursor-pointer text-xs font-bold hover:underline pointer-coarse:min-h-10"
              >
                Mark all as read
              </button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {summary === null ? (
              <p className="text-foreground-muted px-3 py-4 text-sm">Loading…</p>
            ) : summary.latest.length === 0 ? (
              <p className="text-foreground-muted px-3 py-4 text-sm">
                Nothing yet. You&apos;ll be told here when someone assigns you a task or
                replies to one.
              </p>
            ) : (
              summary.latest.map((item) => (
                <DropdownMenu.Item
                  key={item.id}
                  onSelect={() => openNotification(item)}
                  className="border-border data-highlighted:bg-surface-hover flex cursor-pointer gap-2.5 border-b px-3 py-2.5 outline-none last:border-0"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-1.5 size-2 shrink-0",
                      item.isRead ? "bg-transparent" : "bg-primary",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      dir="auto"
                      className={cn(
                        "text-foreground block text-[13px]",
                        item.isRead ? "font-medium" : "font-bold",
                      )}
                    >
                      {!item.isRead && <span className="sr-only">Unread: </span>}
                      {item.title}
                    </span>
                    <span
                      dir="auto"
                      className="text-foreground-muted mt-0.5 line-clamp-2 block text-xs"
                    >
                      {item.body}
                    </span>
                    <span className="text-foreground-subtle mt-0.5 block text-[11px]">
                      <RelativeTime date={item.createdAt} />
                    </span>
                  </span>
                </DropdownMenu.Item>
              ))
            )}
          </div>

          <div className="rule-t px-3 py-2">
            <DropdownMenu.Item asChild>
              <Link
                href="/notifications"
                className="text-primary-ink data-highlighted:bg-surface-hover block text-xs font-bold outline-none hover:underline pointer-coarse:py-2"
              >
                See all notifications →
              </Link>
            </DropdownMenu.Item>
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function RelativeTime({ date }: { date: Date }) {
  const value = new Date(date);
  return <time dateTime={value.toISOString()}>{relative(value)}</time>;
}

function relative(date: Date, now: Date = new Date()): string {
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Cairo",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}
