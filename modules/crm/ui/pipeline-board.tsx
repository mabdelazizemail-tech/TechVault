"use client";

import dynamic from "next/dynamic";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import { useOptimistic, useState, useTransition, type DragEvent } from "react";
import { cn } from "@/lib/cn";
import type {
  MoneyTotal,
  OpportunityListItem,
  PipelineColumn,
  StageDto,
} from "../contracts/types";
import { moveOpportunityAction } from "./actions";
import { STAGE_EDGE } from "./badges";
import type { CloseInput, PendingClose } from "./close-deal-dialog";
import { formatTotals } from "./format";
import { OpportunityCard } from "./opportunity-card";

// Loaded on first use: the closing forms carry the shared validation schemas,
// which most visits to this page never need.
const CloseDealDialog = dynamic(
  () => import("./close-deal-dialog").then((loaded) => loaded.CloseDealDialog),
  { ssr: false },
);

/**
 * The opportunity pipeline — the CRM's centrepiece.
 *
 * Desktop and tablet: a kanban board with native drag and drop. While a card is
 * dragged every other column is marked as a valid destination, the column under
 * the pointer shows exactly where the card will land, and the move is applied
 * optimistically and persisted. If the server refuses, `useOptimistic` returns the
 * board to the server's state on its own and the reason is announced.
 *
 * Phones: one stage at a time with stage tabs and a "Move to" picker on each card —
 * a board of seven 280px columns is unusable at 375px, and touch drag-and-drop is
 * unreliable.
 *
 * Drag and drop is never the only way: every card has a keyboard-accessible
 * "Move to" menu (§17.5).
 */

type Move = { opportunityId: string; toStageId: string };

