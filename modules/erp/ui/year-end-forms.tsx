"use client";

import { Lock, LockOpen } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/form-controls";
import { useToast } from "@/components/ui/toast";
import type { YearEndPreview } from "../contracts/types";
import { formatMinorAmount } from "../domain/journal";
import {
  closeFiscalYearAction,
  previewYearEndAction,
  reopenFiscalYearAction,
} from "./actions";
import { FormError, fieldError } from "./form-parts";

/**
 * Year-end close controls (ADR-028). The dialog shows the server's preview — the profit
 * or loss that will move and anything stopping the close — before anyone confirms.
 */
export function CloseYearButton({ year }: { year: number }) {
  const router = useRouter();
  const notify = useToast();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<YearEndPreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isChecking, startChecking] = useTransition();
  const [isPending, startTransition] = useTransition();
  const ready = preview !== null && preview.problems.length === 0;

  return (
    <>
      <Button
        size="sm"
        icon={<Lock aria-hidden="true" className="size-3.5" />}
        onClick={() => {
          setMessage(null);
          setPreview(null);
          setOpen(true);
          startChecking(async () => {
            const result = await previewYearEndAction(year);
            if (result.ok) setPreview(result.data);
            else setMessage(result.message);
          });
        }}
      >
        Close year
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={`Close fiscal year ${year}?`}
        description={`One entry dated 31 December ${year} brings every revenue and expense account to zero and moves the result into retained earnings. Nothing can then be posted into ${year} until the year is reopened.`}
      >
        {message !== null && <FormError message={message} />}
        {isChecking && (
          <p aria-live="polite" className="text-foreground-muted text-sm">
            Checking the year…
          </p>
        )}
        {preview !== null && preview.problems.length > 0 && (
          <div className="flex flex-col gap-2 text-sm">
            <p className="font-semibold">{year} cannot be closed yet:</p>
            <ul className="text-danger list-disc ps-5">
              {preview.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </div>
        )}
        {ready && (
          <p className="text-sm">
            {preview.accountCount === 0
              ? `No revenue or expenses moved in ${year}, so no entry is posted; the year is simply marked closed.`
              : `${preview.netIncomeMinor < 0 ? "A net loss" : "A net profit"} of ${formatMinorAmount(Math.abs(preview.netIncomeMinor))} EGP across ${preview.accountCount} revenue and expense ${preview.accountCount === 1 ? "account" : "accounts"} moves into ${preview.retainedEarningsAccount?.code ?? ""} — ${preview.retainedEarningsAccount?.name ?? ""}.`}
          </p>
        )}
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="danger"
            isPending={isPending}
            disabled={!ready}
            onClick={() =>
              startTransition(async () => {
                const result = await closeFiscalYearAction(year);
                if (result.ok) {
                  setOpen(false);
                  notify(
                    result.data.journalNumber === null
                      ? `${year} is closed.`
                      : `${year} is closed with ${result.data.journalNumber}.`,
                  );
                  router.refresh();
                } else {
                  setMessage(result.message);
                }
              })
            }
          >
            {isPending ? "Closing…" : "Close year"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

export function ReopenYearButton({ year }: { year: number }) {
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
        Reopen year
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={`Reopen fiscal year ${year}?`}
        description={`The year-end close is reversed on 31 December ${year} and posting into ${year} becomes possible again. Reopening a year is recorded in the audit trail at critical severity with your reason.`}
      >
        {message !== null && <FormError message={message} />}
        <Field
          label="Reason"
          htmlFor={`reopen-year-${year}`}
          required
          error={fieldError(errors, "reason")}
        >
          <Textarea
            id={`reopen-year-${year}`}
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
                const result = await reopenFiscalYearAction(year, reason);
                if (result.ok) {
                  setOpen(false);
                  setReason("");
                  notify(`${year} is open again.`);
                  router.refresh();
                } else {
                  setMessage(result.message);
                  setErrors(result.fieldErrors);
                }
              })
            }
          >
            {isPending ? "Reopening…" : "Reopen year"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
