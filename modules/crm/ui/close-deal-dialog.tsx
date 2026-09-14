"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions } from "@/components/ui/dialog";
import {
  Field,
  Input,
  PillGroup,
  Textarea,
  describedBy,
} from "@/components/ui/form-controls";
import { closeLostSchema, closeWonSchema } from "../contracts/schemas";
import {
  LOST_REASONS,
  LOST_REASON_LABELS,
  type OpportunityListItem,
  type StageDto,
} from "../contracts/types";
import { toDateInputValue, toMajorInput } from "./format";

/**
 * The lightweight confirmation shown when a deal moves into Closed Won or Closed
 * Lost. It asks only what the record genuinely needs: the final value and date for
 * a win, the reason for a loss.
 */

export type CloseInput =
  | { kind: "WON"; actualCloseDate: string; finalAmount: string; notes: string }
  | { kind: "LOST"; lostReason: string; notes: string };

export type PendingClose = { card: OpportunityListItem; stage: StageDto };

export function CloseDealDialog({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: PendingClose | null;
  onCancel: () => void;
  onConfirm: (close: CloseInput) => void;
}) {
  const kind = pending?.stage.kind;
  const open = pending !== null && (kind === "WON" || kind === "LOST");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      title={kind === "WON" ? "Mark deal as won" : "Mark deal as lost"}
      description={pending?.card.name}
    >
      {pending !== null && kind === "WON" && (
        <WonForm
          key={pending.card.id}
          card={pending.card}
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
      )}
      {pending !== null && kind === "LOST" && (
        <LostForm key={pending.card.id} onCancel={onCancel} onConfirm={onConfirm} />
      )}
    </Dialog>
  );
}

function WonForm({
  card,
  onCancel,
  onConfirm,
}: {
  card: OpportunityListItem;
  onCancel: () => void;
  onConfirm: (close: CloseInput) => void;
}) {
  const [actualCloseDate, setActualCloseDate] = useState(() =>
    toDateInputValue(new Date()),
  );
  const [finalAmount, setFinalAmount] = useState(() => toMajorInput(card.amountMinor));
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = closeWonSchema.safeParse({
          kind: "WON",
          actualCloseDate,
          finalAmount,
          notes,
        });
        if (!parsed.success) {
          setErrors(
            Object.fromEntries(
              parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
            ),
          );
          return;
        }
        onConfirm({ kind: "WON", actualCloseDate, finalAmount, notes });
      }}
      className="flex flex-col gap-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Actual close date"
          htmlFor="won-date"
          required
          error={errors.actualCloseDate}
        >
          <Input
            id="won-date"
            type="date"
            value={actualCloseDate}
            onChange={(event) => setActualCloseDate(event.target.value)}
            invalid={errors.actualCloseDate !== undefined}
            aria-describedby={describedBy("won-date", errors.actualCloseDate)}
            required
          />
        </Field>
        <Field
          label={`Final deal value (${card.currency})`}
          htmlFor="won-amount"
          required
          error={errors.finalAmount}
        >
          <Input
            id="won-amount"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={finalAmount}
            onChange={(event) => setFinalAmount(event.target.value)}
            invalid={errors.finalAmount !== undefined}
            aria-describedby={describedBy("won-amount", errors.finalAmount)}
            required
          />
        </Field>
      </div>
      <Field
        label="Notes"
        htmlFor="won-notes"
        hint="Optional — terms, signatories, next steps."
      >
        <Textarea
          id="won-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          aria-describedby={describedBy("won-notes", null, "hint")}
        />
      </Field>
      <DialogActions>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary">
          Mark as won
        </Button>
      </DialogActions>
    </form>
  );
}

function LostForm({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: (close: CloseInput) => void;
}) {
  const [lostReason, setLostReason] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = closeLostSchema.safeParse({ kind: "LOST", lostReason, notes });
        if (!parsed.success) {
          setError("Choose why the deal was lost.");
          return;
        }
        onConfirm({ kind: "LOST", lostReason, notes });
      }}
      className="flex flex-col gap-3"
    >
      <PillGroup
        name="lost-reason"
        legend="Lost reason"
        required
        options={LOST_REASONS.map((reason) => ({
          value: reason,
          label: LOST_REASON_LABELS[reason],
        }))}
        value={lostReason}
        onValueChange={(value) => {
          setLostReason(value);
          setError(null);
        }}
        error={error}
      />
      <Field
        label="Notes"
        htmlFor="lost-notes"
        hint="Optional — what would have changed the outcome?"
      >
        <Textarea
          id="lost-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          aria-describedby="lost-notes-hint"
        />
      </Field>
      <DialogActions>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="danger">
          Mark as lost
        </Button>
      </DialogActions>
    </form>
  );
}
