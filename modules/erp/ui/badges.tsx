import { Badge, type BadgeTone } from "@/components/ui/primitives";
import {
  JOURNAL_STATUS_LABELS,
  PERIOD_STATUS_LABELS,
  type JournalStatus,
  type PeriodStatus,
} from "../contracts/types";

const JOURNAL_TONES: Record<JournalStatus, BadgeTone> = {
  DRAFT: "neutral",
  POSTED: "success",
  REVERSED: "warning",
};

export function JournalStatusBadge({ status }: { status: JournalStatus }) {
  return <Badge tone={JOURNAL_TONES[status]}>{JOURNAL_STATUS_LABELS[status]}</Badge>;
}

export function PeriodStatusBadge({ status }: { status: PeriodStatus }) {
  return (
    <Badge tone={status === "OPEN" ? "success" : "neutral"}>
      {PERIOD_STATUS_LABELS[status]}
    </Badge>
  );
}

export function ActiveBadge({ isActive }: { isActive: boolean }) {
  return (
    <Badge tone={isActive ? "neutral" : "warning"}>
      {isActive ? "Active" : "Inactive"}
    </Badge>
  );
}

/** Whether debits equal credits — always said in words, never by colour alone. */
export function BalanceBadge({
  debitMinor,
  creditMinor,
  difference,
}: {
  debitMinor: bigint | number;
  creditMinor: bigint | number;
  /** The formatted absolute difference, shown when out of balance. */
  difference: string;
}) {
  const debit = BigInt(debitMinor);
  const credit = BigInt(creditMinor);
  if (debit === 0n && credit === 0n) return <Badge tone="neutral">No amounts yet</Badge>;
  if (debit === credit) return <Badge tone="success">Balanced</Badge>;
  return <Badge tone="danger">Out of balance by {difference}</Badge>;
}
