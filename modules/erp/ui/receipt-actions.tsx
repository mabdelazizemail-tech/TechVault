"use client";

import { Ban, CheckCircle2, Link2, Pencil, Trash2, Unlink } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Dialog, DialogActions } from "@/components/ui/dialog";
import { controlClasses } from "@/components/ui/form-controls";
import { Badge } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import type { ArReceiptStatus, OpenInvoiceOption } from "../contracts/types";
import { formatMinorAmount, parseAmountText } from "../domain/journal";
import { ConfirmActionButton, ReasonActionButton } from "./action-dialogs";
import {
  allocateReceiptAction,
  cancelReceiptAction,
  deleteReceiptAction,
  listOpenInvoicesAction,
  postReceiptAction,
  unallocateReceiptAction,
} from "./ar-actions";
import { FormError } from "./form-parts";
import { formatDate } from "./format";

/** The actions a receipt's status allows, each confirmed and decided on the server. */
export function ReceiptActions({
  receipt,
  can,
  today,
}: {
  receipt: {
    id: string;
    status: ArReceiptStatus;
    receiptNumber: string | null;
    receiptDate: string;
    crmAccountId: string;
    amountMinor: number;
    allocatedMinor: number;
  };
  can: { update: boolean; post: boolean; allocate: boolean; cancel: boolean };
  today: string;
}) {
  const router = useRouter();
  const notify = useToast();
  const unallocated = receipt.amountMinor - receipt.allocatedMinor;

  return (
    <>
      {receipt.status === "DRAFT" && can.update && (
        <>
          <ButtonLink
            href={`/erp/finance/receipts/${receipt.id}/edit`}
            icon={<Pencil aria-hidden="true" className="size-4" />}
          >
            Edit
          </ButtonLink>
          <ConfirmActionButton
            label="Delete draft"
            icon={<Trash2 aria-hidden="true" className="size-4" />}
            title="Delete this draft receipt?"
            description="The draft is removed. It was never posted, so no balance changes. The deletion is audited."
            confirmLabel="Delete draft"
            pendingLabel="Deleting…"
            confirmVariant="danger"
            run={() => deleteReceiptAction(receipt.id)}
            onSuccess={() => {
              notify("Draft receipt deleted.");
              router.push("/erp/finance/receipts");
            }}
          />
        </>
      )}
      {receipt.status === "DRAFT" && can.post && (
        <ConfirmActionButton
          label="Post receipt"
          variant="primary"
          icon={<CheckCircle2 aria-hidden="true" className="size-4" />}
          title="Post this receipt?"
          description={`It receives its receipt number and books ${formatMinorAmount(receipt.amountMinor)} EGP: debit the bank or cash account, credit receivables. A posted receipt can only be voided while unallocated.`}
          confirmLabel="Post receipt"
          pendingLabel="Posting…"
          run={() => postReceiptAction(receipt.id)}
          onSuccess={(data) => {
            notify(`Posted as ${data.receiptNumber} (journal ${data.journalNumber}).`);
            router.refresh();
          }}
        />
      )}
      {receipt.status === "DRAFT" && can.cancel && (
        <ReasonActionButton
          label="Cancel"
          icon={<Ban aria-hidden="true" className="size-4" />}
          title="Cancel this draft receipt?"
          description="It was never posted, so nothing reaches the ledger."
          confirmLabel="Cancel receipt"
          pendingLabel="Cancelling…"
          run={(reason) => cancelReceiptAction(receipt.id, { reason })}
          onSuccess={() => {
            notify("Receipt cancelled.");
            router.refresh();
          }}
        />
      )}
      {receipt.status === "POSTED" && can.allocate && unallocated > 0 && (
        <AllocateButton receipt={receipt} unallocatedMinor={unallocated} />
      )}
      {receipt.status === "POSTED" && can.cancel && receipt.allocatedMinor === 0 && (
        <ReasonActionButton
          label="Void"
          icon={<Ban aria-hidden="true" className="size-4" />}
          title={`Void receipt ${receipt.receiptNumber ?? ""}?`}
          description="Its journal entry is reversed by an equal and opposite entry, and the receipt is marked cancelled. This cannot be undone."
          confirmLabel="Void receipt"
          pendingLabel="Voiding…"
          dateLabel="Void date"
          defaultDate={today < receipt.receiptDate ? receipt.receiptDate : today}
          minDate={receipt.receiptDate}
          run={(reason, voidDate) =>
            cancelReceiptAction(receipt.id, { reason, voidDate })
          }
          onSuccess={(data) => {
            notify(`Receipt voided (journal ${data.voidJournalNumber ?? ""}).`);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

/** Allocates the unallocated part of a posted receipt to open invoices of its customer. */
function AllocateButton({
  receipt,
  unallocatedMinor,
}: {
  receipt: { id: string; crmAccountId: string };
  unallocatedMinor: number;
}) {
  const router = useRouter();
  const notify = useToast();
  const [open, setOpen] = useState(false);
  const [invoices, setInvoices] = useState<OpenInvoiceOption[] | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, startLoading] = useTransition();
  const [isPending, startTransition] = useTransition();

  const load = () => {
    setMessage(null);
    setAmounts({});
    setInvoices(null);
    setOpen(true);
    startLoading(async () => {
      const result = await listOpenInvoicesAction(receipt.crmAccountId);
      if (result.ok) setInvoices(result.data);
      else setMessage(result.message);
    });
  };

  const parsed = Object.entries(amounts).map(([invoiceId, text]) => ({
    invoiceId,
    parsed: parseAmountText(text),
  }));
  const invalid = parsed.some((entry) => !entry.parsed.ok);
  const total = parsed.reduce(
    (sum, entry) => sum + (entry.parsed.ok ? entry.parsed.minor : 0n),
    0n,
  );
  const over = total > BigInt(unallocatedMinor);

  const fillOldestFirst = () => {
    let remaining = BigInt(unallocatedMinor);
    const next: Record<string, string> = {};
    for (const invoice of invoices ?? []) {
      if (remaining <= 0n) break;
      const take =
        BigInt(invoice.outstandingMinor) < remaining
          ? BigInt(invoice.outstandingMinor)
          : remaining;
      next[invoice.id] = formatMinorAmount(take);
      remaining -= take;
    }
    setAmounts(next);
  };

  return (
    <>
      <Button
        variant="primary"
        icon={<Link2 aria-hidden="true" className="size-4" />}
        onClick={load}
      >
        Allocate
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        variant="sheet"
        title="Allocate this receipt"
        description={`${formatMinorAmount(unallocatedMinor)} EGP is unallocated. Allocations cannot exceed it, nor any invoice's outstanding amount.`}
      >
        {message !== null && <FormError message={message} />}
        {isLoading && (
          <p className="text-foreground-muted text-sm">Loading open invoices…</p>
        )}
        {invoices !== null && invoices.length === 0 && (
          <p className="text-foreground-muted text-sm">
            This customer has no posted invoices with anything outstanding.
          </p>
        )}
        {invoices !== null && invoices.length > 0 && (
          <>
            <div className="mb-3 flex items-center justify-between gap-2">
              <Button size="sm" onClick={fillOldestFirst}>
                Fill oldest first
              </Button>
              <Badge
                tone={over || invalid ? "danger" : total > 0n ? "success" : "neutral"}
              >
                {invalid
                  ? "Check the amounts"
                  : over
                    ? "More than unallocated"
                    : `Allocating ${formatMinorAmount(total)}`}
              </Badge>
            </div>
            <ul className="divide-border border-border divide-y border-y-2">
              {invoices.map((invoice) => (
                <li
                  key={invoice.id}
                  className="flex items-center justify-between gap-3 py-2.5"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">
                      {invoice.invoiceNumber}
                    </span>
                    <span className="text-foreground-muted block text-xs">
                      Due {formatDate(invoice.dueDate)} · outstanding{" "}
                      <span dir="ltr">{formatMinorAmount(invoice.outstandingMinor)}</span>
                    </span>
                  </span>
                  <input
                    aria-label={`Amount for invoice ${invoice.invoiceNumber}`}
                    inputMode="decimal"
                    dir="ltr"
                    placeholder="0.00"
                    value={amounts[invoice.id] ?? ""}
                    onChange={(event) =>
                      setAmounts((current) => ({
                        ...current,
                        [invoice.id]: event.target.value,
                      }))
                    }
                    className={cn(
                      controlClasses,
                      "border-border-strong min-h-9 w-32 text-end tabular-nums",
                    )}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            isPending={isPending}
            disabled={invalid || total <= 0n}
            onClick={() =>
              startTransition(async () => {
                const allocations = parsed
                  .filter((entry) => entry.parsed.ok && entry.parsed.minor > 0n)
                  .map((entry) => ({
                    invoiceId: entry.invoiceId,
                    amount: amounts[entry.invoiceId] ?? "",
                  }));
                const result = await allocateReceiptAction(receipt.id, { allocations });
                if (result.ok) {
                  setOpen(false);
                  notify("Receipt allocated.");
                  router.refresh();
                } else {
                  setMessage(result.message);
                }
              })
            }
          >
            {isPending ? "Allocating…" : "Allocate"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

/** Removes one allocation, returning its amount to the receipt and the invoice. */
export function UnallocateButton({
  receiptId,
  invoiceId,
  label,
}: {
  receiptId: string;
  invoiceId: string;
  label: string;
}) {
  const router = useRouter();
  const notify = useToast();
  return (
    <ConfirmActionButton
      label="Remove"
      icon={<Unlink aria-hidden="true" className="size-3.5" />}
      title="Remove this allocation?"
      description={`${label} The amount returns to the receipt's unallocated balance and the invoice's outstanding balance. No journal entry changes. The removal is audited.`}
      confirmLabel="Remove allocation"
      pendingLabel="Removing…"
      confirmVariant="danger"
      run={() => unallocateReceiptAction(receiptId, invoiceId)}
      onSuccess={() => {
        notify("Allocation removed.");
        router.refresh();
      }}
    />
  );
}
