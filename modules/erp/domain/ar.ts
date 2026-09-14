/**
 * Accounts receivable arithmetic and rules, as pure functions (CLAUDE.md §20).
 *
 * Every figure is `bigint` minor units. Quantities keep four decimal places as a
 * scaled integer (2.5 → 25000), so a line amount is computed exactly and rounded
 * once, half away from zero — the same rule Postgres' `round(numeric)` applies,
 * which lets the database re-check every stored line (ADR-023).
 */

/** Quantities are held to four decimal places. */
export const QUANTITY_SCALE = 10_000n;
const MAX_QUANTITY_INTEGER_DIGITS = 9;

/** No single line or document amount may exceed 99,999,999,999.99; with at most
 * 200 lines a document total stays inside JavaScript's safe-integer range. */
export const MAX_DOCUMENT_AMOUNT_MINOR = 9_999_999_999_999n;
export const MAX_INVOICE_LINES = 200;
export const BASIS_POINTS_PER_WHOLE = 10_000;

export type QuantityParse = { ok: true; scaled: bigint } | { ok: false; message: string };

/** "2.5" → 25000n. A quantity must be above zero. */
export function parseQuantityText(raw: string): QuantityParse {
  const text = raw.replace(/[\s,]/g, "");
  if (text === "") return { ok: false, message: "Enter a quantity." };
  if (text.startsWith("-"))
    return { ok: false, message: "Quantities cannot be negative." };
  const match = /^(\d+)(?:\.(\d*))?$/.exec(text);
  if (match === null) return { ok: false, message: "Enter a quantity such as 2 or 1.5." };
  const fraction = match[2] ?? "";
  if (fraction.length > 4)
    return { ok: false, message: "Use at most four decimal places." };
  const whole = (match[1] ?? "0").replace(/^0+(?=\d)/, "");
  if (whole.length > MAX_QUANTITY_INTEGER_DIGITS) {
    return { ok: false, message: "This quantity is too large." };
  }
  const scaled = BigInt(whole) * QUANTITY_SCALE + BigInt(fraction.padEnd(4, "0"));
  if (scaled === 0n)
    return { ok: false, message: "The quantity must be more than zero." };
  return { ok: true, scaled };
}

/** 25000n → "2.5000", the exact decimal the database stores. */
export function quantityToDecimal(scaled: bigint): string {
  const whole = scaled / QUANTITY_SCALE;
  const fraction = (scaled % QUANTITY_SCALE).toString().padStart(4, "0");
  return `${whole}.${fraction}`;
}

/** "2.5000" (from the database) → "2.5", for display. */
export function formatQuantity(decimal: string): string {
  return decimal.includes(".") ? decimal.replace(/\.?0+$/, "") : decimal;
}

