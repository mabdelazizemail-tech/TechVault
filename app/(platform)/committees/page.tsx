import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader, Panel, PanelHeader } from "@/components/ui/primitives";
import {
  getTaskSummary,
  listSchedulableCommittees,
  listTasks,
  listUpcomingMeetings,
} from "@/modules/committees/contracts/service";
import { formatCalendarDate, formatDateTime } from "@/modules/committees/domain/format";
import { TaskStatusBadge } from "@/modules/committees/ui/badges";
import { NewMeetingButton } from "@/modules/committees/ui/meeting-form";
import { TaskSummaryTiles } from "@/modules/committees/ui/task-table";
import { getActor } from "@/platform/auth/current-user";
import { preview } from "@/platform/notifications/rules";

export const metadata: Metadata = { title: "Committees" };

/**
 * Committees at a glance: how the Team To-Do Lists stand, what is waiting on you,
 * and which meetings are coming up — all limited to the committees you can see.
 */
export default async function CommitteesOverviewPage() {
  const actor = await getActor();
  const [summary, mine, upcoming, schedulable] = await Promise.all([
    getTaskSummary(actor),
    listTasks(actor, { responsible: "me" }, { openOnly: true }),
    listUpcomingMeetings(actor, 6),
    listSchedulableCommittees(actor),
  ]);

  return (
    <div>
      <PageHeader
        title="Committees"
        description="Meetings, their agendas and the Team To-Do Lists that come out of them."
        actions={<NewMeetingButton committees={schedulable} />}
      />

      <section aria-label="Team To-Do List" className="mb-4">
        <TaskSummaryTiles
          summary={summary}
          href={(status) =>
            status === undefined
              ? "/committees/tasks"
              : `/committees/tasks?status=${status}`
          }
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader
            title="Waiting on you"
            actions={
              <Link
                href="/committees/tasks?responsible=me"
                className="text-primary-ink text-xs font-bold underline"
              >
                All my tasks
              </Link>
            }
          />
          {mine.rows.length === 0 ? (
            <EmptyState
              title="Nothing assigned to you"
              description="Tasks from committee meetings where you are responsible appear here until they are completed."
            />
          ) : (
            <ul className="divide-border divide-y">
              {mine.rows.slice(0, 8).map((task) => (
                <li key={task.id}>
                  <Link
                    href={`/committees/meetings/${task.meeting.id}/tasks/${task.id}`}
                    className="hover:bg-surface-hover flex items-start gap-3 px-4 py-3"
                  >
                    <span className="min-w-0 flex-1">
                      <span
                        dir="auto"
                        className="text-foreground block text-sm font-semibold"
                      >
                        {preview(task.description, 110)}
                      </span>
                      <span className="text-foreground-muted text-xs">
                        <span dir="auto">{task.meeting.title}</span> · due{" "}
                        {formatCalendarDate(task.dueDate)}
                      </span>
                    </span>
                    <TaskStatusBadge status={task.displayStatus} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <PanelHeader
            title="Upcoming meetings"
            actions={
              <Link
                href="/committees/meetings"
                className="text-primary-ink text-xs font-bold underline"
              >
                All meetings
              </Link>
            }
          />
          {upcoming.length === 0 ? (
            <EmptyState
              title="No meetings scheduled"
              description="Meetings of your committees appear here. A committee member can schedule one."
            />
          ) : (
            <ul className="divide-border divide-y">
              {upcoming.map((meeting) => (
                <li key={meeting.id}>
                  <Link
                    href={`/committees/meetings/${meeting.id}`}
                    className="hover:bg-surface-hover flex items-start gap-3 px-4 py-3"
                  >
                    <span className="min-w-0 flex-1">
                      <span
                        dir="auto"
                        className="text-foreground block text-sm font-semibold"
                      >
                        {meeting.title}
                      </span>
                      <span className="text-foreground-muted text-xs">
                        <span dir="auto">{meeting.committee.name}</span> ·{" "}
                        {formatDateTime(meeting.scheduledAt)}
                      </span>
                    </span>
                    <span className="text-foreground-muted shrink-0 text-xs tabular-nums">
                      {meeting.openTaskCount} open
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
