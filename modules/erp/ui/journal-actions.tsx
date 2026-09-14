"use client";

import { CheckCircle2, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Dialog, DialogActions } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/form-controls";
import { useToast } from "@/components/ui/toast";
import { formatMinorAmount } from "../domain/journal";
import { deleteJournalAction, postJournalAction, reverseJournalAction } from "./actions";
import { FormError, fieldError } from "./form-parts";

/**
 * The actions on a journal entry's page. Each asks for confirmation that names the
 * entry and its consequence (§17.4); the server decides whether it is allowed.
 */
export function JournalActions({
  entry,
  can,
  today,
}: {
  entry: {
    id: string;
    status: "DRAFT" | "POSTED" | "REVERSED";
    journalNumber: string | null;
    entryDate: string;
    isReversal: boolean;
    debitTotalMinor: number;
    creditTotalMinor: number;
  };
  can: { update: boolean; delete: boolean; post: boolean; reverse: boolean };
  today: string;
}) {
  if (entry.status === "DRAFT") {
    return (
      <>
        {can.update && (
          <ButtonLink
            href={`/erp/finance/journals/${entry.id}/edit`}
            icon={<Pencil aria-hidden="true" className="size-4" />}
          >
            Edit draft
          </ButtonLink>
        )}
        {can.delete && <DeleteDraftButton entryId={entry.id} />}
        {can.post && <PostButton entry={entry} />}
      </>
    );
  }
  if (entry.status === "POSTED" && !entry.isReversal && can.reverse) {
    return <ReverseButton entry={entry} today={today} />;
  }
  return null;
}

function PostButton({
  entry,
}: {
  entry: { id: string; debitTotalMinor: number; creditTotalMinor: number };
}) {
  const router = useRouter();
  const notify = useToast();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const balanced =
    entry.debitTotalMinor === entry.creditTotalMinor && entry.debitTotalMinor > 0;

  return (
    <>
      <Button
        variant="primary"
        icon={<CheckCircle2 aria-hidden="true" className="size-4" />}
        onClick={() => {
          setMessage(null);
          setOpen(true);
        }}
      >
        Post entry
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Post this journal entry?"
        description="Posting records it in the ledger and gives it a journal number. A posted entry can never be edited or deleted — only reversed."
      >
        {message !== null && <FormError message={message} />}
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="label-caps">Total debit</dt>
            <dd className="font-bold tabular-nums" dir="ltr">
              {formatMinorAmount(entry.debitTotalMinor)}
            </dd>
          </div>
          <div>
            <dt className="label-caps">Total credit</dt>
            <dd className="font-bold tabular-nums" dir="ltr">
              {formatMinorAmount(entry.creditTotalMinor)}
            </dd>
          </div>
        </dl>
        {!balanced && (
          <p className="text-danger mt-3 text-sm font-semibold">
            This entry does not balance, so posting will be refused.
          </p>
        )}
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            isPending={isPending}
            onClick={() =>
              startTransition(async () => {
                const result = await postJournalAction(entry.id);
                if (result.ok) {
                  setOpen(false);
                  notify(`Posted as ${result.data.journalNumber}.`);
                  router.refresh();
                } else {
                  setMessage(result.message);
                }
              })
            }
          >
            {isPending ? "Posting…" : "Post entry"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

function DeleteDraftButton({ entryId }: { entryId: string }) {
  const router = useRouter();
  const notify = useToast();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <>
      <Button
        icon={<Trash2 aria-hidden="true" className="size-4" />}
        onClick={() => {
          setMessage(null);
          setOpen(true);
        }}
      >
        Delete draft
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Delete this draft journal entry?"
        description="The draft and its lines are removed. It was never posted, so no ledger balance changes. The deletion is recorded in the audit trail."
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
                const result = await deleteJournalAction(entryId);
                if (result.ok) {
                  setOpen(false);
                  notify("Draft deleted.");
                  router.push("/erp/finance/journals");
                } else {
                  setMessage(result.message);
                }
              })
            }
          >
            {isPending ? "Deleting…" : "Delete draft"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

function ReverseButton({
  entry,
  today,
}: {
  entry: { id: string; journalNumber: string | null; entryDate: string };
  today: string;
}) {
  const router = useRouter();
  const notify = useToast();
  const [open, setOpen] = useState(false);
  const [reversalDate, setReversalDate] = useState(
    today < entry.entryDate ? entry.entryDate : today,
  );
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]> | undefined>();
  const [isPending, startTransition] = useTransition();

  return (
    <>
      <Button
        icon={<RotateCcw aria-hidden="true" className="size-4" />}
        onClick={() => {
          setMessage(null);
          setErrors(undefined);
          setOpen(true);
        }}
      >
        Reverse entry
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={`Reverse ${entry.journalNumber ?? "this entry"}?`}
        description="A new entry is posted with every debit and credit swapped, cancelling this one. The original stays in the ledger, marked reversed. This cannot be undone."
      >
        {message !== null && <FormError message={message} />}
        <div className="flex flex-col gap-4">
          <Field
            label="Reversal date"
            htmlFor="reversalDate"
            required
            hint="Must fall in an open accounting period."
            error={fieldError(errors, "reversalDate")}
          >
            <Input
              id="reversalDate"
              type="date"
              value={reversalDate}
              min={entry.entryDate}
              onChange={(event) => setReversalDate(event.target.value)}
            />
          </Field>
          <Field
            label="Description"
            htmlFor="reversalDescription"
            hint={`Defaults to "Reversal of ${entry.journalNumber ?? ""}".`}
            error={fieldError(errors, "description")}
          >
            <Textarea
              id="reversalDescription"
              value={description}
              maxLength={500}
              rows={2}
              dir="auto"
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
        </div>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="danger"
            isPending={isPending}
            onClick={() =>
              startTransition(async () => {
                const result = await reverseJournalAction(entry.id, {
                  reversalDate,
                  description,
                });
                if (result.ok) {
                  setOpen(false);
                  notify(`Reversed with ${result.data.journalNumber}.`);
                  router.push(`/erp/finance/journals/${result.data.reversalId}`);
                } else {
                  setMessage(result.message);
                  setErrors(result.fieldErrors);
                }
              })
            }
          >
            {isPending ? "Reversing…" : "Reverse entry"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
