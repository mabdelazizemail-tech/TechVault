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
import type { ApBillStatus } from "../contracts/types";
import { formatMinorAmount } from "../domain/journal";
import { ConfirmActionButton, ReasonActionButton } from "./action-dialogs";
import {
  approveBillAction,
  cancelBillAction,
  deleteBillAction,
  postBillAction,
  rejectBillAction,
  submitBillAction,
} from "./ap-actions";

/** The actions a vendor bill's status allows, each confirmed and decided on the server. */
export function BillActions({
  bill,
  can,
  today,
}: {
  bill: {
    id: string;
    status: ApBillStatus;
    billNumber: string | null;
    billDate: string;
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
    bill.status === "DRAFT" ||
    bill.status === "PENDING_APPROVAL" ||
    bill.status === "APPROVED";

  return (
    <>
      {bill.status === "DRAFT" && can.update && (
        <>
          <ButtonLink
            href={`/erp/finance/bills/${bill.id}/edit`}
            icon={<Pencil aria-hidden="true" className="size-4" />}
          >
            Edit
          </ButtonLink>
          <ConfirmActionButton
            label="Delete draft"
            icon={<Trash2 aria-hidden="true" className="size-4" />}
            title="Delete this draft bill?"
            description="The draft and its lines are removed. It was never posted, so nothing owed changes. The deletion is audited."
            confirmLabel="Delete draft"
            pendingLabel="Deleting…"
            confirmVariant="danger"
            run={() => deleteBillAction(bill.id)}
            onSuccess={() => {
              notify("Draft bill deleted.");
              router.push("/erp/finance/bills");
            }}
          />
          <ConfirmActionButton
            label="Submit"
            variant="primary"
            icon={<Send aria-hidden="true" className="size-4" />}
            title="Submit this bill?"
            description={`Total ${formatMinorAmount(bill.totalMinor)} EGP. It goes for approval, or is approved straight away when AP settings do not require approval for this amount. A submitted bill can no longer be edited unless it is rejected.`}
            confirmLabel="Submit bill"
            pendingLabel="Submitting…"
            run={() => submitBillAction(bill.id)}
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

      {bill.status === "PENDING_APPROVAL" && can.approve && (
        <>
          <ReasonActionButton
            label="Reject"
            icon={<ThumbsDown aria-hidden="true" className="size-4" />}
            title="Reject this bill?"
            description="It returns to draft with your reason, so it can be corrected and submitted again."
            confirmLabel="Reject bill"
            pendingLabel="Rejecting…"
            run={(reason) => rejectBillAction(bill.id, { reason })}
            onSuccess={refresh("Bill rejected and returned to draft.")}
          />
          <ConfirmActionButton
            label="Approve"
            variant="primary"
            icon={<ThumbsUp aria-hidden="true" className="size-4" />}
            title="Approve this bill?"
            description={`Total ${formatMinorAmount(bill.totalMinor)} EGP. Once approved it can be posted to the ledger.`}
            confirmLabel="Approve bill"
            pendingLabel="Approving…"
            run={() => approveBillAction(bill.id)}
            onSuccess={refresh("Bill approved.")}
          />
        </>
      )}

      {bill.status === "APPROVED" && can.post && (
        <ConfirmActionButton
          label="Post bill"
          variant="primary"
          icon={<CheckCircle2 aria-hidden="true" className="size-4" />}
          title="Post this bill?"
          description={`It receives its bill number and books ${formatMinorAmount(bill.totalMinor)} EGP to expenses, input VAT and payables in the ledger. A posted bill can never be edited — only voided while unpaid.`}
          confirmLabel="Post bill"
          pendingLabel="Posting…"
          run={() => postBillAction(bill.id)}
          onSuccess={(data) => {
            notify(`Posted as ${data.billNumber} (journal ${data.journalNumber}).`);
            router.refresh();
          }}
        />
      )}

      {can.cancel && unposted && (
        <ReasonActionButton
          label="Cancel"
          icon={<Ban aria-hidden="true" className="size-4" />}
          title="Cancel this bill?"
          description="It was never posted, so nothing reaches the ledger. The bill stays on record as cancelled."
          confirmLabel="Cancel bill"
          pendingLabel="Cancelling…"
          run={(reason) => cancelBillAction(bill.id, { reason })}
          onSuccess={refresh("Bill cancelled.")}
        />
      )}

      {can.cancel && bill.status === "POSTED" && bill.paidMinor === 0 && (
        <ReasonActionButton
          label="Void"
          icon={<Ban aria-hidden="true" className="size-4" />}
          title={`Void bill ${bill.billNumber ?? ""}?`}
          description="Its journal entry is reversed by an equal and opposite entry, and the bill is marked cancelled. The original stays in the ledger. This cannot be undone."
          confirmLabel="Void bill"
          pendingLabel="Voiding…"
          dateLabel="Void date"
          defaultDate={today < bill.billDate ? bill.billDate : today}
          minDate={bill.billDate}
          run={(reason, voidDate) => cancelBillAction(bill.id, { reason, voidDate })}
          onSuccess={(data) => {
            notify(`Bill voided (journal ${data.voidJournalNumber ?? ""}).`);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