/** Integer division rounded half away from zero. */
export function divideRounded(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error("Division by zero.");
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const quotient = n / d;
  const rounded = (n % d) * 2n >= d ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

export type LineInput = {
  quantityScaled: bigint;
  unitPriceMinor: bigint;
  discountMinor: bigint;
  /** Null when the line carries no tax. */
  taxBasisPoints: number | null;
};

export type LineAmounts = {
  grossMinor: bigint;
  discountMinor: bigint;
  netMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
};

/**
 * quantity × unit price → gross; gross − discount → net; net × rate → tax;
 * net + tax → total. Tax is rounded per line.
 */
export function calculateLine(line: LineInput): LineAmounts {
  const grossMinor = divideRounded(
    line.quantityScaled * line.unitPriceMinor,
    QUANTITY_SCALE,
  );
  const netMinor = grossMinor - line.discountMinor;
  const taxMinor =
    line.taxBasisPoints === null
      ? 0n
      : divideRounded(
          netMinor * BigInt(line.taxBasisPoints),
          BigInt(BASIS_POINTS_PER_WHOLE),
        );
  return {
    grossMinor,
    discountMinor: line.discountMinor,
    netMinor,
    taxMinor,
    totalMinor: netMinor + taxMinor,
  };
}

/** Messages for a line whose figures cannot stand. Empty when the line is valid. */
export function lineProblems(
  line: LineInput,
): { field: "discount" | "unitPrice"; message: string }[] {
  const problems: { field: "discount" | "unitPrice"; message: string }[] = [];
  const amounts = calculateLine(line);
  if (line.discountMinor > amounts.grossMinor) {
    problems.push({
      field: "discount",
      message: "The discount cannot be more than the line amount.",
    });
  }
  if (
    amounts.grossMinor > MAX_DOCUMENT_AMOUNT_MINOR ||
    amounts.totalMinor > MAX_DOCUMENT_AMOUNT_MINOR
  ) {
    problems.push({ field: "unitPrice", message: "This line amount is too large." });
  }
  return problems;
}

export type DocumentTotals = {
  subtotalMinor: bigint;
  discountMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
};

export function invoiceTotals(lines: readonly LineAmounts[]): DocumentTotals {
  const totals: DocumentTotals = {
    subtotalMinor: 0n,
    discountMinor: 0n,
    taxMinor: 0n,
    totalMinor: 0n,
  };
  for (const line of lines) {
    totals.subtotalMinor += line.grossMinor;
    totals.discountMinor += line.discountMinor;
    totals.taxMinor += line.taxMinor;
    totals.totalMinor += line.totalMinor;
  }
  return totals;
}

/** "14" or "14.5" (percent) → 1400 or 1450 basis points. */
export function parseRateText(
  raw: string,
): { ok: true; basisPoints: number } | { ok: false; message: string } {
  const text = raw.replace(/[\s%]/g, "");
  const match = /^(\d{1,3})(?:\.(\d{0,2}))?$/.exec(text);
  if (match === null) return { ok: false, message: "Enter a rate such as 14 or 14.5." };
  const basisPoints = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  if (basisPoints > BASIS_POINTS_PER_WHOLE) {
    return { ok: false, message: "A rate cannot be more than 100%." };
  }
  return { ok: true, basisPoints };
}

/** 1400 → "14%", 1450 → "14.5%". */
export function formatBasisPoints(basisPoints: number): string {
  const whole = Math.trunc(basisPoints / 100);
  const fraction = String(basisPoints % 100)
    .padStart(2, "0")
    .replace(/0+$/, "");
  return `${whole}${fraction === "" ? "" : `.${fraction}`}%`;
}

/* Approval ------------------------------------------------------------------ */

export type ApprovalSettings = {
  invoiceApprovalRequired: boolean;
  /** When set, only invoices at or above this total need approval. */
  approvalThresholdMinor: bigint | null;
};

export function approvalRequired(
  settings: ApprovalSettings,
  totalMinor: bigint,
): boolean {
  if (!settings.invoiceApprovalRequired) return false;
  return (
    settings.approvalThresholdMinor === null ||
    totalMinor >= settings.approvalThresholdMinor
  );
}

/* Payment status -------------------------------------------------------------- */

export type PostedInvoiceStatus = "POSTED" | "PARTIALLY_PAID" | "PAID";

export function paymentStatus(
  paidMinor: bigint,
  totalMinor: bigint,
): PostedInvoiceStatus {
  if (paidMinor <= 0n) return "POSTED";
  return paidMinor >= totalMinor ? "PAID" : "PARTIALLY_PAID";
}

/* Dates ------------------------------------------------------------------------ */

const DAY_MS = 86_400_000;

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  return new Date(date.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from one ISO date to another; positive when `to` is later. */
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round(
    (Date.parse(`${toIso}T00:00:00.000Z`) - Date.parse(`${fromIso}T00:00:00.000Z`)) /
      DAY_MS,
  );
}

/* Aging ----------------------------------------------------------------------- */

/** Default aging boundaries in days past due; administrators change them in AR settings. */
export const DEFAULT_AGING_BUCKET_DAYS: readonly number[] = [30, 60, 90, 120];

/**
 * The bucket an invoice falls into: 0 is "Current" (not yet past due), 1 is up to
 * the first boundary, and the last bucket is everything beyond the last boundary.
 */
export function agingBucketIndex(
  daysPastDue: number,
  boundaries: readonly number[],
): number {
  if (daysPastDue <= 0) return 0;
  const index = boundaries.findIndex((boundary) => daysPastDue <= boundary);
  return index === -1 ? boundaries.length + 1 : index + 1;
}

/** [30, 60, 90, 120] → ["Current", "1–30", "31–60", "61–90", "91–120", "120+"]. */
export function agingBucketLabels(boundaries: readonly number[]): string[] {
  const labels = ["Current"];
  let previous = 0;
  for (const boundary of boundaries) {
    labels.push(`${previous + 1}–${boundary}`);
    previous = boundary;
  }
  labels.push(`${previous}+`);
  return labels;
}

/** Boundaries must be whole days, strictly ascending, between 1 and 3650, 1–8 of them. */
export function agingBoundaryProblem(boundaries: readonly number[]): string | null {
  if (boundaries.length < 1 || boundaries.length > 8)
    return "Use between one and eight boundaries.";
  for (let index = 0; index < boundaries.length; index += 1) {
    const value = boundaries[index] ?? 0;
    if (!Number.isInteger(value) || value < 1 || value > 3650) {
      return "Each boundary is a whole number of days between 1 and 3650.";
    }
    if (index > 0 && value <= (boundaries[index - 1] ?? 0)) {
      return "Boundaries must increase, e.g. 30, 60, 90, 120.";
    }
  }
  return null;
}

/* Document numbers -------------------------------------------------------------- */

/** INV-2026-000001, or INV-000001 for a series that never resets. */
export function formatDocumentNumber(
  prefix: string,
  year: number | null,
  padding: number,
  sequence: number,
): string {
  const number = String(sequence).padStart(padding, "0");
  return year === null ? `${prefix}-${number}` : `${prefix}-${year}-${number}`;
}
