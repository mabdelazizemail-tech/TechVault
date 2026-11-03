import {
  Car,
  Coffee,
  Ellipsis,
  Sandwich,
  Stamp,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/primitives";
import {
  EXPENSE_STAGE_LABELS,
  expenseStage,
  type ExpenseCategory,
  type ExpenseStage,
  type ExpenseStatus,
} from "../domain/expenses";

/** Presentation for mission expenses. A stage's colour always comes with its word. */

/**
 * The colours read as a progression (ADR-040): amber awaits a review, blue is approved
 * and awaits payment, green is paid and done, red is rejected.
 */
const STAGE_TONES: Record<ExpenseStage, BadgeTone> = {
  SUBMITTED: "warning",
  APPROVED: "info",
  PAID: "success",
  REJECTED: "danger",
};

export function ExpenseStatusBadge({
  status,
  paidOn,
}: {
  status: ExpenseStatus;
  paidOn: string | null;
}) {
  const stage = expenseStage(status, paidOn);
  return <Badge tone={STAGE_TONES[stage]}>{EXPENSE_STAGE_LABELS[stage]}</Badge>;
}

export const CATEGORY_ICONS: Record<ExpenseCategory, LucideIcon> = {
  DINNER: UtensilsCrossed,
  TRANSPORTATION: Car,
  VISA: Stamp,
  LUNCH: Sandwich,
  COFFEE: Coffee,
  OTHER: Ellipsis,
};
