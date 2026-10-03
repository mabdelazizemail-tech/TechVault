import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/button";
import { Pagination } from "@/components/ui/data-table";
import { EmptyState, PageHeader, Panel } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { getActor } from "@/platform/auth/current-user";
import { listNotifications } from "@/platform/notifications/notifications";
import { MarkAllReadButton, OpenNotificationLink, ToggleReadButton } from "./controls";

export const metadata: Metadata = { title: "Notifications" };

const dateTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Cairo",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * Every notification the signed-in person has received, newest first, with read
 * and unread kept as they left them. Personal: there is nobody else's to see.
 */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const unreadOnly = params.show === "unread";
  const pageParam = Number(Array.isArray(params.page) ? params.page[0] : params.page);
  const actor = await getActor();
  const result = await listNotifications(actor, {
    page: Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1,
    unreadOnly,
  });

  return (
    <div>
      <PageHeader
        title="Notifications"
        description="Tasks assigned to you and replies on tasks you own or are responsible for."
        actions={<MarkAllReadButton />}
      />

      <nav aria-label="Show" className="mb-3 flex gap-2">
        <ButtonLink
          href="/notifications"
          size="sm"
          variant={unreadOnly ? "secondary" : "primary"}
          aria-current={unreadOnly ? undefined : "page"}
        >
          All
        </ButtonLink>
        <ButtonLink
          href="/notifications?show=unread"
          size="sm"
          variant={unreadOnly ? "primary" : "secondary"}
          aria-current={unreadOnly ? "page" : undefined}
        >
          Unread
        </ButtonLink>
      </nav>

      <Panel>
        {result.rows.length === 0 ? (
          <EmptyState
            title={unreadOnly ? "You're all caught up" : "No notifications yet"}
            description="You are notified here when someone assigns you a committee task, or replies to a task you created or are responsible for."
          />
        ) : (
          <ul>
            {result.rows.map((item) => (
              <li
                key={item.id}
                className="border-border flex flex-wrap items-start gap-3 border-b px-4 py-3 last:border-0"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-1.5 size-2 shrink-0",
                    item.isRead ? "bg-transparent" : "bg-primary",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p
                    dir="auto"
                    className={cn("text-sm", item.isRead ? "font-medium" : "font-bold")}
                  >
                    {!item.isRead && <span className="sr-only">Unread: </span>}
                    <OpenNotificationLink
                      id={item.id}
                      href={item.link}
                      isRead={item.isRead}
                    >
                      {item.title}
                    </OpenNotificationLink>
                  </p>
                  <p dir="auto" className="text-foreground-muted mt-0.5 text-[13px]">
                    {item.body}
                  </p>
                  <p className="text-foreground-subtle mt-1 text-xs">
                    <time dateTime={item.createdAt.toISOString()}>
                      {dateTime.format(item.createdAt)}
                    </time>
                  </p>
                </div>
                <ToggleReadButton id={item.id} isRead={item.isRead} />
              </li>
            ))}
          </ul>
        )}
        {result.total > result.pageSize && (
          <Pagination
            page={{ page: result.page, pageSize: result.pageSize, total: result.total }}
            basePath="/notifications"
            searchParams={{ show: unreadOnly ? "unread" : undefined }}
          />
        )}
      </Panel>
    </div>
  );
}
