"use client";

import { Banknote, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { applySelection, distinctIds } from "@/components/ui/bulk-selection";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/form-controls";
import { useToast } from "@/components/ui/toast";
import { formatExpenseAmount } from "../domain/expenses";
import { markExpensesPaidAction, undoExpensePaymentAction } from "./actions";
import { FormError } from "./badges";

/**
 * Recording that approved expenses have been paid (ADR-040): select claims on the
 * list and mark them in one go, or mark one from its page. Either way a dialog shows
 * what the chosen claims add up to — currency by currency, never summed across —
 * before anything is recorded. A payment recorded by mistake is cleared with a reason.
 */

/** An approved, unpaid claim as the payment dialog shows it. */
export type PayableExpense = {
  id: string;
  /** "Visa USD 40.00 · Mohamed Abdelaziz". */
  label: string;
  amountMinor: number;
  currency: string;
};

/** "EGP 159,234.00 · USD 77.05". */
function totalsText(claims: readonly PayableExpense[]): string {
  const sums = new Map<string, number>();
  for (const claim of claims) {
    sums.set(claim.currency, (sums.get(claim.currency) ?? 0) + claim.amountMinor);
  }
  return [...sums]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, minor]) => formatExpenseAmount(minor, currency))
    .join(" · ");
}

const SHOWN_IN_DIALOG = 5;

