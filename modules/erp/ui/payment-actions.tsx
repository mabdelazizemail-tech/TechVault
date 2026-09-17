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
import type { ApPaymentStatus } from "../contracts/types";
import { formatMinorAmount } from "../domain/journal";
import { ConfirmActionButton, ReasonActionButton } from "./action-dialogs";
import {
  approvePaymentAction,
  cancelPaymentAction,
  deletePaymentAction,
  postPaymentAction,
  rejectPaymentAction,
  submitPaymentAction,
} from "./ap-actions";

/**
 * The actions a supplier payment's status allows. Payments have their own approval,
 * separate from the bills they settle (ADR-033).
 */
export function PaymentActions({
  payment,
  can,
  today,
}: {
  payment: {
    id: string;
    status: ApPaymentStatus;
    paymentNumber: string | null;
    paymentDate: string;
    amountMinor: number;
    withheldMinor: number;
    cashMinor: number;
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
    payment.status === "DRAFT" ||
    payment.status === "PENDING_APPROVAL" ||
    payment.status === "APPROVED";
  const figures = `Settles ${formatMinorAmount(payment.amountMinor)} EGP of bills: ${formatMinorAmount(payment.cashMinor)} paid out and ${formatMinorAmount(payment.withheldMinor)} withheld.`;

  return (
    <>
      {payment.status === "DRAFT" && can.update && (
        <>
          <ButtonLink
            href={`/erp/finance/payments/${payment.id}/edit`}
            icon={<Pencil aria-hidden="true" className="size-4" />}
          >
            Edit
          </ButtonLink>
          <ConfirmActionButton
            label="Delete draft"
            icon={<Trash2 aria-hidden="true" className="size-4" />}
            title="Delete this draft payment?"
            description="The draft is removed. It was never posted, so no bill or bank balance changes. The deletion is audited."
            confirmLabel="Delete draft"
            pendingLabel="Deleting…"
            confirmVariant="danger"
            run={() => deletePaymentAction(payment.id)}
            onSuccess={() => {
              notify("Draft payment deleted.");
              router.push("/erp/finance/payments");
            }}
          />
          <ConfirmActionButton
            label="Submit"
            variant="primary"
            icon={<Send aria-hidden="true" className="size-4" />}
            title="Submit this payment?"
            description={`${figures} It goes for approval, or is approved straight away when AP settings do not require approval for this amount.`}
            confirmLabel="Submit payment"
            pendingLabel="Submitting…"
            run={() => submitPaymentAction(payment.id)}
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

      {payment.status === "PENDING_APPROVAL" && can.approve && (
        <>
          <ReasonActionButton
            label="Reject"
            icon={<ThumbsDown aria-hidden="true" className="size-4" />}
            title="Reject this payment?"
            description="It returns to draft with your reason, so it can be corrected and submitted again."
            confirmLabel="Reject payment"
            pendingLabel="Rejecting…"
            run={(reason) => rejectPaymentAction(payment.id, { reason })}
            onSuccess={refresh("Payment rejected and returned to draft.")}
          />
          <ConfirmActionButton
            label="Approve"
            variant="primary"
            icon={<ThumbsUp aria-hidden="true" className="size-4" />}
            title="Approve this payment?"
            description={`${figures} Once approved it can be posted.`}
            confirmLabel="Approve payment"
            pendingLabel="Approving…"
            run={() => approvePaymentAction(payment.id)}
            onSuccess={refresh("Payment approved.")}
          />
        </>
      )}

      {payment.status === "APPROVED" && can.post && (
        <ConfirmActionButton
          label="Post payment"
          variant="primary"
          icon={<CheckCircle2 aria-hidden="true" className="size-4" />}
          title="Post this payment?"
          description={`${figures} It receives its number, reduces payables, credits the bank account and books the withholding tax owed. The bills it settles are marked paid or partly paid.`}
          confirmLabel="Post payment"
          pendingLabel="Posting…"
          run={() => postPaymentAction(payment.id)}
          onSuccess={(data) => {
            notify(`Posted as ${data.paymentNumber} (journal ${data.journalNumber}).`);
            router.refresh();
          }}
        />
      )}

      {can.cancel && unposted && (
        <ReasonActionButton
          label="Cancel"
          icon={<Ban aria-hidden="true" className="size-4" />}
          title="Cancel this payment?"
          description="It was never posted, so nothing reaches the ledger. The payment stays on record as cancelled."
          confirmLabel="Cancel payment"
          pendingLabel="Cancelling…"
          run={(reason) => cancelPaymentAction(payment.id, { reason })}
          onSuccess={refresh("Payment cancelled.")}
        />
      )}

      {can.cancel && payment.status === "POSTED" && (
        <ReasonActionButton
          label="Void"
          icon={<Ban aria-hidden="true" className="size-4" />}
          title={`Void payment ${payment.paymentNumber ?? ""}?`}
          description="Its journal entry is reversed, the payment is marked cancelled and the bills it settled owe again. The original stays in the ledger. This cannot be undone."
          confirmLabel="Void payment"
          pendingLabel="Voiding…"
          dateLabel="Void date"
          defaultDate={today < payment.paymentDate ? payment.paymentDate : today}
          minDate={payment.paymentDate}
          run={(reason, voidDate) =>
            cancelPaymentAction(payment.id, { reason, voidDate })
          }
          onSuccess={(data) => {
            notify(`Payment voided (journal ${data.voidJournalNumber ?? ""}).`);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
