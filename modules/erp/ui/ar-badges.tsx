import { Badge, type BadgeTone } from "@/components/ui/primitives";
import {
  AR_INVOICE_STATUS_LABELS,
  AR_RECEIPT_STATUS_LABELS,
  type ArInvoiceStatus,
  type ArReceiptStatus,
  type CustomerRef,
} from "../contracts/types";

const INVOICE_TONES: Record<ArInvoiceStatus, BadgeTone> = {
  DRAFT: "neutral",
  PENDING_APPROVAL: "warning",
  APPROVED: "info",
  POSTED: "info",
  PARTIALLY_PAID: "warning",
  PAID: "success",
  CANCELLED: "danger",
};

const RECEIPT_TONES: Record<ArReceiptStatus, BadgeTone> = {
  DRAFT: "neutral",
  POSTED: "success",
  CANCELLED: "danger",
};

export function InvoiceStatusBadge({ status }: { status: ArInvoiceStatus }) {
  return <Badge tone={INVOICE_TONES[status]}>{AR_INVOICE_STATUS_LABELS[status]}</Badge>;
}

export function ReceiptStatusBadge({ status }: { status: ArReceiptStatus }) {
  return <Badge tone={RECEIPT_TONES[status]}>{AR_RECEIPT_STATUS_LABELS[status]}</Badge>;
}

/** A customer's CRM name, marked when the company no longer exists in CRM. */
export function CustomerName({ customer }: { customer: CustomerRef }) {
  return (
    <span dir="auto">
      {customer.name}
      {!customer.existsInCrm && (
        <span className="text-foreground-muted ms-1 text-xs">(not in CRM)</span>
      )}
    </span>
  );
}
