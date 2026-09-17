"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { controlClasses } from "@/components/ui/form-controls";
import { cn } from "@/lib/cn";
import { LEAD_STATUSES, LEAD_STATUS_LABELS } from "../contracts/types";
import { bulkUpdateLeadsAction } from "./actions";
import { applySelection, distinctIds } from "./bulk-selection";

/**
 * Bulk status and owner changes for the leads table.
 *
 * The row checkboxes are rendered by the server-side DataTable and join this form
 * through their `form` attribute, so the selection is simply this form's FormData.
 * Each lead has two checkboxes — one in the table, one in the phone card — with
 * the same value, so ticking one ticks its twin, and the count and the ids sent
 * are distinct leads. The server de-duplicates too.
 */
export function LeadBulkActions({
  formId,
  owners,
}: {
  formId: string;
  owners: { id: string; name: string }[];
}) {
  const [count, setCount] = useState(0);
  const [status, setStatus] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(
    null,
  );
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const rowSelector = `input[type="checkbox"][form="${formId}"]`;
    const headerSelector = `input[data-select-all="${formId}"]`;
    const rows = () => [...document.querySelectorAll<HTMLInputElement>(rowSelector)];
    const headers = () => [
      ...document.querySelectorAll<HTMLInputElement>(headerSelector),
    ];

    // This component remounts on every navigation (it is keyed by the URL), so any
    // box still ticked from the previous view is cleared to match a count of zero.
    for (const box of rows()) box.checked = false;

    function onChange(event: Event) {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      let state;
      if (target.dataset.selectAll === formId) {
        state = applySelection(rows(), { kind: "all", checked: target.checked });
      } else if (target.getAttribute("form") === formId) {
        state = applySelection(rows(), {
          kind: "row",
          value: target.value,
          checked: target.checked,
        });
      } else {
        return;
      }
      setCount(state.selected);
      // The table header box and the phone "select all" box stay in step too.
      for (const header of headers()) {
        header.checked = state.total > 0 && state.selected === state.total;
        header.indeterminate = state.selected > 0 && state.selected < state.total;
      }
    }

    document.addEventListener("change", onChange);
    return () => document.removeEventListener("change", onChange);
  }, [formId]);

  function clearSelection() {
    const boxes = document.querySelectorAll<HTMLInputElement>(
      `input[type="checkbox"][form="${formId}"], input[data-select-all="${formId}"]`,
    );
    for (const box of boxes) {
      box.checked = false;
      box.indeterminate = false;
    }
    setCount(0);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Each lead's value is present twice (table and card); send it once.
    const leadIds = distinctIds(
      new FormData(event.currentTarget).getAll("leadIds").map(String),
    );
    setMessage(null);
    startTransition(async () => {
      const result = await bulkUpdateLeadsAction({
        leadIds,
        status: status === "" ? undefined : status,
        ownerId: ownerId === "" ? undefined : ownerId,
      });
      if (!result.ok) {
        setMessage({ tone: "error", text: result.message });
        return;
      }
      clearSelection();
      setStatus("");
      setOwnerId("");
      const { updated, skipped } = result.data;
      setMessage({
        tone: "info",
        text:
          `Updated ${updated} ${updated === 1 ? "lead" : "leads"}.` +
          (skipped > 0
            ? ` ${skipped} could not be changed (converted, or not yours to edit).`
            : ""),
      });
    });
  }

  const select = cn(
    controlClasses,
    "border-border-strong min-h-8 w-auto max-w-full cursor-pointer py-1 text-[13px] pointer-coarse:min-h-10",
  );

  return (
    <form
      id={formId}
      onSubmit={onSubmit}
      aria-label="Bulk actions"
      className="border-border bg-surface-sunken flex flex-wrap items-center gap-2 border-b px-3 py-2"
    >
      <p className="text-foreground min-w-24 text-[13px]" aria-live="polite">
        {count === 0 ? (
          <span className="text-foreground-muted">
            Select leads to update several at once.
          </span>
        ) : (
          <strong>{count} selected</strong>
        )}
      </p>
      {count > 0 && (
        <>
          <select
            aria-label="Set status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className={select}
          >
            <option value="">Set status…</option>
            {LEAD_STATUSES.filter((value) => value !== "CONVERTED").map((value) => (
              <option key={value} value={value}>
                {LEAD_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
          <select
            aria-label="Assign owner"
            value={ownerId}
            onChange={(event) => setOwnerId(event.target.value)}
            className={select}
          >
            <option value="">Assign owner…</option>
            {owners.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.name}
              </option>
            ))}
          </select>
          <Button
            type="submit"
            size="sm"
            variant="primary"
            disabled={status === "" && ownerId === ""}
            isPending={isPending}
          >
            Apply to {count}
          </Button>
          <Button size="sm" variant="ghost" onClick={clearSelection} disabled={isPending}>
            Clear
          </Button>
        </>
      )}
      {message !== null && (
        <p
          role={message.tone === "error" ? "alert" : "status"}
          className={cn(
            "basis-full text-xs",
            message.tone === "error" ? "text-danger" : "text-foreground-muted",
          )}
        >
          {message.text}
        </p>
      )}
    </form>
  );
}
