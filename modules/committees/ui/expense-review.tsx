"use client";

import { CircleCheck, CircleX, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/form-controls";
import { useToast } from "@/components/ui/toast";
import { deleteExpenseAction, reviewExpenseAction } from "./actions";
import { FormError } from "./badges";

/**
 * Approving or rejecting a claim. Either decision is final and the submitter is
 * told, so each is confirmed in a dialog that names the claim (§17.4).
 */
export function ExpenseReview({
  expenseId,
  label,
}: {
  expenseId: string;
  /** "Dinner TRY 1,250.00 on Turkey Trip by Amr Hassouna". */
  label: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [note, setNote] = useState("");
  const [deciding, setDeciding] = useState<"APPROVED" | "REJECTED" | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-3">
      <Field
        label="Note to the submitter (optional)"
        htmlFor="review-note"
        hint="Shown with the decision — say why if you reject it."
      >
        <Textarea
          id="review-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          maxLength={1000}
          dir="auto"
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="primary"
          icon={<CircleCheck aria-hidden="true" size={16} />}
          onClick={() => setDeciding("APPROVED")}
        >
          Approve
        </Button>
        <Button
          variant="danger"
          icon={<CircleX aria-hidden="true" size={16} />}
          onClick={() => setDeciding("REJECTED")}
        >
          Reject
        </Button>
      </div>

      <Dialog
        open={deciding !== null}
        onOpenChange={(open) => {
          if (!open) setDeciding(null);
        }}
        title={deciding === "APPROVED" ? "Approve this expense?" : "Reject this expense?"}
        description={`${label}. The decision is final and the submitter is notified.`}
      >
        {formError !== null && <FormError message={formError} />}
        <DialogActions>
          <Button
            variant="secondary"
            onClick={() => setDeciding(null)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            variant={deciding === "APPROVED" ? "primary" : "danger"}
            isPending={isPending}
            onClick={() =>
              startTransition(async () => {
                if (deciding === null) return;
                const result = await reviewExpenseAction(expenseId, {
                  decision: deciding,
                  note,
                });
                if (!result.ok) {
                  setFormError(result.message);
                  return;
                }
                toast(
                  deciding === "APPROVED" ? "Expense approved." : "Expense rejected.",
                );
                setDeciding(null);
                router.refresh();
              })
            }
          >
            {deciding === "APPROVED" ? "Approve expense" : "Reject expense"}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}

/**
 * Deleting a claim (Committees administrators), whatever its status. Confirmed in a
 * dialog that names the claim and says what happens (§17.4).
 */
export function DeleteExpenseButton({
  expenseId,
  label,
  submitter,
}: {
  expenseId: string;
  /** "Dinner TRY 1,250.00 on Turkey Trip by Amr Hassouna". */
  label: string;
  submitter: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        icon={<Trash2 aria-hidden="true" size={14} />}
        onClick={() => setOpen(true)}
      >
        Delete
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Delete this expense?"
        description={`${label}. It disappears from every list and total, for everyone, and ${submitter} is notified. It stays on record in the audit trail.`}
      >
        {formError !== null && <FormError message={formError} />}
        <DialogActions>
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="danger"
            isPending={isPending}
            onClick={() =>
              startTransition(async () => {
                const result = await deleteExpenseAction(expenseId);
                if (!result.ok) {
                  setFormError(result.message);
                  return;
                }
                toast("Expense deleted.");
                setOpen(false);
                router.push("/committees/expenses");
              })
            }
          >
            {isPending ? "Deleting…" : "Delete expense"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
