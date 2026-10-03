import { NotFoundError, UnauthenticatedError } from "@/lib/errors";
import { prisma, type PrismaTransaction } from "@/lib/prisma";
import type { Actor } from "@/platform/authz/authz";
import { getPermissionSet } from "@/platform/iam/permission-loader";
import { BODY_MAX, TITLE_MAX, isAppPath, preview, recipientsFor } from "./rules";

/**
 * In-app notifications (CLAUDE.md §7, ADR-036).
 *
 * A module calls `notify` with the transaction of the change that caused it, the
 * way it calls `publish` for events: the notification commits or rolls back with
 * the change, so nobody is told about something that did not happen, and nothing
 * that did happen goes untold. Writing a few rows costs the transaction
 * milliseconds; delivery to the browser happens after commit, through a Realtime
 * signal raised by the table's trigger, and its failure cannot fail the write.
 *
 * The API is channel-agnostic: modules never choose "in-app" or "email". Today
 * only the in-app channel exists; e-mail would be added here, fed from the same
 * rows, without touching a module.
 *
 * Reading is personal — a person sees and marks only their own notifications — so
 * it needs no permission beyond being an active, signed-in user. A notification
 * grants nothing: opening its link is authorised again by the module that owns it.
 */

export type NotificationInput = {
  /** Dotted kind, e.g. "committees.task.replied". */
  type: string;
  module: string;
  entityType: string;
  entityId: string;
  /**
   * The record whose creation caused this notification (a task, a reply). With
   * the recipient and type it is unique, so retrying a write cannot notify twice.
   */
  sourceId: string;
  /** Who acted; never notified about their own action. Null for the system. */
  actorId: string | null;
  /** Candidates; duplicates and the actor are dropped, inactive accounts skipped. */
  recipientIds: readonly string[];
  title: string;
  body: string;
  /** An application path such as "/committees/meetings/…". */
  link: string;
};

/**
 * Writes one notification per distinct, active recipient other than the actor.
 * Returns how many were written. Must run inside the business transaction.
 */
export async function notify(
  tx: PrismaTransaction,
  input: NotificationInput,
): Promise<number> {
  if (!isAppPath(input.link)) {
    // A programming error, not a user's: links are built by modules, never typed.
    throw new Error(`Notification link must be an application path: ${input.type}`);
  }
  const candidates = recipientsFor(input.recipientIds, input.actorId);
  if (candidates.length === 0) return 0;

  const active = await tx.user.findMany({
    where: { id: { in: candidates }, isActive: true, deletedAt: null },
    select: { id: true },
  });
  if (active.length === 0) return 0;

  const title = preview(input.title, TITLE_MAX);
  const body = preview(input.body, BODY_MAX);
  const { count } = await tx.notification.createMany({
    data: active.map((recipient) => ({
      recipientId: recipient.id,
      type: input.type,
      module: input.module,
      entityType: input.entityType,
      entityId: input.entityId,
      sourceId: input.sourceId,
      actorId: input.actorId,
      title,
      body,
      link: input.link,
    })),
    skipDuplicates: true,
  });
  return count;
}

/* -------------------------------------------------------------------------- */
/* Reading and marking — one's own notifications only                         */
/* -------------------------------------------------------------------------- */

export type NotificationDto = {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string;
  actorName: string | null;
  createdAt: Date;
  isRead: boolean;
};

export type NotificationPage = {
  rows: NotificationDto[];
  total: number;
  page: number;
  pageSize: number;
};

export const NOTIFICATION_PAGE_SIZE = 25;
const SUMMARY_SIZE = 8;

const dtoSelect = {
  id: true,
  type: true,
  title: true,
  body: true,
  link: true,
  createdAt: true,
  readAt: true,
  actor: { select: { fullName: true, username: true, email: true } },
} as const;

type Row = {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string;
  createdAt: Date;
  readAt: Date | null;
  actor: { fullName: string | null; username: string | null; email: string } | null;
};

function toDto(row: Row): NotificationDto {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    link: row.link,
    actorName:
      row.actor === null
        ? null
        : (row.actor.fullName ?? row.actor.username ?? row.actor.email),
    createdAt: row.createdAt,
    isRead: row.readAt !== null,
  };
}

/** Active, signed-in users only: an inactive account reads nothing (§11.1). */
async function assertActive(actor: Actor): Promise<void> {
  const set = await getPermissionSet(actor.id);
  if (set === null || !set.principal.isActive) throw new UnauthenticatedError();
}

/** The bell: how many are unread, and the newest few. */
export async function getNotificationSummary(
  actor: Actor,
): Promise<{ unreadCount: number; latest: NotificationDto[] }> {
  await assertActive(actor);
  const [unreadCount, latest] = await Promise.all([
    prisma.notification.count({ where: { recipientId: actor.id, readAt: null } }),
    prisma.notification.findMany({
      where: { recipientId: actor.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: SUMMARY_SIZE,
      select: dtoSelect,
    }),
  ]);
  return { unreadCount, latest: latest.map(toDto) };
}

/** The notifications page, newest first, optionally unread only. */
export async function listNotifications(
  actor: Actor,
  params: { page?: number; unreadOnly?: boolean } = {},
): Promise<NotificationPage> {
  await assertActive(actor);
  const requested = params.page ?? 1;
  const page = Number.isInteger(requested) && requested > 0 ? requested : 1;
  const where = {
    recipientId: actor.id,
    ...(params.unreadOnly === true ? { readAt: null } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * NOTIFICATION_PAGE_SIZE,
      take: NOTIFICATION_PAGE_SIZE,
      select: dtoSelect,
    }),
  ]);
  return { rows: rows.map(toDto), total, page, pageSize: NOTIFICATION_PAGE_SIZE };
}

/**
 * Marks one of the actor's notifications read or unread. Someone else's
 * notification is "not found": its existence is not theirs to learn.
 */
export async function setNotificationRead(
  actor: Actor,
  notificationId: string,
  read: boolean,
): Promise<void> {
  await assertActive(actor);
  if (!/^[0-9a-f-]{36}$/i.test(notificationId)) throw new NotFoundError("notification");
  const { count } = await prisma.notification.updateMany({
    where: { id: notificationId, recipientId: actor.id },
    data: { readAt: read ? new Date() : null },
  });
  if (count === 0) throw new NotFoundError("notification");
}

/** Marks every unread notification of the actor read. Returns how many changed. */
export async function markAllNotificationsRead(actor: Actor): Promise<number> {
  await assertActive(actor);
  const { count } = await prisma.notification.updateMany({
    where: { recipientId: actor.id, readAt: null },
    data: { readAt: new Date() },
  });
  return count;
}
