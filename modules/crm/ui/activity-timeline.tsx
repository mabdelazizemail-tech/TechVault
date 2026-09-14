import Link from "next/link";
import {
  ArrowRightLeft,
  CalendarClock,
  Flag,
  ListChecks,
  Mail,
  Phone,
  StickyNote,
  type LucideIcon,
} from "lucide-react";
import { EmptyState } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import {
  ACTIVITY_TYPE_LABELS,
  type ActivityDto,
  type ActivityType,
} from "../contracts/types";
import { PriorityBadge } from "./badges";
import { formatDateTime, formatRelative, isPast } from "./format";
import { recordHref } from "./links";
import { TaskToggle } from "./task-toggle";

/**
 * A record's activity timeline: calls, emails, meetings, notes, tasks, and the
 * status and stage changes the CRM writes itself — newest first.
 */

const TYPE_ICON: Record<ActivityType, LucideIcon> = {
  CALL: Phone,
  EMAIL: Mail,
  MEETING: CalendarClock,
  TASK: ListChecks,
  NOTE: StickyNote,
  STATUS_CHANGE: Flag,
  STAGE_CHANGE: ArrowRightLeft,
};

export function ActivityTimeline({
  activities,
  currentRecordId,
  canCompleteTasks,
  emptyAction,
}: {
  activities: ActivityDto[];
  /** Hidden from the "related" chips, since the reader is already on it. */
  currentRecordId?: string;
  canCompleteTasks: boolean;
  emptyAction?: React.ReactNode;
}) {
  if (activities.length === 0) {
    return (
      <EmptyState
        title="No activity yet"
        description="Calls, emails, meetings, notes and tasks logged here build the history of this relationship."
        action={emptyAction}
      />
    );
  }

  return (
    <ol className="flex flex-col">
      {activities.map((activity) => (
        <TimelineItem
          key={activity.id}
          activity={activity}
          currentRecordId={currentRecordId}
          canCompleteTasks={canCompleteTasks}
        />
      ))}
    </ol>
  );
}

export function TimelineItem({
  activity,
  currentRecordId,
  canCompleteTasks,
}: {
  activity: ActivityDto;
  currentRecordId?: string;
  canCompleteTasks: boolean;
}) {
  const Icon = TYPE_ICON[activity.type];
  const isSystem = activity.type === "STATUS_CHANGE" || activity.type === "STAGE_CHANGE";
  const isTask = activity.type === "TASK";
  const isDone = isTask && activity.completedAt !== null;
  const overdue = isTask && !isDone && activity.dueAt !== null && isPast(activity.dueAt);
  const related = activity.related.filter((ref) => ref.id !== currentRecordId);

  return (
    <li className="border-border relative flex gap-3 border-b px-4 py-3 last:border-0">
      <span
        aria-hidden="true"
        className={cn(
          "grid size-8 shrink-0 place-items-center",
          isSystem
            ? "bg-surface-sunken text-foreground-muted"
            : "bg-foreground text-canvas",
          activity.type === "TASK" && "bg-primary-subtle text-primary-ink",
        )}
      >
        <Icon size={15} strokeWidth={2} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <p
            className={cn(
              "text-foreground text-[13.5px]",
              isSystem ? "font-normal" : "font-extrabold",
              isDone && "text-foreground-muted line-through",
            )}
            dir="auto"
          >
            {activity.subject}
          </p>
          <time
            dateTime={activity.occurredAt.toISOString()}
            title={formatDateTime(activity.occurredAt)}
            className="text-foreground-subtle shrink-0 text-[11px]"
          >
            {formatDateTime(activity.occurredAt)}
          </time>
        </div>

        <p className="text-foreground-muted mt-0.5 text-[11.5px]">
          {ACTIVITY_TYPE_LABELS[activity.type]}
          {activity.durationMinutes !== null && ` · ${activity.durationMinutes} min`}
          {activity.creator !== null && ` · ${activity.creator.name}`}
        </p>

        {activity.body !== null && (
          <p
            className="text-foreground mt-1.5 text-[13px] whitespace-pre-line"
            dir="auto"
          >
            {activity.body}
          </p>
        )}

        {isTask && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            {canCompleteTasks ? (
              <TaskToggle
                activityId={activity.id}
                completed={isDone}
                subject={activity.subject}
              />
            ) : (
              <span className="text-foreground-muted">{isDone ? "Done" : "Open"}</span>
            )}
            {activity.dueAt !== null && (
              <span
                className={cn(
                  "tabular-nums",
                  overdue ? "text-danger font-extrabold" : "text-foreground-muted",
                )}
              >
                Due {formatRelative(activity.dueAt)}
              </span>
            )}
            {activity.priority !== null && <PriorityBadge priority={activity.priority} />}
            {activity.assignee !== null && (
              <span className="text-foreground-muted">
                Assigned to {activity.assignee.name}
              </span>
            )}
          </div>
        )}

        {related.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {related.map((ref) => (
              <li key={`${ref.kind}-${ref.id}`}>
                <Link
                  href={recordHref(ref)}
                  className="border-border text-foreground-muted hover:text-foreground hover:border-border-strong inline-flex items-center border px-1.5 py-0.5 text-[11px]"
                  dir="auto"
                >
                  {ref.label}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}
