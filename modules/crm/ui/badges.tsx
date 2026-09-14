import { Badge, type BadgeTone } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import {
  LEAD_STATUS_LABELS,
  PRIORITY_LABELS,
  SALES_CHANNEL_LABELS,
  type LeadStatus,
  type Priority,
  type SalesChannel,
  type StageKind,
} from "../contracts/types";

/**
 * CRM status vocabulary rendered consistently everywhere: the same status always
 * has the same colour, on every screen (§17.4). Colour is never the only signal —
 * every badge carries its word.
 */

const ACCENT = "bg-primary-subtle text-primary-ink";

const LEAD_STATUS_TONE: Record<LeadStatus, { tone: BadgeTone; className?: string }> = {
  NEW: { tone: "info" },
  CONTACTED: { tone: "warning" },
  QUALIFIED: { tone: "success" },
  CONVERTED: { tone: "neutral", className: ACCENT },
  DISQUALIFIED: { tone: "danger" },
};

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  const style = LEAD_STATUS_TONE[status];
  return (
    <Badge tone={style.tone} className={style.className}>
      {LEAD_STATUS_LABELS[status]}
    </Badge>
  );
}

const STAGE_TONE: Record<StageKind, BadgeTone> = {
  OPEN: "neutral",
  WON: "success",
  LOST: "danger",
};

export function StageBadge({ name, kind }: { name: string; kind: StageKind }) {
  return <Badge tone={STAGE_TONE[kind]}>{name}</Badge>;
}

/** The top edge colour of a pipeline column. */
export const STAGE_EDGE: Record<StageKind, string> = {
  OPEN: "bg-border-strong",
  WON: "bg-success",
  LOST: "bg-danger",
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  if (priority === "HIGH") {
    return (
      <Badge tone="neutral" className={ACCENT}>
        {PRIORITY_LABELS.HIGH}
      </Badge>
    );
  }
  return <Badge tone="neutral">{PRIORITY_LABELS[priority]}</Badge>;
}

export function ChannelBadge({
  channel,
  partnerName,
}: {
  channel: SalesChannel;
  partnerName: string | null;
}) {
  if (channel === "DIRECT")
    return <Badge tone="info">{SALES_CHANNEL_LABELS.DIRECT}</Badge>;
  return (
    <Badge tone="warning">
      <span dir="auto">
        {SALES_CHANNEL_LABELS.INDIRECT}
        {partnerName !== null && ` · ${partnerName}`}
      </span>
    </Badge>
  );
}

export function scoreLabel(score: number): string {
  if (score >= 75) return "Hot";
  if (score >= 45) return "Warm";
  return "Cold";
}

/** A lead score as a small bar with its number. */
export function ScoreMeter({ score, className }: { score: number; className?: string }) {
  const fill =
    score >= 75 ? "bg-primary" : score >= 45 ? "bg-warning" : "bg-foreground-subtle";
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span
        aria-hidden="true"
        className="bg-surface-sunken relative inline-block h-1.5 w-14 overflow-hidden"
      >
        <span
          className={cn("absolute inset-y-0 start-0", fill)}
          style={{ width: `${score}%` }}
        />
      </span>
      <span className="text-foreground text-[13px] font-extrabold tabular-nums">
        {score}
      </span>
      <span className="sr-only">out of 100, {scoreLabel(score)}</span>
    </span>
  );
}

/** A square initials avatar, as in the design system. */
export function Avatar({ name, size = "sm" }: { name: string; size?: "sm" | "md" }) {
  const parts = name.trim().split(/\s+/);
  const letters = `${parts[0]?.charAt(0) ?? "?"}${parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? "") : ""}`;
  return (
    <span
      aria-hidden="true"
      title={name}
      className={cn(
        "bg-foreground text-canvas grid shrink-0 place-items-center font-extrabold uppercase",
        size === "sm" ? "size-6 text-[10px]" : "size-9 text-xs",
      )}
    >
      {letters}
    </span>
  );
}
