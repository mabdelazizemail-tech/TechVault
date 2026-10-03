import { MessageSquare } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { DataTable, type Column, type SortState } from "@/components/ui/data-table";
import { StatCard } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { preview } from "@/platform/notifications/rules";
import type { Paginated, TaskListItem, TaskSummary } from "../contracts/types";
import { formatCalendarDate, formatDate } from "../domain/format";
import { AssigneeList, TaskStatusBadge } from "./badges";

/**
 * A Team To-Do List as a table (cards on phones): the task, who is responsible,
 * when it is due, its status and how much discussion it has. Server-rendered;
 * sorting and paging are URL state, applied by the database.
 */
export function TaskTable({
  page,
  basePath,
  searchParams,
  sort,
  showMeeting,
  emptyTitle,
  emptyDescription,
  emptyAction,
}: {
  page: Paginated<TaskListItem>;
  basePath: string;
  searchParams: Record<string, string | undefined>;
  sort?: SortState;
  /** Across meetings, each row also says which meeting it came from. */
  showMeeting: boolean;
  emptyTitle: string;
  emptyDescription: string;
  emptyAction?: ReactNode;
}) {
  const columns: Column<TaskListItem>[] = [
    {
      key: "task",
      header: "Task",
      cell: (task) => (
        <span dir="auto" className="block max-w-md">
          {preview(task.description, 140)}
        </span>
      ),
    },
    ...(showMeeting
      ? [
          {
            key: "meeting",
            header: "Meeting",
            hideOnMobile: true,
            cell: (task: TaskListItem) => (
              <span className="block min-w-36">
                <Link
                  href={`/committees/meetings/${task.meeting.id}?tab=todo`}
                  dir="auto"
                  className="text-foreground hover:underline"
                >
                  {task.meeting.title}
                </Link>
                <span className="text-foreground-muted block text-xs">
                  {task.meeting.committeeName} · {formatDate(task.meeting.scheduledAt)}
                </span>
              </span>
            ),
          } satisfies Column<TaskListItem>,
        ]
      : []),
    {
      key: "responsible",
      header: "Responsible",
      cell: (task) => <AssigneeList assignees={task.assignees} compact />,
    },
    {
      key: "due",
      header: "Due date",
      sortable: true,
      cell: (task) => (
        <span
          className={cn(
            "whitespace-nowrap",
            task.displayStatus === "OVERDUE" && "text-danger font-bold",
          )}
        >
          {formatCalendarDate(task.dueDate)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      cell: (task) => <TaskStatusBadge status={task.displayStatus} />,
    },
    {
      key: "replies",
      header: "Replies",
      align: "end",
      cell: (task) => (
        <span className="inline-flex items-center gap-1">
          <MessageSquare aria-hidden="true" className="text-foreground-muted size-3.5" />
          {task.replyCount}
          <span className="sr-only">{task.replyCount === 1 ? "reply" : "replies"}</span>
        </span>
      ),
    },
    {
      key: "created",
      header: "Created",
      sortable: true,
      hideOnMobile: true,
      cell: (task) => (
        <span className="text-foreground-muted text-xs whitespace-nowrap">
          <span dir="auto">{task.createdBy.name}</span>
          <br />
          {formatDate(task.createdAt)}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={page.rows}
      rowKey={(task) => task.id}
      rowHref={(task) => `/committees/meetings/${task.meeting.id}/tasks/${task.id}`}
      basePath={basePath}
      searchParams={searchParams}
      sort={sort}
      page={{ page: page.page, pageSize: page.pageSize, total: page.total }}
      emptyTitle={emptyTitle}
      emptyDescription={emptyDescription}
      emptyAction={emptyAction}
    />
  );
}

/**
 * The five figures — total, pending, in progress, completed, overdue — each a link
 * to the matching list. They add up: overdue tasks are counted once, as overdue.
 */
export function TaskSummaryTiles({
  summary,
  href,
}: {
  summary: TaskSummary;
  /** Builds the link for a status filter; undefined means "all". */
  href: (status: string | undefined) => string;
}) {
  const tiles = [
    { label: "Total tasks", value: summary.total, status: undefined },
    { label: "Pending", value: summary.pending, status: "PENDING" },
    { label: "In progress", value: summary.inProgress, status: "IN_PROGRESS" },
    { label: "Completed", value: summary.completed, status: "COMPLETED" },
    { label: "Overdue", value: summary.overdue, status: "OVERDUE" },
  ];
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((tile) => (
        <li
          key={tile.label}
          className={tile.status === undefined ? "col-span-2 sm:col-span-1" : ""}
        >
          <Link
            href={href(tile.status)}
            className="hover:[&>div]:bg-surface-hover block h-full"
          >
            <StatCard
              label={tile.label}
              value={
                tile.status === "OVERDUE" && tile.value > 0 ? (
                  <span className="text-danger">{tile.value}</span>
                ) : (
                  tile.value
                )
              }
              className="h-full"
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The table's sort, from URL values. */
export function taskSortFrom(
  params: Record<string, string | undefined>,
): SortState | undefined {
  const key = params.sort;
  if (key !== "due" && key !== "created" && key !== "status") return undefined;
  return { key, direction: params.dir === "desc" ? "desc" : "asc" };
}
