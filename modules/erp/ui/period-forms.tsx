"use client";

import { Lock, LockOpen, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/form-controls";
import { useToast } from "@/components/ui/toast";
import { closePeriodAction, createPeriodAction, reopenPeriodAction } from "./actions";
import { FormError, fieldError } from "./form-parts";

export function CreatePeriodButton() {
  const router = useRouter();
  const notify = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]> | undefined>();
  const [isPending, startTransition] = useTransition();

  return (
    <>
      <Button
        variant="primary"
        icon={<Plus aria-hidden="true" className="size-4" />}
        onClick={() => {
          setMessage(null);
          setErrors(undefined);
          setOpen(true);
        }}
      >
        New period
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="New accounting period"
        description="Periods cannot overlap. Any length works — a month, a quarter, a year."
      >
        {message !== null && <FormError message={message} />}
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setMessage(null);
            setErrors(undefined);
            startTransition(async () => {
              const result = await createPeriodAction({ name, startDate, endDate });
              if (result.ok) {
                setOpen(false);
                setName("");
                setStartDate("");
                setEndDate("");
                notify("Accounting period created.");
                router.refresh();
              } else {
                setMessage(result.message);
                setErrors(result.fieldErrors);
              }
            });
          }}
        >
          <Field
            label="Name"
            htmlFor="period-name"
            required
            error={fieldError(errors, "name")}
          >
            <Input
              id="period-name"
              value={name}
              maxLength={60}
              placeholder="September 2026"
              dir="auto"
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Start date"
              htmlFor="period-start"
              required
              error={fieldError(errors, "startDate")}
            >
              <Input
                id="period-start"
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </Field>
            <Field
              label="End date"
              htmlFor="period-end"
              required
              error={fieldError(errors, "endDate")}
            >
              <Input
                id="period-end"
                type="date"
                value={endDate}
                min={startDate === "" ? undefined : startDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </Field>
          </div>
          <DialogActions>
            <Button onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" isPending={isPending}>
              {isPending ? "Creating…" : "Create period"}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </>
  );
}

export function ClosePeriodButton({
  periodId,
  name,
}: {
  periodId: string;
  name: string;
}) {
  const router = useRouter();
  const notify = useToast();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <>
      <Button
        size="sm"
        icon={<Lock aria-hidden="true" className="size-3.5" />}
        onClick={() => {
          setMessage(null);
          setOpen(true);
        }}
      >
        Close
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={`Close ${name}?`}
        description="Nothing can be posted into a closed period, including reversals dated inside it. Reopening it later needs a separate permission and is audited."
      >
        {message !== null && <FormError message={message} />}
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="danger"
            isPending={isPending}
            onClick={() =>
              startTransition(async () => {
                const result = await closePeriodAction(periodId);
                if (result.ok) {
                  setOpen(false);
                  notify(`${name} is closed.`);
                  router.refresh();
                } else {
                  setMessage(result.message);
                }
              })
            }
          >
            {isPending ? "Closing…" : "Close period"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

export function ReopenPeriodButton({
  periodId,
  name,
}: {
  periodId: string;
  name: string;
}) {
  const router = useRouter();
  const notify = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]> | undefined>();
  const [isPending, startTransition] = useTransition();

  return (
    <>
      <Button
        size="sm"
        icon={<LockOpen aria-hidden="true" className="size-3.5" />}
        onClick={() => {
          setMessage(null);
          setErrors(undefined);
          setOpen(true);
        }}
      >
        Reopen
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={`Reopen ${name}?`}
        description="Posting into the period becomes possible again. Reopening a closed period is recorded in the audit trail at critical severity with your reason."
      >
        {message !== null && <FormError message={message} />}
        <Field
          label="Reason"
          htmlFor="reopen-reason"
          required
          error={fieldError(errors, "reason")}
        >
          <Textarea
            id="reopen-reason"
            value={reason}
            maxLength={500}
            rows={3}
            dir="auto"
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="danger"
            isPending={isPending}
            onClick={() =>
              startTransition(async () => {
                const result = await reopenPeriodAction(periodId, { reason });
                if (result.ok) {
                  setOpen(false);
                  setReason("");
                  notify(`${name} is open again.`);
                  router.refresh();
                } else {
                  setMessage(result.message);
                  setErrors(result.fieldErrors);
                }
              })
            }
          >
            {isPending ? "Reopening…" : "Reopen period"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
