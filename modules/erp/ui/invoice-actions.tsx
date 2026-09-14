"use client";

import {
  Ban,
  CheckCircle2,
  Pencil,
  Send,
  ThumbsDown,
  ThumbsUp,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { ArInvoiceStatus } from "../contracts/types";
import { formatMinorAmount } from "../domain/journal";
import { ConfirmActionButton, ReasonActionButton } from "./action-dialogs";
import {
  approveInvoiceAction,
  cancelInvoiceAction,
  deleteInvoiceAction,
  postInvoiceAction,
  rejectInvoiceAction,
  submitInvoiceAction,
} from "./ar-actions";

/** The actions an invoice's status allows, each confirmed and decided on the server. */
export function InvoiceActions({
  invoice,
  can,
  today,
}: {
  invoice: {
    id: string;
    status: ArInvoiceStatus;
    invoiceNumber: string | null;
    invoiceDate: string;
    totalMinor: number;
    paidMinor: number;
  };
  can: { update: boolean; approve: boolean; post: boolean; cancel: boolean };
  today: string;
}) {
  const router = useRouter();
  const notify = useToast();
  const refresh = (text: string) => () => {
    notify(text);
    router.refresh();
  };
  const unposted =
    invoice.status === "DRAFT" ||
    invoice.status === "PENDING_APPROVAL" ||
    invoice.status === "APPROVED";

  return (
    <>
      {invoice.status === "DRAFT" && can.update && (
        <>
          <ButtonLink
            href={`/erp/finance/invoices/${invoice.id}/edit`}
            icon={<Pencil aria-hidden="true" className="size-4" />}
          >
            Edit
          </ButtonLink>
          <ConfirmActionButton
            label="Delete draft"
            icon={<Trash2 aria-hidden="true" className="size-4" />}
            title="Delete this draft invoice?"
            description="The draft and its lines are removed. It was never posted, so no balance changes. The deletion is audited."
            confirmLabel="Delete draft"
            pendingLabel="Deleting…"
            confirmVariant="danger"
            run={() => deleteInvoiceAction(invoice.id)}
            onSuccess={() => {
              notify("Draft invoice deleted.");
              router.push("/erp/finance/invoices");
            }}
          />
          <ConfirmActionButton
            label="Submit"
            variant="primary"
            icon={<Send aria-hidden="true" className="size-4" />}
            title="Submit this invoice?"
            description={`Total ${formatMinorAmount(invoice.totalMinor)} EGP. It goes for approval, or is approved straight away when AR settings do not require approval for this amount. A submitted invoice can no longer be edited unless it is rejected.`}
            confirmLabel="Submit invoice"
            pendingLabel="Submitting…"
            run={() => submitInvoiceAction(invoice.id)}
            onSuccess={(data) => {
              notify(
                data.status === "APPROVED"
                  ? "Submitted and approved — no approval needed."
                  : "Submitted for approval.",
              );
              router.refresh();
            }}
          />
        </>
      )}

      {invoice.status === "PENDING_APPROVAL" && can.approve && (
        <>
          <ReasonActionButton
            label="Reject"
            icon={<ThumbsDown aria-hidden="true" className="size-4" />}
            title="Reject this invoice?"
            description="It returns to draft with your reason, so it can be corrected and submitted again."
            confirmLabel="Reject invoice"
            pendingLabel="Rejecting…"
            run={(reason) => rejectInvoiceAction(invoice.id, { reason })}
            onSuccess={refresh("Invoice rejected and returned to draft.")}
          />
          <ConfirmActionButton
            label="Approve"
            variant="primary"
            icon={<ThumbsUp aria-hidden="true" className="size-4" />}
            title="Approve this invoice?"
            description={`Total ${formatMinorAmount(invoice.totalMinor)} EGP. Once approved it can be posted to the ledger.`}
            confirmLabel="Approve invoice"
            pendingLabel="Approving…"
            run={() => approveInvoiceAction(invoice.id)}
            onSuccess={refresh("Invoice approved.")}
          />
        </>
      )}

      {invoice.status === "APPROVED" && can.post && (
        <ConfirmActionButton
          label="Post invoice"
          variant="primary"
          icon={<CheckCircle2 aria-hidden="true" className="size-4" />}
          title="Post this invoice?"
          description={`It receives its invoice number and books ${formatMinorAmount(invoice.totalMinor)} EGP to receivables, revenue and tax in the ledger. A posted invoice can never be edited — only voided while unpaid.`}
          confirmLabel="Post invoice"
          pendingLabel="Posting…"
          run={() => postInvoiceAction(invoice.id)}
          onSuccess={(data) => {
            notify(`Posted as ${data.invoiceNumber} (journal ${data.journalNumber}).`);
            router.refresh();
          }}
        />
      )}

      {can.cancel && unposted && (
        <ReasonActionButton
          label="Cancel"
          icon={<Ban aria-hidden="true" className="size-4" />}
          title="Cancel this invoice?"
          description="It was never posted, so nothing reaches the ledger. The invoice stays on record as cancelled."
          confirmLabel="Cancel invoice"
          pendingLabel="Cancelling…"
          run={(reason) => cancelInvoiceAction(invoice.id, { reason })}
          onSuccess={refresh("Invoice cancelled.")}
        />
      )}

      {can.cancel && invoice.status === "POSTED" && invoice.paidMinor === 0 && (
        <ReasonActionButton
          label="Void"
          icon={<Ban aria-hidden="true" className="size-4" />}
          title={`Void invoice ${invoice.invoiceNumber ?? ""}?`}
          description="Its journal entry is reversed by an equal and opposite entry, and the invoice is marked cancelled. The original stays in the ledger. This cannot be undone."
          confirmLabel="Void invoice"
          pendingLabel="Voiding…"
          dateLabel="Void date"
          defaultDate={today < invoice.invoiceDate ? invoice.invoiceDate : today}
          minDate={invoice.invoiceDate}
          run={(reason, voidDate) =>
            cancelInvoiceAction(invoice.id, { reason, voidDate })
          }
          onSuccess={(data) => {
            notify(`Invoice voided (journal ${data.voidJournalNumber ?? ""}).`);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
