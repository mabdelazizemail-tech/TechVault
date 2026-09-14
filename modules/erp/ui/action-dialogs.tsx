"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { Dialog, DialogActions } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/form-controls";
import type { ActionResult } from "./actions";
import { FormError, fieldError } from "./form-parts";

/**
 * Confirmation dialogs for document actions (§17.4): each names what happens, and
 * shows the server's answer — the server alone decides whether the action is allowed.
 */

type Common<T> = {
  label: string;
  icon?: ReactNode;
  variant?: ButtonVariant;
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel: string;
  confirmVariant?: ButtonVariant;
  onSuccess: (data: T) => void;
};

export function ConfirmActionButton<T>({
  label,
  icon,
  variant = "secondary",
  title,
  description,
  confirmLabel,
  pendingLabel,
  confirmVariant = "primary",
  run,
  onSuccess,
  children,
}: Common<T> & { run: () => Promise<ActionResult<T>>; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <>
      <Button
        variant={variant}
        icon={icon}
        onClick={() => {
          setMessage(null);
          setOpen(true);
        }}
      >
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title={title} description={description}>
        {message !== null && <FormError message={message} />}
        {children}
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant={confirmVariant}
            isPending={isPending}
            onClick={() =>
              startTransition(async () => {
                const result = await run();
                if (result.ok) {
                  setOpen(false);
                  onSuccess(result.data);
                } else {
                  setMessage(result.message);
                }
              })
            }
          >
            {isPending ? pendingLabel : confirmLabel}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

/** An action that needs a reason, and optionally a date (e.g. the date of a void entry). */
export function ReasonActionButton<T>({
  label,
  icon,
  variant = "secondary",
  title,
  description,
  confirmLabel,
  pendingLabel,
  confirmVariant = "danger",
  dateLabel,
  defaultDate,
  minDate,
  run,
  onSuccess,
}: Common<T> & {
  dateLabel?: string;
  defaultDate?: string;
  minDate?: string;
  run: (reason: string, date: string) => Promise<ActionResult<T>>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(defaultDate ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]> | undefined>();
  const [isPending, startTransition] = useTransition();

  return (
    <>
      <Button
        variant={variant}
        icon={icon}
        onClick={() => {
          setMessage(null);
          setErrors(undefined);
          setOpen(true);
        }}
      >
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title={title} description={description}>
        {message !== null && <FormError message={message} />}
        <div className="flex flex-col gap-4">
          {dateLabel !== undefined && (
            <Field
              label={dateLabel}
              htmlFor="action-date"
              required
              hint="Must fall in an open accounting period."
              error={fieldError(errors, "voidDate")}
            >
              <Input
                id="action-date"
                type="date"
                value={date}
                min={minDate}
                onChange={(event) => setDate(event.target.value)}
              />
            </Field>
          )}
          <Field
            label="Reason"
            htmlFor="action-reason"
            required
            error={fieldError(errors, "reason")}
          >
            <Textarea
              id="action-reason"
              value={reason}
              maxLength={500}
              rows={3}
              dir="auto"
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
        </div>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant={confirmVariant}
            isPending={isPending}
            onClick={() =>
              startTransition(async () => {
                const result = await run(reason, date);
                if (result.ok) {
                  setOpen(false);
                  setReason("");
                  onSuccess(result.data);
                } else {
                  setMessage(result.message);
                  setErrors(result.fieldErrors);
                }
              })
            }
          >
            {isPending ? pendingLabel : confirmLabel}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
