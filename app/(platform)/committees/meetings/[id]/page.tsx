import { CalendarDays, MapPin, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { BreadcrumbTitle } from "@/components/shell/breadcrumbs";
import { FilterBar } from "@/components/ui/filter-bar";
import { Panel, PanelHeader } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import {
  getMeeting,
  getTaskSummary,
  listMeetingAssignees,
  listTasks,
} from "@/modules/committees/contracts/service";
import { formatDateTime } from "@/modules/committees/domain/format";
import { AgendaEditor } from "@/modules/committees/ui/agenda-editor";
import {
  DeleteMeetingButton,
  EditMeetingButton,
} from "@/modules/committees/ui/meeting-form";
import {
  flatParams,
  orNotFound,
  taskFilterSelects,
} from "@/modules/committees/ui/page-helpers";
import { NewTaskButton } from "@/modules/committees/ui/task-form";
import {
  TaskSummaryTiles,
  TaskTable,
  taskSortFrom,
} from "@/modules/committees/ui/task-table";
import { getActor } from "@/platform/auth/current-user";

export const metadata: Metadata = { title: "Meeting" };

/**
 * One committee meeting: when and where, who runs it and who sits on it, and two
 * tabs — its agenda, and its Team To-Do List of action items. Tabs and filters are
 * URL state, so a filtered to-do list can be shared as a link.
 */
export default async function MeetingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, raw] = await Promise.all([params, searchParams]);
  const query = flatParams(raw);
  const tab = query.tab === "todo" ? "todo" : "agenda";
  const actor = await getActor();
  const meeting = await orNotFound(getMeeting(actor, id));
  const base = `/committees/meetings/${meeting.id}`;
  const meetingLabel = `${meeting.title} · ${formatDateTime(meeting.scheduledAt)}`;

  const [tasks, summary, assignees] =
    tab === "todo"
      ? await Promise.all([
          listTasks(actor, query, { meetingId: meeting.id }),
          getTaskSummary(actor, { meetingId: meeting.id }),
          listMeetingAssignees(actor, meeting.id),
        ])
      : [null, null, null];

  const tableParams = {
    tab: "todo",
    q: query.q,
    status: query.status,
    responsible: query.responsible,
    due: query.due,
    sort: query.sort,
    dir: query.dir,
  };

  return (
    <div>
      <BreadcrumbTitle segment={meeting.id} label={meeting.title} />

      <div className="flex flex-wrap items-start gap-4 pb-4">
        <div className="min-w-0 flex-1">
          <p className="label-caps">
            <Link
              href={`/committees/groups/${meeting.committee.id}`}
              className="hover:underline"
              dir="auto"
            >
              {meeting.committee.name}
            </Link>
          </p>
          <h1
            dir="auto"
            className="text-foreground mt-1 text-[28px] leading-tight font-bold"
          >
            {meeting.title}
          </h1>
          <ul className="text-foreground-muted mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
            <li className="inline-flex items-center gap-1.5">
              <CalendarDays aria-hidden="true" className="size-4" />
              <time dateTime={meeting.scheduledAt.toISOString()}>
                {formatDateTime(meeting.scheduledAt)}
              </time>
            </li>
            {meeting.location !== null && (
              <li className="inline-flex items-center gap-1.5">
                <MapPin aria-hidden="true" className="size-4" />
                <span dir="auto">{meeting.location}</span>
              </li>
            )}
            <li className="inline-flex items-center gap-1.5">
              <UserRound aria-hidden="true" className="size-4" />
              <span>
                Organised by <span dir="auto">{meeting.organizer.name}</span>
              </span>
            </li>
          </ul>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {meeting.rights.canEdit && (
            <EditMeetingButton
              meeting={{
                id: meeting.id,
                committeeId: meeting.committee.id,
                title: meeting.title,
                scheduledAt: meeting.scheduledAt,
                location: meeting.location,
                description: meeting.description,
              }}
            />
          )}
          {meeting.rights.canDelete && (
            <DeleteMeetingButton
              meetingId={meeting.id}
              title={meeting.title}
              taskCount={meeting.taskCount}
            />
          )}
        </div>
      </div>

      <nav
        aria-label="Meeting sections"
        className="border-border-strong mb-4 flex gap-5 overflow-x-auto border-b-2"
      >
        {[
          { key: "agenda", label: "Agenda", href: base },
          {
            key: "todo",
            label: `Team To-Do List (${meeting.openTaskCount} open)`,
            href: `${base}?tab=todo`,
          },
        ].map((item) => (
          <Link
            key={item.key}
            href={item.href}
            aria-current={item.key === tab ? "page" : undefined}
            className={cn(
              "-mb-0.5 border-b-2 pb-2 text-[13px] whitespace-nowrap",
              item.key === tab
                ? "border-primary text-foreground font-extrabold"
                : "text-foreground-muted hover:text-foreground border-transparent",
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {tab === "agenda" ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="flex flex-col gap-4 lg:col-span-2">
            {meeting.description !== null && (
              <Panel className="px-5 py-4">
                <p className="label-caps mb-1">Purpose</p>
                <p
                  dir="auto"
                  className="text-foreground text-[14px] leading-relaxed whitespace-pre-line"
                >
                  {meeting.description}
                </p>
              </Panel>
            )}
            <Panel className="overflow-hidden">
              <PanelHeader title={`Agenda (${meeting.agenda.length})`} />
              <AgendaEditor
                meetingId={meeting.id}
                items={meeting.agenda}
                canEdit={meeting.rights.canEdit}
              />
            </Panel>
          </div>
          <Panel className="h-fit overflow-hidden">
            <PanelHeader title={`Members (${meeting.members.length})`} />
            {meeting.members.length === 0 ? (
              <p className="text-foreground-muted px-4 py-3 text-sm">
                This committee has no members yet.
              </p>
            ) : (
              <ul className="divide-border divide-y">
                {meeting.members.map((member) => (
                  <li
                    key={member.id}
                    dir="auto"
                    className="text-foreground px-4 py-2 text-sm"
                  >
                    {member.name}
                    {member.id === meeting.organizer.id && (
                      <span className="text-foreground-muted ms-1.5 text-xs">
                        organiser
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      ) : (
        tasks !== null &&
        summary !== null && (
          <div className="flex flex-col gap-4">
            <TaskSummaryTiles
              summary={summary}
              href={(status) =>
                status === undefined
                  ? `${base}?tab=todo`
                  : `${base}?tab=todo&status=${status}`
              }
            />
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <FilterBar
                  basePath={base}
                  query={query.q}
                  searchLabel="Search tasks or people"
                  preserve={{ tab: "todo", sort: query.sort, dir: query.dir }}
                  selects={taskFilterSelects(query, assignees)}
                />
              </div>
              {meeting.rights.canAddTask && (
                <NewTaskButton meetingId={meeting.id} meetingLabel={meetingLabel} />
              )}
            </div>
            <Panel>
              <TaskTable
                page={tasks}
                basePath={base}
                searchParams={tableParams}
                sort={taskSortFrom(query)}
                showMeeting={false}
                emptyTitle={summary.total === 0 ? "No tasks yet" : "No tasks match"}
                emptyDescription={
                  summary.total === 0
                    ? "Record the action items agreed in this meeting: what needs doing, who is responsible, and by when."
                    : "No task matches these filters. Clear them to see the whole list."
                }
                emptyAction={
                  summary.total === 0 && meeting.rights.canAddTask ? (
                    <NewTaskButton meetingId={meeting.id} meetingLabel={meetingLabel} />
                  ) : undefined
                }
              />
            </Panel>
          </div>
        )
      )}
    </div>
  );
}
