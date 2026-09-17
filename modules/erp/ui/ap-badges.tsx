import { Badge, type BadgeTone } from "@/components/ui/primitives";
import {
  AP_BILL_STATUS_LABELS,
  AP_PAYMENT_STATUS_LABELS,
  type ApBillStatus,
  type ApPaymentStatus,
  type VendorRef,
} from "../contracts/types";

const BILL_TONES: Record<ApBillStatus, BadgeTone> = {
  DRAFT: "neutral",
  PENDING_APPROVAL: "warning",
  APPROVED: "info",
  POSTED: "info",
  PARTIALLY_PAID: "warning",
  PAID: "success",
  CANCELLED: "danger",
};

const PAYMENT_TONES: Record<ApPaymentStatus, BadgeTone> = {
  DRAFT: "neutral",
  PENDING_APPROVAL: "warning",
  APPROVED: "info",
  POSTED: "success",
  CANCELLED: "danger",
};

export function BillStatusBadge({ status }: { status: ApBillStatus }) {
  return <Badge tone={BILL_TONES[status]}>{AP_BILL_STATUS_LABELS[status]}</Badge>;
}

export function PaymentStatusBadge({ status }: { status: ApPaymentStatus }) {
  return <Badge tone={PAYMENT_TONES[status]}>{AP_PAYMENT_STATUS_LABELS[status]}</Badge>;
}

/** A vendor's name, marked when the vendor has been deactivated. */
export function VendorName({ vendor }: { vendor: VendorRef }) {
  return (
    <span dir="auto">
      {vendor.name}
      {!vendor.isActive && (
        <span className="text-foreground-muted ms-1 text-xs">(inactive)</span>
      )}
    </span>
  );
}
