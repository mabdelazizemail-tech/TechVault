import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { OpportunityListItem } from "../contracts/types";
import { Avatar, ChannelBadge } from "./badges";
import { formatMoney, formatShortDate } from "./format";

/**
 * A pipeline card: compact enough to see many deals at once, complete enough that
 * a salesperson rarely needs to open the deal just to know where it stands.
 *
 * The whole card is one link (a stretched title link), so it is a single tab stop;
 * `actions` renders above the link layer for the "Move to" menu.
 */
export function OpportunityCard({
  card,
  isDragging = false,
  isHighlighted = false,
  actions,
}: {
  card: OpportunityListItem;
  isDragging?: boolean;
  isHighlighted?: boolean;
  actions?: ReactNode;
}) {
  const closed = card.status !== "OPEN";

  return (
    <article
      className={cn(
        "bg-surface border-border group relative flex flex-col gap-2 border p-3 transition-[opacity,transform,box-shadow] duration-150",
        "hover:border-border-strong",
        card.priority === "HIGH" && !closed && "border-s-primary border-s-3",
        isDragging && "scale-[0.98] opacity-40",
        isHighlighted && "animate-tv-fade ring-primary ring-2",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 text-[13.5px] leading-snug font-extrabold">
          <Link
            href={`/crm/opportunities/${card.id}`}
            draggable={false}
            dir="auto"
            className="text-foreground line-clamp-2 after:absolute after:inset-0 hover:underline"
          >
            {card.name}
          </Link>
        </h3>
        {actions !== undefined && (
          <div className="relative z-10 -me-1 -mt-1 shrink-0">{actions}</div>
        )}
      </div>

      <p className="text-foreground-muted -mt-1 truncate text-xs" dir="auto">
        {card.account.name}
        {card.primaryContact !== null && <> · {card.primaryContact.name}</>}
      </p>

      {(card.product !== null || card.channel === "INDIRECT") && (
        <div className="flex flex-wrap gap-1">
          {card.product !== null && (
            <span
              className="text-primary-ink text-[10px] tracking-[0.06em] uppercase"
              dir="auto"
            >
              {card.product}
            </span>
          )}
          {card.channel === "INDIRECT" && (
            <ChannelBadge channel={card.channel} partnerName={card.partnerName} />
          )}
        </div>
      )}

      <div className="flex items-end justify-between gap-2">
        <span className="text-foreground text-[15px] font-extrabold tracking-[-0.01em] tabular-nums">
          {formatMoney(card.amountMinor, card.currency)}
        </span>
        <span
          className={cn(
            "text-xs font-extrabold tabular-nums",
            card.status === "WON"
              ? "text-success"
              : card.status === "LOST"
                ? "text-danger"
                : "text-foreground-muted",
          )}
          title="Probability"
        >
          {card.probability}%
        </span>
      </div>

      <div className="border-border text-foreground-muted flex items-center justify-between gap-2 border-t pt-2 text-[11px]">
        <span className="tabular-nums">
          {closed ? "Closed" : "Close"} {formatShortDate(card.closeDate)}
        </span>
        {card.owner !== null && (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate">{card.owner.name}</span>
            <Avatar name={card.owner.name} />
          </span>
        )}
      </div>
    </article>
  );
}
