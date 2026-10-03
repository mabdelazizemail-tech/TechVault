"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  markAllNotificationsReadAction,
  setNotificationReadAction,
} from "@/platform/notifications/actions";

/** Opens a notification's link, marking it read on the way. */
export function OpenNotificationLink({
  id,
  href,
  isRead,
  children,
}: {
  id: string;
  href: string;
  isRead: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={() => {
        if (!isRead) void setNotificationReadAction(id, true);
      }}
      className="text-foreground underline-offset-3 hover:underline"
    >
      {children}
    </Link>
  );
}

export function ToggleReadButton({ id, isRead }: { id: string; isRead: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      isPending={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await setNotificationReadAction(id, !isRead);
          if (!result.ok) toast(result.message, "error");
          router.refresh();
        })
      }
    >
      {isRead ? "Mark unread" : "Mark read"}
    </Button>
  );
}

export function MarkAllReadButton() {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      variant="secondary"
      isPending={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await markAllNotificationsReadAction();
          if (!result.ok) toast(result.message, "error");
          else
            toast(
              result.data === 0
                ? "Everything was already read."
                : `${result.data} marked as read.`,
            );
          router.refresh();
        })
      }
    >
      Mark all as read
    </Button>
  );
}
