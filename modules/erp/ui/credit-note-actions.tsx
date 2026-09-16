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
import { Badge } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import {
  AR_CREDIT_NOTE_STATUS_LABELS,
  type ArCreditNoteStatus,
} from "../contracts/types";
import { formatMinorAmount } from "../domain/journal";
import { ConfirmActionButton, ReasonActionButton } from "./action-dialogs";
import {
  approveCreditNoteAction,
  cancelCreditNoteAction,
  deleteCreditNoteAction,
  postCreditNoteAction,
  rejectCreditNoteAction,
  submitCreditNoteAction,
} from "./ar-actions";

const TONES: Record<ArCreditNoteStatus, "neutral" | "warning" | "success" | "danger"> = {
  DRAFT: "neutral",
  PENDING_APPROVAL: "warning",
  APPROVED: "success",
  POSTED: "success",
  CANCELLED: "danger",
};

export function CreditNoteStatusBadge({ status }: { status: ArCreditNoteStatus }) {
  return <Badge tone={TONES[status]}>{AR_CREDIT_NOTE_STATUS_LABELS[status]}</Badge>;
}

/** The actions a credit note's status allows, each decided on the server (ADR-029). */
export function CreditNoteActions({
  creditNote,
  can,
  today,
}: {
  creditNote: {
    id: string;
    status: ArCreditNoteStatus;
    creditNoteNumber: string | null;
    creditNoteDate: string;
    totalMinor: number;
    invoiceNumber: string | null;
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
    creditNote.status === "DRAFT" ||
    creditNote.status === "PENDING_APPROVAL" ||
    creditNote.status === "APPROVED";

  return (
    <>
      {creditNote.status === "DRAFT" && can.update && (
        <>
          <ButtonLink
            href={`/erp/finance/credit-notes/${creditNote.id}/edit`}
            icon={<Pencil aria-hidden="true" className="size-4" />}
          >
            Edit
          </ButtonLink>
          <ConfirmActionButton
            label="Delete draft"
            icon={<Trash2 aria-hidden="true" className="size-4" />}
            title="Delete this draft credit note?"
            description="The draft and its lines are removed. It was never posted, so the invoice is untouched. The deletion is audited."
            confirmLabel="Delete draft"
            pendingLabel="Deleting…"
            confirmVariant="danger"
            run={() => deleteCreditNoteAction(creditNote.id)}
            onSuccess={() => {
              notify("Draft credit note deleted.");
              router.push("/erp/finance/credit-notes");
            }}
          />
          <ConfirmActionButton
            label="Submit"
            variant="primary"
            icon={<Send aria-hidden="true" className="size-4" />}
            title="Submit this credit note?"
            description={`Total ${formatMinorAmount(creditNote.totalMinor)} EGP. It goes for approval, or is approved straight away when AR settings do not require approval for this amount.`}
            confirmLabel="Submit credit note"
            pendingLabel="Submitting…"
            run={() => submitCreditNoteAction(creditNote.id)}
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

      {creditNote.status === "PENDING_APPROVAL" && can.approve && (
        <>
          <ReasonActionButton
            label="Reject"
            icon={<ThumbsDown aria-hidden="true" className="size-4" />}
            title="Reject this credit note?"
            description="It returns to draft with your reason, so it can be corrected and submitted again."
            confirmLabel="Reject credit note"
            pendingLabel="Rejecting…"
            run={(reason) => rejectCreditNoteAction(creditNote.id, { reason })}
            onSuccess={refresh("Credit note rejected and returned to draft.")}
          />
          <ConfirmActionButton
            label="Approve"
            variant="primary"
            icon={<ThumbsUp aria-hidden="true" className="size-4" />}
            title="Approve this credit note?"
            description={`Total ${formatMinorAmount(creditNote.totalMinor)} EGP against invoice ${creditNote.invoiceNumber ?? ""}. Once approved it can be posted.`}
            confirmLabel="Approve credit note"
            pendingLabel="Approving…"
            run={() => approveCreditNoteAction(creditNote.id)}
            onSuccess={refresh("Credit note approved.")}
          />
        </>
      )}

      {creditNote.status === "APPROVED" && can.post && (
        <ConfirmActionButton
          label="Post credit note"
          variant="primary"
          icon={<CheckCircle2 aria-hidden="true" className="size-4" />}
          title="Post this credit note?"
          description={`It receives its number and books ${formatMinorAmount(creditNote.totalMinor)} EGP back out of revenue and tax, reducing what invoice ${creditNote.invoiceNumber ?? ""} still owes. A posted credit note can never be edited — only voided.`}
          confirmLabel="Post credit note"
          pendingLabel="Posting…"
          run={() => postCreditNoteAction(creditNote.id)}
          onSuccess={(data) => {
            notify(`Posted as ${data.creditNoteNumber} (journal ${data.journalNumber}).`);
            router.refresh();
          }}
        />
      )}

      {can.cancel && unposted && (
        <ReasonActionButton
          label="Cancel"
          icon={<Ban aria-hidden="true" className="size-4" />}
          title="Cancel this credit note?"
          description="It was never posted, so nothing reaches the ledger and the invoice is untouched. The credit note stays on record as cancelled."
          confirmLabel="Cancel credit note"
          pendingLabel="Cancelling…"
          run={(reason) => cancelCreditNoteAction(creditNote.id, { reason })}
          onSuccess={refresh("Credit note cancelled.")}
        />
      )}

      {can.cancel && creditNote.status === "POSTED" && (
        <ReasonActionButton
          label="Void"
          icon={<Ban aria-hidden="true" className="size-4" />}
          title={`Void credit note ${creditNote.creditNoteNumber ?? ""}?`}
          description="Its journal entry is reversed by an equal and opposite entry, and the invoice owes the amount again. The original stays in the ledger. This cannot be undone."
          confirmLabel="Void credit note"
          pendingLabel="Voiding…"
          dateLabel="Void date"
          defaultDate={
            today < creditNote.creditNoteDate ? creditNote.creditNoteDate : today
          }
          minDate={creditNote.creditNoteDate}
          run={(reason, voidDate) =>
            cancelCreditNoteAction(creditNote.id, { reason, voidDate })
          }
          onSuccess={(data) => {
            notify(`Credit note voided (journal ${data.voidJournalNumber ?? ""}).`);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
