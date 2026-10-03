import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BreadcrumbTitle } from "@/components/shell/breadcrumbs";
import { Panel, PanelHeader } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { getTask } from "@/modules/committees/contracts/service";
import { TASK_STATUS_LABELS } from "@/modules/committees/contracts/types";
import {
  formatCalendarDate,
  formatDate,
  formatDateTime,
  formatRelative,
} from "@/modules/committees/domain/format";
import { AssigneeList, TaskStatusBadge } from "@/modules/committees/ui/badges";
import { orNotFound } from "@/modules/committees/ui/page-helpers";
import { EditTaskButton } from "@/modules/committees/ui/task-form";
import {
  DeleteTaskButton,
  ReplyForm,
  StatusForm,
} from "@/modules/committees/ui/task-thread";
import { getActor } from "@/platform/auth/current-user";
import { preview } from "@/platform/notifications/rules";

export const metadata: Metadata = { title: "Task" };

/**
 * One task from a meeting's Team To-Do List: what, who, by when, its status, and
 * its whole discussion in order — replies and status changes alike, each with its
 * author and time. Each entry has an anchor, so a notification can link to it.
 */
export default async function TaskPage({
  params,
}: {
  params: Promise<{ id: string; taskId: string }>;
}) {
  const { id, taskId } = await params;
  const actor = await getActor();
  const task = await orNotFound(getTask(actor, taskId));
  // The URL names the meeting too; a task under the wrong meeting is not here.
  if (task.meeting.id !== id) notFound();

  const replyTotal = task.replyCount;

  return (
    <div>
      <BreadcrumbTitle segment={task.meeting.id} label={task.meeting.title} />
      <BreadcrumbTitle segment={task.id} label={preview(task.description, 48)} />

      <div className="flex flex-wrap items-start gap-4 pb-4">
        <div className="min-w-0 flex-1">
          <p className="label-caps">
            <Link
              href={`/committees/meetings/${task.meeting.id}?tab=todo`}
              className="hover:underline"
            >
              Team To-Do List · <span dir="auto">{task.meeting.title}</span>
            </Link>
          </p>
          <h1
            dir="auto"
            className="text-foreground mt-1 text-[22px] leading-snug font-bold whitespace-pre-line"
          >
            {task.description}
          </h1>
          <p className="text-foreground-muted mt-2 flex flex-wrap items-center gap-2 text-[12.5px]">
            <TaskStatusBadge status={task.displayStatus} />
            <span>
              Due{" "}
              <span
                className={cn(
                  task.displayStatus === "OVERDUE" && "text-danger font-bold",
                )}
              >
                {formatCalendarDate(task.dueDate)}
              </span>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Created by <span dir="auto">{task.createdBy.name}</span>,{" "}
              <time dateTime={task.createdAt.toISOString()}>
                {formatDateTime(task.createdAt)}
              </time>
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {task.rights.canEdit && (
            <EditTaskButton
              task={{
                id: task.id,
                description: task.description,
                dueDate: task.dueDate,
                assignees: task.assignees,
              }}
            />
          )}
          {task.rights.canDelete && (
            <DeleteTaskButton
              taskId={task.id}
              description={task.description}
              meetingId={task.meeting.id}
            />
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="overflow-hidden lg:col-span-2">
          <PanelHeader
            title={`Discussion (${replyTotal} ${replyTotal === 1 ? "reply" : "replies"})`}
          />
          {task.thread.length === 0 ? (
            <p className="text-foreground-muted px-5 py-4 text-[13px]">
              No replies yet. Post an update or a question below.
            </p>
          ) : (
            <ol>
              {task.thread.map((entry) => (
                <li
                  key={entry.id}
                  id={`reply-${entry.id}`}
                  className="border-border target:bg-surface-hover scroll-mt-24 border-b px-5 py-3 last:border-0"
                >
                  <p className="text-foreground-muted flex flex-wrap items-center gap-x-2 text-[12px]">
                    <span dir="auto" className="text-foreground font-extrabold">
                      {entry.author.name}
                    </span>
                    <time
                      dateTime={entry.createdAt.toISOString()}
                      title={formatDateTime(entry.createdAt)}
                    >
                      {formatRelative(entry.createdAt)}
                    </time>
                  </p>
                  {entry.statusFrom !== null && entry.statusTo !== null && (
                    <p className="text-foreground-muted mt-1 flex flex-wrap items-center gap-1.5 text-[12.5px]">
                      changed the status
                      <span className="sr-only">
                        from {TASK_STATUS_LABELS[entry.statusFrom]} to{" "}
                        {TASK_STATUS_LABELS[entry.statusTo]}
                      </span>
                      <span
                        aria-hidden="true"
                        className="inline-flex items-center gap-1.5"
                      >
                        <TaskStatusBadge status={entry.statusFrom} />
                        <ArrowRight className="size-3.5" />
                        <TaskStatusBadge status={entry.statusTo} />
                      </span>
                    </p>
                  )}
                  {entry.body !== null && (
                    <p
                      dir="auto"
                      className="text-foreground mt-1 text-[13.5px] whitespace-pre-line"
                    >
                      {entry.body}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
          {task.threadTruncated && (
            <p className="text-foreground-muted border-border border-t px-5 py-2 text-xs">
              This discussion is longer than one page shows; the first 500 entries are
              listed.
            </p>
          )}
          {task.rights.canReply && (
            <div className="border-border border-t px-5 py-4">
              <ReplyForm taskId={task.id} />
            </div>
          )}
        </Panel>

        <div className="flex h-fit flex-col gap-4">
          <Panel className="overflow-hidden">
            <PanelHeader title="Details" />
            <dl className="divide-border divide-y text-sm">
              <Fact label="Meeting">
                <Link
                  href={`/committees/meetings/${task.meeting.id}`}
                  className="text-primary-ink font-bold hover:underline"
                  dir="auto"
                >
                  {task.meeting.title}
                </Link>
                <span className="text-foreground-muted block text-xs">
                  <span dir="auto">{task.meeting.committeeName}</span> ·{" "}
                  {formatDateTime(task.meeting.scheduledAt)}
                </span>
              </Fact>
              <Fact label="Responsible">
                <AssigneeList assignees={task.assignees} />
              </Fact>
              <Fact label="Due date">{formatCalendarDate(task.dueDate)}</Fact>
              <Fact label="Status">
                <TaskStatusBadge status={task.displayStatus} />
                {task.displayStatus === "OVERDUE" && (
                  <span className="text-foreground-muted block text-xs">
                    Recorded as {TASK_STATUS_LABELS[task.status]}; past its due date.
                  </span>
                )}
              </Fact>
              {task.completedAt !== null && (
                <Fact label="Completed">{formatDate(task.completedAt)}</Fact>
              )}
              <Fact label="Created by">
                <span dir="auto">{task.createdBy.name}</span>
              </Fact>
              <Fact label="Created at">{formatDateTime(task.createdAt)}</Fact>
            </dl>
          </Panel>

          {task.rights.canChangeStatus && (
            <Panel className="overflow-hidden">
              <PanelHeader title="Update status" />
              <div className="px-4 py-4">
                <StatusForm taskId={task.id} current={task.status} />
              </div>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 px-4 py-2.5">
      <dt className="text-foreground-muted text-xs">{label}</dt>
      <dd className="text-foreground min-w-0">{children}</dd>
    </div>
  );
}
