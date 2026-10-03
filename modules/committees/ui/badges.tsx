import { PenLine, UserRound } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import {
  TASK_STATUS_LABELS,
  type Assignee,
  type TaskDisplayStatus,
} from "../contracts/types";

/**
 * Status and responsible-person presentation for Committees. The colour of a
 * status always comes with its word, so nothing is conveyed by colour alone
 * (§17.5).
 */

const STATUS_TONES: Record<TaskDisplayStatus, BadgeTone> = {
  PENDING: "neutral",
  IN_PROGRESS: "info",
  COMPLETED: "success",
  OVERDUE: "danger",
};

export function TaskStatusBadge({ status }: { status: TaskDisplayStatus }) {
  return <Badge tone={STATUS_TONES[status]}>{TASK_STATUS_LABELS[status]}</Badge>;
}

/**
 * The people responsible for a task. Registered users carry a person icon; names
 * typed in for people without an account carry a pen icon, a dashed outline and
 * the words "not registered", so the two can never be mistaken for each other.
 */
export function AssigneeList({
  assignees,
  compact = false,
}: {
  assignees: readonly Assignee[];
  compact?: boolean;
}) {
  if (assignees.length === 0) {
    return <span className="text-foreground-muted text-xs">Nobody yet</span>;
  }
  return (
    <ul
      className={cn("flex flex-wrap gap-1.5", compact && "justify-end md:justify-start")}
    >
      {assignees.map((assignee) => (
        <li key={assignee.id}>
          <AssigneeChip assignee={assignee} />
        </li>
      ))}
    </ul>
  );
}

export function AssigneeChip({ assignee }: { assignee: Assignee }) {
  if (assignee.kind === "user") {
    return (
      <span
        className="border-border text-foreground inline-flex max-w-full items-center gap-1 border px-1.5 py-0.5 text-xs font-semibold"
        title={assignee.isActive ? "TechVault user" : "TechVault user (account inactive)"}
      >
        <UserRound aria-hidden="true" className="size-3.5 shrink-0" />
        <span dir="auto" className="truncate">
          {assignee.name}
        </span>
        {!assignee.isActive && (
          <span className="text-foreground-muted font-normal">(inactive)</span>
        )}
      </span>
    );
  }
  return (
    <span
      className="border-border-strong text-foreground inline-flex max-w-full items-center gap-1 border border-dashed px-1.5 py-0.5 text-xs italic"
      title="Typed in: not a TechVault user, so not notified"
    >
      <PenLine aria-hidden="true" className="size-3.5 shrink-0" />
      <span dir="auto" className="truncate">
        {assignee.name}
      </span>
      <span className="text-foreground-muted not-italic">(not registered)</span>
    </span>
  );
}

export function FormError({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="border-danger/25 bg-danger-subtle text-danger border px-3 py-2 text-xs"
    >
      {message}
    </p>
  );
}
