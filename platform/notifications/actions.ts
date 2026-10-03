"use server";

import { revalidatePath } from "next/cache";
import { isAppError } from "@/lib/errors";
import { getActor } from "@/platform/auth/current-user";
import { logger, newCorrelationId } from "@/platform/observability/logger";
import {
  getNotificationSummary,
  markAllNotificationsRead,
  setNotificationRead,
  type NotificationDto,
} from "./notifications";

/**
 * Server Actions for the notification bell and page: authenticate, delegate,
 * report. The service decides; these only translate (CLAUDE.md §9).
 */

export type NotificationActionResult<T = null> =
  { ok: true; data: T } | { ok: false; message: string };

async function run<T>(
  operation: string,
  work: () => Promise<T>,
): Promise<NotificationActionResult<T>> {
  try {
    return { ok: true, data: await work() };
  } catch (error) {
    if (isAppError(error)) return { ok: false, message: error.message };
    const traceId = newCorrelationId();
    logger.error("Notification action failed", {
      module: "platform",
      operation,
      traceId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, message: `Something went wrong. Reference: ${traceId}` };
  }
}

export async function getNotificationSummaryAction(): Promise<
  NotificationActionResult<{ unreadCount: number; latest: NotificationDto[] }>
> {
  return run("notifications.summary", async () =>
    getNotificationSummary(await getActor()),
  );
}

export async function setNotificationReadAction(
  notificationId: string,
  read: boolean,
): Promise<NotificationActionResult> {
  return run("notifications.mark", async () => {
    await setNotificationRead(await getActor(), notificationId, read);
    revalidatePath("/notifications");
    return null;
  });
}

export async function markAllNotificationsReadAction(): Promise<
  NotificationActionResult<number>
> {
  return run("notifications.mark_all", async () => {
    const count = await markAllNotificationsRead(await getActor());
    revalidatePath("/notifications");
    return count;
  });
}
