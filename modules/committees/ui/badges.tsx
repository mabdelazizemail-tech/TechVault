import { PenLine, UserRound } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import {
  TASK_STATUS_LABELS,
  type Assignee,
  type TaskDisplayStatus,
} from "../contracts/types";
import { type ContributionTone, contributionDisplay } from "../domain/tasks";

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

/** The owner's colour code for names, on the theme's own tokens (light and dark). */
const CONTRIBUTION_CLASSES: Record<ContributionTone, string> = {
  info: "border-info bg-info-subtle text-info",
  success: "border-success bg-success-subtle text-success",
  warning: "border-warning bg-warning-subtle text-warning",
};

export function AssigneeChip({ assignee }: { assignee: Assignee }) {
  if (assignee.kind === "user") {
    const shown = contributionDisplay(assignee.contribution);
    const who = assignee.isActive
      ? "TechVault user"
      : "TechVault user (account inactive)";
    return (
      <span
        className={cn(
          "inline-flex max-w-full items-center gap-1 border px-1.5 py-0.5 text-xs font-semibold",
          shown === null
            ? "border-border text-foreground"
            : CONTRIBUTION_CLASSES[shown.tone],
        )}
        title={shown === null ? `${who} — nothing yet` : `${who} — ${shown.label}`}
      >
        <UserRound aria-hidden="true" className="size-3.5 shrink-0" />
        <span dir="auto" className="truncate">
          {assignee.name}
        </span>
        {shown !== null && <span className="sr-only">, {shown.label}</span>}
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

/** The key to the name colours, shown wherever coloured names appear. */
export function ContributionLegend({ className }: { className?: string }) {
  const items: { tone: ContributionTone; label: string }[] = [
    { tone: "info", label: "moved to In progress" },
    { tone: "success", label: "marked Completed" },
    { tone: "warning", label: "replied" },
  ];
  return (
    <p
      className={cn(
        "text-foreground-muted flex flex-wrap items-center gap-x-3 gap-y-1 text-xs",
        className,
      )}
    >
      <span>Name colours show who has taken part:</span>
      {items.map((item) => (
        <span key={item.tone} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={cn("size-3 border", CONTRIBUTION_CLASSES[item.tone])}
          />
          {item.label}
        </span>
      ))}
    </p>
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