export function PipelineBoard({
  columns,
  canMove,
}: {
  columns: PipelineColumn[];
  canMove: boolean;
}) {
  const [optimisticColumns, applyOptimisticMove] = useOptimistic(columns, applyMove);
  const [, startTransition] = useTransition();

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoverStageId, setHoverStageId] = useState<string | null>(null);
  const [pendingClose, setPendingClose] = useState<PendingClose | null>(null);
  const [lastMovedId, setLastMovedId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(
    null,
  );
  const [mobileStageId, setMobileStageId] = useState<string | null>(null);

  const stages = optimisticColumns.map((column) => column.stage);
  const sourceStageId =
    draggingId === null
      ? null
      : (optimisticColumns.find((column) =>
          column.cards.some((card) => card.id === draggingId),
        )?.stage.id ?? null);

  function findCard(id: string): OpportunityListItem | undefined {
    for (const column of optimisticColumns) {
      const card = column.cards.find((candidate) => candidate.id === id);
      if (card !== undefined) return card;
    }
    return undefined;
  }

  /** Entry point for every move: drag, menu or mobile picker. */
  function requestMove(cardId: string, stage: StageDto) {
    const card = findCard(cardId);
    if (card === undefined || card.stage.id === stage.id) return;
    if (stage.kind === "WON" || stage.kind === "LOST") {
      setPendingClose({ card, stage });
      return;
    }
    commitMove(card, stage, null);
  }

  function commitMove(
    card: OpportunityListItem,
    stage: StageDto,
    close: CloseInput | null,
  ) {
    setMessage(null);
    setLastMovedId(card.id);
    startTransition(async () => {
      applyOptimisticMove({ opportunityId: card.id, toStageId: stage.id });
      const result = await moveOpportunityAction({
        opportunityId: card.id,
        stageId: stage.id,
        close,
      });
      if (result.ok) {
        setMessage({ tone: "info", text: `Moved “${card.name}” to ${stage.name}.` });
      } else {
        setLastMovedId(null);
        setMessage({
          tone: "error",
          text: `“${card.name}” was not moved: ${result.message}`,
        });
      }
    });
  }

  function onDragStart(event: DragEvent<HTMLDivElement>, cardId: string) {
    event.dataTransfer.setData("text/plain", cardId);
    event.dataTransfer.effectAllowed = "move";
    setDraggingId(cardId);
    setMessage(null);
  }

  function onDragEnd() {
    setDraggingId(null);
    setHoverStageId(null);
  }

  function onDragOver(event: DragEvent<HTMLElement>, stageId: string) {
    if (draggingId === null || stageId === sourceStageId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (hoverStageId !== stageId) setHoverStageId(stageId);
  }

  function onDragLeave(event: DragEvent<HTMLElement>, stageId: string) {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    if (hoverStageId === stageId) setHoverStageId(null);
  }

  function onDrop(event: DragEvent<HTMLElement>, stage: StageDto) {
    event.preventDefault();
    const cardId = event.dataTransfer.getData("text/plain") || draggingId;
    setDraggingId(null);
    setHoverStageId(null);
    if (cardId !== null && cardId !== "") requestMove(cardId, stage);
  }

  const mobileColumn =
    optimisticColumns.find((column) => column.stage.id === mobileStageId) ??
    optimisticColumns.find((column) => column.count > 0) ??
    optimisticColumns[0];

  return (
    <div>
      <p
        role={message?.tone === "error" ? "alert" : "status"}
        aria-live="polite"
        className={cn(
          "min-h-0 text-[13px]",
          message !== null && "mb-3 border px-3 py-2",
          message?.tone === "error" && "border-danger/30 bg-danger-subtle text-danger",
          message?.tone === "info" && "border-border bg-surface text-foreground-muted",
        )}
      >
        {message?.text}
      </p>

      {/* Desktop and tablet: the board */}
      <div
        className="hidden snap-x gap-3 overflow-x-auto pb-4 md:flex"
        aria-label="Pipeline board"
      >
        {optimisticColumns.map((column) => {
          const isSource = column.stage.id === sourceStageId;
          const isValidTarget = draggingId !== null && !isSource;
          const isHovered = hoverStageId === column.stage.id;
          const dragged = draggingId !== null ? findCard(draggingId) : undefined;

          return (
            <section
              key={column.stage.id}
              aria-label={`${column.stage.name}: ${column.count} opportunities`}
              onDragOver={(event) => onDragOver(event, column.stage.id)}
              onDragLeave={(event) => onDragLeave(event, column.stage.id)}
              onDrop={(event) => onDrop(event, column.stage)}
              className={cn(
                "bg-surface-sunken flex w-[272px] shrink-0 snap-start flex-col transition-colors duration-150",
                isValidTarget &&
                  "outline-primary/40 outline-2 -outline-offset-2 outline-dashed",
                isHovered && "bg-primary-subtle outline-primary outline-solid",
              )}
            >
              <div className={cn("h-0.5", STAGE_EDGE[column.stage.kind])} />
              <header className="px-3 pt-2.5 pb-2">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="text-foreground text-[11px] tracking-[0.08em] uppercase">
                    {column.stage.name}
                  </h2>
                  <span className="text-foreground text-[13px] font-extrabold tabular-nums">
                    {column.count}
                  </span>
                </div>
                <p className="text-foreground-muted mt-0.5 truncate text-xs tabular-nums">
                  {formatTotals(column.totals, { empty: "No value" })}
                </p>
                {column.stage.kind !== "OPEN" && (
                  <p className="text-foreground-subtle text-[10.5px]">
                    Closed in the last 30 days
                  </p>
                )}
              </header>

              <div className="flex min-h-40 flex-1 flex-col gap-2 px-2 pb-3">
                {isHovered && dragged !== undefined && (
                  <div
                    aria-hidden="true"
                    className="border-primary text-primary-ink animate-tv-fade grid h-20 place-items-center border-2 border-dashed text-xs font-extrabold"
                  >
                    Drop to move to {column.stage.name}
                  </div>
                )}

                {column.cards.map((card) => (
                  <div
                    key={card.id}
                    draggable={canMove}
                    onDragStart={(event) => onDragStart(event, card.id)}
                    onDragEnd={onDragEnd}
                    className={cn(canMove && "cursor-grab active:cursor-grabbing")}
                  >
                    <OpportunityCard
                      card={card}
                      isDragging={draggingId === card.id}
                      isHighlighted={lastMovedId === card.id}
                      actions={
                        canMove ? (
                          <MoveMenu
                            card={card}
                            stages={stages}
                            onMove={(stage) => requestMove(card.id, stage)}
                          />
                        ) : undefined
                      }
                    />
                  </div>
                ))}

                {column.cards.length === 0 && !isHovered && (
                  <p className="text-foreground-subtle border-border grid h-20 place-items-center border border-dashed text-xs">
                    {draggingId !== null && isValidTarget
                      ? "Drop here"
                      : "No opportunities"}
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {/* Phones: one stage at a time */}
      <div className="md:hidden">
        <div
          role="tablist"
          aria-label="Pipeline stages"
          className="-mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1"
        >
          {optimisticColumns.map((column) => {
            const selected = column.stage.id === mobileColumn?.stage.id;
            return (
              <button
                key={column.stage.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setMobileStageId(column.stage.id)}
                className={cn(
                  "shrink-0 border px-3 py-1.5 text-xs whitespace-nowrap",
                  selected
                    ? "border-primary bg-primary text-primary-foreground font-extrabold"
                    : "border-border-strong text-foreground",
                )}
              >
                {column.stage.name} <span className="tabular-nums">{column.count}</span>
              </button>
            );
          })}
        </div>

        {mobileColumn !== undefined && (
          <div role="tabpanel" aria-label={mobileColumn.stage.name}>
            <p className="text-foreground-muted mb-2 text-xs tabular-nums">
              {mobileColumn.count} opportunities ·{" "}
              {formatTotals(mobileColumn.totals, { empty: "no value" })}
            </p>
            <ul className="flex flex-col gap-2">
              {mobileColumn.cards.map((card) => (
                <li key={card.id} className="flex flex-col gap-1.5">
                  <OpportunityCard card={card} isHighlighted={lastMovedId === card.id} />
                  {canMove && (
                    <label className="text-foreground-muted flex items-center gap-2 text-xs">
                      <span className="shrink-0">Move to</span>
                      <select
                        value={card.stage.id}
                        onChange={(event) => {
                          const stage = stages.find(
                            (candidate) => candidate.id === event.target.value,
                          );
                          if (stage !== undefined) requestMove(card.id, stage);
                        }}
                        className="bg-surface-sunken border-border-strong text-foreground min-h-9 flex-1 border px-2 text-sm"
                      >
                        {stages.map((stage) => (
                          <option key={stage.id} value={stage.id}>
                            {stage.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </li>
              ))}
              {mobileColumn.cards.length === 0 && (
                <li className="text-foreground-subtle border-border border border-dashed px-3 py-6 text-center text-xs">
                  No opportunities in {mobileColumn.stage.name}.
                </li>
              )}
            </ul>
          </div>
        )}
      </div>

      {pendingClose !== null && (
        <CloseDealDialog
          pending={pendingClose}
          onCancel={() => setPendingClose(null)}
          onConfirm={(close) => {
            commitMove(pendingClose.card, pendingClose.stage, close);
            setPendingClose(null);
          }}
        />
      )}
    </div>
  );
}

function MoveMenu({
  card,
  stages,
  onMove,
}: {
  card: OpportunityListItem;
  stages: StageDto[];
  onMove: (stage: StageDto) => void;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={`Move ${card.name} to another stage`}
        className="text-foreground-muted hover:bg-surface-hover hover:text-foreground grid size-7 cursor-pointer place-items-center opacity-70 group-hover:opacity-100 focus-visible:opacity-100"
      >
        <MoreHorizontal aria-hidden="true" size={16} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="border-border-strong bg-surface-raised z-50 min-w-44 border p-1 shadow-[0_12px_32px_color-mix(in_srgb,#2d2b2b_22%,transparent)]"
        >
          <DropdownMenu.Label className="text-foreground-subtle px-2 py-1 text-[10px] tracking-[0.08em] uppercase">
            Move to
          </DropdownMenu.Label>
          {stages
            .filter((stage) => stage.id !== card.stage.id)
            .map((stage) => (
              <DropdownMenu.Item
                key={stage.id}
                onSelect={() => onMove(stage)}
                className="text-foreground data-highlighted:bg-surface-hover cursor-pointer px-2 py-1.5 text-sm outline-none"
              >
                {stage.name}
              </DropdownMenu.Item>
            ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/* -------------------------------------------------------------------------- */
/* Optimistic state                                                           */
/* -------------------------------------------------------------------------- */

function applyMove(columns: PipelineColumn[], move: Move): PipelineColumn[] {
  const from = columns.find((column) =>
    column.cards.some((card) => card.id === move.opportunityId),
  );
  const card = from?.cards.find((candidate) => candidate.id === move.opportunityId);
  const to = columns.find((column) => column.stage.id === move.toStageId);
  if (from === undefined || card === undefined || to === undefined || from === to)
    return columns;

  const moved: OpportunityListItem = {
    ...card,
    stage: { id: to.stage.id, name: to.stage.name, kind: to.stage.kind },
    status: to.stage.kind,
    probability:
      to.stage.kind === "OPEN"
        ? to.stage.defaultProbability
        : to.stage.kind === "WON"
          ? 100
          : 0,
  };

  return columns.map((column) => {
    if (column.stage.id === from.stage.id) {
      return {
        ...column,
        count: column.count - 1,
        totals: adjustTotals(column.totals, card.currency, -card.amountMinor),
        cards: column.cards.filter((candidate) => candidate.id !== card.id),
      };
    }
    if (column.stage.id === to.stage.id) {
      return {
        ...column,
        count: column.count + 1,
        totals: adjustTotals(column.totals, card.currency, card.amountMinor),
        cards: [moved, ...column.cards],
      };
    }
    return column;
  });
}

function adjustTotals(
  totals: MoneyTotal[],
  currency: MoneyTotal["currency"],
  delta: number,
): MoneyTotal[] {
  const existing = totals.find((total) => total.currency === currency);
  const next =
    existing === undefined
      ? [...totals, { currency, amountMinor: delta }]
      : totals.map((total) =>
          total.currency === currency
            ? { ...total, amountMinor: total.amountMinor + delta }
            : total,
        );
  return next.filter((total) => total.amountMinor !== 0);
}
