"use client";

import { Ban, Check, RotateCcw, Sparkles } from "lucide-react";
import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import {
  LEAD_PROGRESSION,
  LEAD_STATUS_LABELS,
  type LeadStatus,
} from "../contracts/types";
import { setLeadStatusAction } from "./actions";

/**
 * The lead's status progression: New → Contacted → Qualified → Converted.
 *
 * Clicking a step moves the lead there at once and persists behind the scenes; if
 * the server refuses, the bar returns to the saved status and says why. Converted
 * is never set directly — it is the result of the conversion screen.
 */
export function LeadStatusBar({
  leadId,
  status,
  canUpdate,
}: {
  leadId: string;
  status: LeadStatus;
  canUpdate: boolean;
}) {
  const [optimistic, setOptimistic] = useOptimistic(status);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const converted = optimistic === "CONVERTED";
  const disqualified = optimistic === "DISQUALIFIED";
  const editable = canUpdate && !converted;
  const currentIndex = LEAD_PROGRESSION.indexOf(optimistic);
  const convertHref = `/crm/leads/${leadId}/convert`;

  function change(next: Exclude<LeadStatus, "CONVERTED">) {
    if (!editable || next === optimistic) return;
    setError(null);
    startTransition(async () => {
      setOptimistic(next);
      const result = await setLeadStatusAction({ leadId, status: next });
      if (!result.ok) setError(result.message);
    });
  }

  return (
    <section aria-label="Lead status" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-stretch gap-2">
        <ol className="bg-border border-border grid min-w-0 flex-1 grid-cols-4 gap-px border">
          {LEAD_PROGRESSION.map((step, index) => {
            const isCurrent = step === optimistic;
            const isDone = !disqualified && index < currentIndex;
            const cell = cn(
              "flex h-full w-full min-w-0 items-center gap-2 px-2 py-2.5 text-start text-xs sm:px-3 sm:text-[13px]",
              isCurrent
                ? "bg-primary text-primary-foreground font-extrabold"
                : isDone
                  ? "bg-foreground text-canvas"
                  : "bg-surface text-foreground-muted",
              disqualified && "opacity-60",
            );
            const content = (
              <>
                <span
                  aria-hidden="true"
                  className="hidden size-5 shrink-0 place-items-center text-[11px] font-extrabold sm:grid"
                >
                  {isDone ? <Check size={13} strokeWidth={3} /> : index + 1}
                </span>
                <span className="truncate">{LEAD_STATUS_LABELS[step]}</span>
              </>
            );

            let control;
            if (step === "CONVERTED") {
              control =
                editable && !isCurrent ? (
                  <Link
                    href={convertHref}
                    className={cn(cell, "hover:bg-surface-hover hover:text-foreground")}
                    title="Convert this lead"
                  >
                    {content}
                  </Link>
                ) : (
                  <span className={cell}>{content}</span>
                );
            } else {
              control = (
                <button
                  type="button"
                  onClick={() => change(step)}
                  disabled={!editable || isPending}
                  aria-pressed={isCurrent}
                  className={cn(
                    cell,
                    editable && !isCurrent && "cursor-pointer",
                    editable &&
                      !isCurrent &&
                      !isDone &&
                      "hover:bg-surface-hover hover:text-foreground",
                  )}
                >
                  {content}
                </button>
              );
            }
            return (
              <li
                key={step}
                aria-current={isCurrent ? "step" : undefined}
                className="min-w-0"
              >
                {control}
              </li>
            );
          })}
        </ol>

        {editable &&
          (disqualified ? (
            <Button
              icon={<RotateCcw aria-hidden="true" size={14} />}
              onClick={() => change("NEW")}
              disabled={isPending}
            >
              Reopen
            </Button>
          ) : (
            <Button
              icon={<Ban aria-hidden="true" size={14} />}
              onClick={() => change("DISQUALIFIED")}
              disabled={isPending}
            >
              Disqualify
            </Button>
          ))}
      </div>

      {disqualified && (
        <p className="text-danger text-[13px]">
          This lead is disqualified. Reopen it to keep working it.
        </p>
      )}

      {optimistic === "QUALIFIED" && editable && (
        <div className="border-primary bg-primary-subtle flex flex-wrap items-center justify-between gap-2 border-s-3 px-3 py-2">
          <p className="text-foreground text-[13px]">
            Qualified — ready to become a company, a contact and an opportunity.
          </p>
          <ButtonLink
            href={convertHref}
            variant="primary"
            size="sm"
            icon={<Sparkles aria-hidden="true" size={14} />}
          >
            Convert lead
          </ButtonLink>
        </div>
      )}

      {error !== null && (
        <p role="alert" className="text-danger text-xs">
          The status was not changed: {error}
        </p>
      )}
    </section>
  );
}
