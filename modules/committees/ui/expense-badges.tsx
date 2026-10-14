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
  EXPENSE_STATUS_LABELS,
  type ExpenseCategory,
  type ExpenseStatus,
} from "../domain/expenses";

/** Presentation for mission expenses. A status's colour always comes with its word. */

const STATUS_TONES: Record<ExpenseStatus, BadgeTone> = {
  SUBMITTED: "info",
  APPROVED: "success",
  REJECTED: "danger",
};

export function ExpenseStatusBadge({ status }: { status: ExpenseStatus }) {
  return <Badge tone={STATUS_TONES[status]}>{EXPENSE_STATUS_LABELS[status]}</Badge>;
}

export const CATEGORY_ICONS: Record<ExpenseCategory, LucideIcon> = {
  DINNER: UtensilsCrossed,
  TRANSPORTATION: Car,
  VISA: Stamp,
  LUNCH: Sandwich,
  COFFEE: Coffee,
  OTHER: Ellipsis,
};
