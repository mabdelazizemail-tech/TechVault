/**
 * Pure rules for mission expenses (ADR-037): which categories and currencies exist,
 * how a typed amount becomes minor units, and how a receipt picture is recognised.
 * No I/O.
 */

/* Categories and statuses ---------------------------------------------------- */

export const EXPENSE_CATEGORIES = [
  "DINNER",
  "TRANSPORTATION",
  "VISA",
  "LUNCH",
  "COFFEE",
  "OTHER",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  DINNER: "Dinner",
  TRANSPORTATION: "Transportation",
  VISA: "Visa",
  LUNCH: "Lunch meal",
  COFFEE: "Coffee",
  OTHER: "Other",
};

export const EXPENSE_STATUSES = ["SUBMITTED", "APPROVED", "REJECTED"] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

export const EXPENSE_STATUS_LABELS: Record<ExpenseStatus, string> = {
  SUBMITTED: "Submitted",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

/* Currencies and amounts -------------------------------------------------------- */

/**
 * Currencies a claim may be made in. Every one has two decimal places, so an amount
 * is always stored as hundredths (ADR-006); one with a different exponent would need
 * its own rule before it is added here.
 */
export const EXPENSE_CURRENCIES = [
  "EGP",
  "USD",
  "EUR",
  "GBP",
  "TRY",
  "AED",
  "SAR",
] as const;
export type ExpenseCurrency = (typeof EXPENSE_CURRENCIES)[number];

export function isExpenseCurrency(value: string): value is ExpenseCurrency {
  return (EXPENSE_CURRENCIES as readonly string[]).includes(value);
}

/** The largest single claim: 10,000,000.00 (a CHECK holds the same limit). */
export const MAX_AMOUNT_MINOR = 1_000_000_000;

const ARABIC_INDIC_DIGITS = /[\u0660-\u0669]/g;
const EXTENDED_ARABIC_DIGITS = /[\u06F0-\u06F9]/g;

export type AmountParse = { ok: true; minor: number } | { ok: false; message: string };

/**
 * "1,250.50" → 125050, exactly: no floating point is involved. Arabic-Indic digits
 * and the Arabic decimal separator are accepted, as typed on Arabic phone keyboards.
 */
export function parseAmountText(raw: string): AmountParse {
  const text = raw
    .replace(ARABIC_INDIC_DIGITS, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(EXTENDED_ARABIC_DIGITS, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/\u066B/g, ".")
    .replace(/[\s,\u066C\u00A0]/g, "");

  if (text === "") return { ok: false, message: "Enter the amount." };
  if (text.startsWith("-"))
    return { ok: false, message: "The amount must be above zero." };
  const match = /^(\d+)(?:\.(\d*))?$/.exec(text);
  if (match === null) return { ok: false, message: "Enter an amount such as 1250.50." };

  const fraction = match[2] ?? "";
  if (fraction.length > 2)
    return { ok: false, message: "Use at most two decimal places." };
  const whole = (match[1] ?? "0").replace(/^0+(?=\d)/, "");
  if (whole.length > 8) return { ok: false, message: "This amount is too large." };

  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (minor <= 0) return { ok: false, message: "The amount must be above zero." };
  if (minor > MAX_AMOUNT_MINOR)
    return { ok: false, message: "This amount is too large." };
  return { ok: true, minor };
}

/** 125050, "TRY" → "TRY 1,250.50". Display only, and exact. */
export function formatExpenseAmount(minor: number, currency: string): string {
  const whole = Math.trunc(minor / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = String(Math.abs(minor % 100)).padStart(2, "0");
  return `${currency} ${whole}.${fraction}`;
}

/* Totals --------------------------------------------------------------------------- */

/**
 * One currency's totals: submitted and approved claims, rejected ones left out.
 * Amounts in different currencies are never added together.
 */
export type CurrencyTotal = {
  currency: string;
  claimedMinor: number;
  approvedMinor: number;
  count: number;
};

/** Folds per-currency, per-status sums (a database groupBy) into one total per currency, sorted by code. */
export function totalsByCurrency(
  groups: readonly {
    currency: string;
    status: ExpenseStatus;
    amountMinor: number;
    count: number;
  }[],
): CurrencyTotal[] {
  const totals = new Map<string, CurrencyTotal>();
  for (const group of groups) {
    if (group.status === "REJECTED") continue;
    const total = totals.get(group.currency) ?? {
      currency: group.currency,
      claimedMinor: 0,
      approvedMinor: 0,
      count: 0,
    };
    total.claimedMinor += group.amountMinor;
    total.count += group.count;
    if (group.status === "APPROVED") total.approvedMinor += group.amountMinor;
    totals.set(group.currency, total);
  }
  return [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

/* Receipt pictures ----------------------------------------------------------------- */

/** The largest receipt accepted, after the phone has shrunk it (a CHECK holds it too). */
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

/** How many leading bytes the server reads to recognise the picture. */
export const RECEIPT_SNIFF_BYTES = 64;

const RECEIPT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The file's base name, without any path a browser might send, trimmed and bounded. */
export function cleanReceiptName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const printable = Array.from(base)
    .filter((char) => char.charCodeAt(0) >= 0x20)
    .join("");
  return printable.trim().slice(0, 200);
}

/** The content type for an accepted receipt name, or null for anything else. */
export function receiptContentType(fileName: string): string | null {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  return RECEIPT_TYPES[extension] ?? null;
}

/**
 * True when the first bytes really are the picture the name claims: a JPEG named
 * .jpg, a PNG named .png. The name and the browser's content type are never
 * trusted alone (CLAUDE.md §12.2).
 */
export function receiptMatchesContent(fileName: string, head: Uint8Array): boolean {
  const type = receiptContentType(fileName);
  const signature = type === "image/jpeg" ? JPEG : type === "image/png" ? PNG : null;
  return signature !== null && signature.every((byte, index) => head[index] === byte);
}
