import Link from "next/link";
import { EmptyState } from "@/components/ui/primitives";
import type { OpportunityListItem } from "../contracts/types";
import { StageBadge } from "./badges";
import { formatDate, formatMoney } from "./format";

/** A compact list of a company's or contact's opportunities. */
export function RelatedOpportunities({
  opportunities,
  emptyDescription,
}: {
  opportunities: OpportunityListItem[];
  emptyDescription: string;
}) {
  if (opportunities.length === 0) {
    return <EmptyState title="No opportunities" description={emptyDescription} />;
  }
  return (
    <ul>
      {opportunities.map((opportunity) => (
        <li
          key={opportunity.id}
          className="border-border hover:bg-surface-hover relative flex items-center justify-between gap-3 border-b px-4 py-2.5 last:border-0"
        >
          <div className="min-w-0">
            <Link
              href={`/crm/opportunities/${opportunity.id}`}
              className="text-foreground block truncate text-[13.5px] font-extrabold after:absolute after:inset-0 hover:underline"
              dir="auto"
            >
              {opportunity.name}
            </Link>
            <p className="text-foreground-muted truncate text-xs">
              {opportunity.status === "OPEN" ? "Close" : "Closed"}{" "}
              {formatDate(opportunity.closeDate)}
              {opportunity.owner !== null && ` · ${opportunity.owner.name}`}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="text-foreground text-[13px] font-extrabold tabular-nums">
              {formatMoney(opportunity.amountMinor, opportunity.currency)}
            </span>
            <StageBadge name={opportunity.stage.name} kind={opportunity.stage.kind} />
          </div>
        </li>
      ))}
    </ul>
  );
}
