"use client";

import { Check } from "lucide-react";
import { useOptimistic, useState, useTransition } from "react";
import { cn } from "@/lib/cn";
import type { OpportunityDetail, StageDto } from "../contracts/types";
import { moveOpportunityAction } from "./actions";
import { CloseDealDialog, type CloseInput, type PendingClose } from "./close-deal-dialog";

/**
 * The horizontal stage tracker on an opportunity. Open stages read left to right;
 * Won and Lost sit apart as explicit outcomes. Choosing a stage moves the deal the
 * same way dragging its card on the board does — the same action, the same
 * closing questions, the same timeline entry.
 */

const NOTCH = "12px";

function chevron(first: boolean): string {
  const tip = `calc(100% - ${NOTCH}) 0, 100% 50%, calc(100% - ${NOTCH}) 100%, 0 100%`;
  return first ? `polygon(0 0, ${tip})` : `polygon(0 0, ${tip}, ${NOTCH} 50%)`;
}

export function StageTracker({
  opportunity,
  stages,
  canMove,
}: {
  opportunity: OpportunityDetail;
  stages: StageDto[];
  canMove: boolean;
}) {
  const [stageId, setStageId] = useOptimistic(opportunity.stage.id);
  const [isPending, startTransition] = useTransition();
  const [pendingClose, setPendingClose] = useState<PendingClose | null>(null);
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(
    null,
  );

  const openStages = stages.filter((stage) => stage.kind === "OPEN");
  const closedStages = stages.filter((stage) => stage.kind !== "OPEN");
  const current = stages.find((stage) => stage.id === stageId);
  const openIndex = openStages.findIndex((stage) => stage.id === stageId);
  const isWon = current?.kind === "WON";

  function request(stage: StageDto) {
    if (!canMove || isPending || stage.id === stageId) return;
    if (stage.kind !== "OPEN") {
      setPendingClose({ card: opportunity, stage });
      return;
    }
    commit(stage, null);
  }

  function commit(stage: StageDto, close: CloseInput | null) {
    setMessage(null);
    startTransition(async () => {
      setStageId(stage.id);
      const result = await moveOpportunityAction({
        opportunityId: opportunity.id,
        stageId: stage.id,
        close,
      });
      setMessage(
        result.ok
          ? {
              tone: "info",
              text: `Moved to ${stage.name}. The change is on the timeline.`,
            }
          : { tone: "error", text: `The stage was not changed: ${result.message}` },
      );
    });
  }

  return (
    <section aria-label="Stage" className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 lg:flex-row">
        <ol className="flex min-w-0 flex-1 overflow-x-auto pb-0.5">
          {openStages.map((stage, index) => {
            const isCurrent = stage.id === stageId;
            const isDone = isWon || (openIndex >= 0 && index < openIndex);
            return (
              <li
                key={stage.id}
                aria-current={isCurrent ? "step" : undefined}
                className={cn("min-w-28 flex-1", index > 0 && "-ms-1.5")}
              >
                <button
                  type="button"
                  onClick={() => request(stage)}
                  disabled={!canMove || isPending}
                  title={canMove && !isCurrent ? `Move to ${stage.name}` : stage.name}
                  style={{ clipPath: chevron(index === 0) }}
                  className={cn(
                    "flex h-10 w-full items-center justify-center gap-1.5 ps-5 pe-4 text-[13px] whitespace-nowrap transition-colors",
                    isCurrent
                      ? "bg-primary text-primary-foreground font-extrabold"
                      : isDone
                        ? "bg-foreground text-canvas"
                        : "bg-surface-sunken text-foreground-muted",
                    canMove &&
                      !isCurrent &&
                      "enabled:hover:bg-surface-hover enabled:hover:text-foreground cursor-pointer",
                    "disabled:cursor-default",
                  )}
                >
                  {isDone && <Check aria-hidden="true" size={13} strokeWidth={3} />}
                  {stage.name}
                </button>
              </li>
            );
          })}
        </ol>

        <div className="flex gap-2">
          {closedStages.map((stage) => {
            const isCurrent = stage.id === stageId;
            const won = stage.kind === "WON";
            return (
              <button
                key={stage.id}
                type="button"
                onClick={() => request(stage)}
                disabled={!canMove || isPending}
                aria-pressed={isCurrent}
                className={cn(
                  "h-10 flex-1 border-2 px-4 text-[13px] font-extrabold whitespace-nowrap lg:flex-none",
                  won
                    ? isCurrent
                      ? "border-success bg-success text-primary-foreground"
                      : "border-success text-success enabled:hover:bg-success-subtle"
                    : isCurrent
                      ? "border-danger bg-danger text-primary-foreground"
                      : "border-danger text-danger enabled:hover:bg-danger-subtle",
                  canMove && !isCurrent ? "cursor-pointer" : "cursor-default",
                )}
              >
                {isCurrent ? stage.name : won ? "Mark won" : "Mark lost"}
              </button>
            );
          })}
        </div>
      </div>

      <p
        role={message?.tone === "error" ? "alert" : "status"}
        aria-live="polite"
        className={cn(
          "text-xs",
          message?.tone === "error" ? "text-danger" : "text-foreground-muted",
        )}
      >
        {message?.text}
      </p>

      <CloseDealDialog
        pending={pendingClose}
        onCancel={() => setPendingClose(null)}
        onConfirm={(close) => {
          if (pendingClose !== null) commit(pendingClose.stage, close);
          setPendingClose(null);
        }}
      />
    </section>
  );
}