function PaymentDialog({
  claims,
  today,
  onClose,
  onPaid,
}: {
  /** The claims to mark; the dialog is open while this is not null. */
  claims: PayableExpense[] | null;
  /** Today in Cairo, YYYY-MM-DD: the default payment date. */
  today: string;
  onClose: () => void;
  onPaid: (count: number) => void;
}) {
  const [paidOn, setPaidOn] = useState(today);
  const [reference, setReference] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const count = claims?.length ?? 0;

  return (
    <Dialog
      open={claims !== null}
      onOpenChange={(open) => {
        if (!open && !isPending) onClose();
      }}
      title={
        count === 1 ? "Mark this expense as paid?" : `Mark ${count} expenses as paid?`
      }
      description={
        claims === null
          ? undefined
          : `${totalsText(claims)}. The people who claimed them are told.`
      }
    >
      {claims !== null && (
        <ul className="border-border divide-border mb-3 divide-y border text-sm">
          {claims.slice(0, SHOWN_IN_DIALOG).map((claim) => (
            <li key={claim.id} dir="auto" className="text-foreground px-3 py-1.5">
              {claim.label}
            </li>
          ))}
          {claims.length > SHOWN_IN_DIALOG && (
            <li className="text-foreground-muted px-3 py-1.5 text-xs">
              and {claims.length - SHOWN_IN_DIALOG} more
            </li>
          )}
        </ul>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Paid on" htmlFor="paid-on" required error={errors.paidOn}>
          <Input
            id="paid-on"
            type="date"
            value={paidOn}
            max={today}
            onChange={(event) => setPaidOn(event.target.value)}
            invalid={errors.paidOn !== undefined}
            className="min-h-11 text-base"
          />
        </Field>
        <Field
          label="Reference (optional)"
          htmlFor="paid-reference"
          hint="A transfer number, “Cash”…"
          error={errors.reference}
        >
          <Input
            id="paid-reference"
            value={reference}
            maxLength={200}
            onChange={(event) => setReference(event.target.value)}
            invalid={errors.reference !== undefined}
            dir="auto"
            className="min-h-11 text-base"
          />
        </Field>
      </div>
      {formError !== null && <FormError message={formError} />}
      <DialogActions>
        <Button variant="secondary" onClick={onClose} disabled={isPending}>
          Cancel
        </Button>
        <Button
          variant="primary"
          icon={<Banknote aria-hidden="true" size={16} />}
          isPending={isPending}
          onClick={() =>
            startTransition(async () => {
              if (claims === null) return;
              setErrors({});
              setFormError(null);
              const result = await markExpensesPaidAction({
                expenseIds: claims.map((claim) => claim.id),
                paidOn,
                reference,
              });
              if (!result.ok) {
                const fields: Record<string, string> = {};
                for (const [field, messages] of Object.entries(
                  result.fieldErrors ?? {},
                )) {
                  if (messages[0] !== undefined) fields[field] = messages[0];
                }
                setErrors(fields);
                setFormError(result.message);
                return;
              }
              onPaid(result.data.paid);
            })
          }
        >
          {count === 1 ? "Mark as paid" : `Mark ${count} as paid`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * The list's bulk bar. The checkboxes come from the server-rendered DataTable and join
 * this form through their `form` attribute; each claim has two (table and phone card)
 * with the same value, kept in step, and sent once.
 */
export function ExpensePaymentBar({
  formId,
  today,
  payable,
}: {
  formId: string;
  today: string;
  /** The approved, unpaid claims on this page — the only rows with a checkbox. */
  payable: PayableExpense[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [count, setCount] = useState(0);
  const [chosen, setChosen] = useState<PayableExpense[] | null>(null);

  useEffect(() => {
    const rowSelector = `input[type="checkbox"][form="${formId}"]`;
    const headerSelector = `input[data-select-all="${formId}"]`;
    const rows = () => [...document.querySelectorAll<HTMLInputElement>(rowSelector)];
    const headers = () => [
      ...document.querySelectorAll<HTMLInputElement>(headerSelector),
    ];

    // Keyed by the URL, so this remounts on every navigation: clear what was ticked.
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

  return (
    <>
      <form
        id={formId}
        aria-label="Mark expenses as paid"
        onSubmit={(event) => {
          event.preventDefault();
          const ids = distinctIds(
            new FormData(event.currentTarget).getAll("expenseIds").map(String),
          );
          const byId = new Map(payable.map((claim) => [claim.id, claim]));
          const claims = ids.flatMap((id) => byId.get(id) ?? []);
          if (claims.length > 0) setChosen(claims);
        }}
        className="border-border bg-surface-sunken flex flex-wrap items-center gap-2 border-b px-3 py-2"
      >
        <p className="text-foreground min-w-24 text-[13px]" aria-live="polite">
          {count === 0 ? (
            <span className="text-foreground-muted">
              Select approved expenses to mark them as paid.
            </span>
          ) : (
            <strong>{count} selected</strong>
          )}
        </p>
        {count > 0 && (
          <>
            <Button
              type="submit"
              size="sm"
              variant="primary"
              icon={<Banknote aria-hidden="true" size={15} />}
            >
              Mark as paid
            </Button>
            <Button size="sm" variant="ghost" onClick={clearSelection}>
              Clear
            </Button>
          </>
        )}
      </form>
      <PaymentDialog
        key={chosen?.map((claim) => claim.id).join() ?? "closed"}
        claims={chosen}
        today={today}
        onClose={() => setChosen(null)}
        onPaid={(paid) => {
          toast(
            paid === 1 ? "Expense marked as paid." : `${paid} expenses marked as paid.`,
          );
          setChosen(null);
          clearSelection();
          router.refresh();
        }}
      />
    </>
  );
}

/** "Mark as paid" on a claim's own page. */
export function MarkPaidButton({
  expense,
  today,
}: {
  expense: PayableExpense;
  today: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="primary"
        icon={<Banknote aria-hidden="true" size={16} />}
        onClick={() => setOpen(true)}
      >
        Mark as paid
      </Button>
      <PaymentDialog
        key={open ? "open" : "closed"}
        claims={open ? [expense] : null}
        today={today}
        onClose={() => setOpen(false)}
        onPaid={() => {
          toast("Expense marked as paid.");
          setOpen(false);
          router.refresh();
        }}
      />
    </>
  );
}

/** Clears a payment recorded by mistake; the reason goes to the audit trail. */
export function UndoPaymentButton({
  expenseId,
  label,
}: {
  expenseId: string;
  /** "Visa USD 40.00 on Turkey Trip by Mohamed Abdelaziz". */
  label: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        icon={<Undo2 aria-hidden="true" size={14} />}
        onClick={() => {
          setReason("");
          setError(null);
          setOpen(true);
        }}
      >
        Mark as not paid
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!isPending) setOpen(next);
        }}
        title="Mark this expense as not paid?"
        description={`${label}. Its payment record is cleared and the person who claimed it is told.`}
      >
        <Field
          label="Why?"
          htmlFor="unpay-reason"
          required
          hint="Kept in the audit trail."
          error={error ?? undefined}
        >
          <Textarea
            id="unpay-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            maxLength={500}
            dir="auto"
          />
        </Field>
        <DialogActions>
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="danger"
            isPending={isPending}
            onClick={() =>
              startTransition(async () => {
                if (reason.trim() === "") {
                  setError("Say why the payment is being cleared.");
                  return;
                }
                const result = await undoExpensePaymentAction(expenseId, { reason });
                if (!result.ok) {
                  setError(result.fieldErrors?.reason?.[0] ?? result.message);
                  return;
                }
                toast("Expense marked as not paid.");
                setOpen(false);
                router.refresh();
              })
            }
          >
            Mark as not paid
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
