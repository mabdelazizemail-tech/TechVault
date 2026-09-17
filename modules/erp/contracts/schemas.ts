import { z } from "zod";
import { MAX_JOURNAL_LINES, isIsoDate, parseAmountText } from "../domain/journal";
import {
  MAX_INVOICE_LINES,
  agingBoundaryProblem,
  parseQuantityText,
  parseRateText,
} from "../domain/ar";
import { ACCOUNT_TYPES, JOURNAL_KINDS, JOURNAL_STATUSES, NORMAL_BALANCES } from "./types";

/**
 * Input schemas for ERP finance (CLAUDE.md §9 rule 3). The server validates every
 * value again, whatever the form already checked — client validation is a
 * convenience, never the control.
 */

const blankToUndefined = (value: unknown) =>
  value === "" || value === null ? undefined : value;

const requiredText = (label: string, max: number) =>
  z.string().trim().min(1, `${label} is required.`).max(max, `${label} is too long.`);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "This is too long.")
    .nullish()
    .transform((value) =>
      value === undefined || value === null || value === "" ? null : value,
    );

const uuid = z.uuid({ error: "Choose a valid option." });

const optionalUuid = z
  .preprocess(blankToUndefined, uuid.optional())
  .transform((value) => value ?? null);

const isoDate = z
  .string({ error: "Enter a date." })
  .trim()
  .refine(isIsoDate, "Enter a valid date.");

const code = z
  .string({ error: "Code is required." })
  .trim()
  .min(1, "Code is required.")
  .max(20, "Code is too long.")
  .regex(/^[0-9A-Za-z][0-9A-Za-z.-]*$/, "Use letters, digits, dots and hyphens only.");

/**
 * A money amount typed in major units ("50,000.00"), converted exactly to minor
 * units. A number is accepted only if its text form is exact; a float that has
 * already drifted ("0.30000000000000004") is refused, not rounded.
 */
const amount = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((value, context) => {
    const parsed = parseAmountText(
      value === null || value === undefined ? "" : String(value),
    );
    if (!parsed.ok) {
      context.addIssue({ code: "custom", message: parsed.message });
      return z.NEVER;
    }
    return parsed.minor;
  });

export const journalLineSchema = z
  .object({
    accountId: z.uuid({ error: "Choose an account." }),
    costCentreId: optionalUuid,
    description: optionalText(300),
    debit: amount,
    credit: amount,
  })
  .superRefine((line, context) => {
    if (line.debit > 0n && line.credit > 0n) {
      context.addIssue({
        code: "custom",
        path: ["credit"],
        message: "A line is a debit or a credit, not both.",
      });
    }
    if (line.debit === 0n && line.credit === 0n) {
      context.addIssue({
        code: "custom",
        path: ["debit"],
        message: "Enter a debit or a credit amount.",
      });
    }
  });

/** A draft journal entry. Balance is checked at posting, so a draft may be saved
 * while it is still being worked on. */
export const journalDraftSchema = z.object({
  /** People enter standard entries and opening balances; year-end close writes its own. */
  kind: z
    .enum(["STANDARD", "OPENING_BALANCE"], { error: "Choose an entry type." })
    .default("STANDARD"),
  entryDate: isoDate,
  description: requiredText("Description", 500),
  reference: optionalText(100),
  lines: z
    .array(journalLineSchema, { error: "Add the lines of the entry." })
    .min(2, "A journal entry needs at least two lines.")
    .max(
      MAX_JOURNAL_LINES,
      `A journal entry can have at most ${MAX_JOURNAL_LINES} lines.`,
    ),
});
export type JournalDraftInput = z.input<typeof journalDraftSchema>;

export const journalReverseSchema = z.object({
  /** Defaults to today. It must fall in an open period. */
  reversalDate: z.preprocess(blankToUndefined, isoDate.optional()),
  description: optionalText(500),
});
export type JournalReverseInput = z.input<typeof journalReverseSchema>;

export const periodCreateSchema = z
  .object({
    name: requiredText("Name", 60),
    startDate: isoDate,
    endDate: isoDate,
  })
  .refine((period) => period.startDate <= period.endDate, {
    path: ["endDate"],
    message: "The end date must be on or after the start date.",
  });
export type PeriodCreateInput = z.input<typeof periodCreateSchema>;

export const periodReopenSchema = z.object({
  reason: requiredText("Reason", 500),
});
export type PeriodReopenInput = z.input<typeof periodReopenSchema>;

export const accountCreateSchema = z.object({
  code,
  name: requiredText("Name", 150),
  nameAr: optionalText(150),
  type: z.enum(ACCOUNT_TYPES, { error: "Choose an account type." }),
  /** Defaults from the type when omitted. */
  normalBalance: z.preprocess(blankToUndefined, z.enum(NORMAL_BALANCES).optional()),
  parentId: optionalUuid,
  isPostable: z.boolean().default(true),
  description: optionalText(500),
});
export type AccountCreateInput = z.input<typeof accountCreateSchema>;

/** The code is fixed once an account exists: it is how people and reports refer to it. */
export const accountUpdateSchema = accountCreateSchema.omit({ code: true });
export type AccountUpdateInput = z.input<typeof accountUpdateSchema>;

export const activeSchema = z.object({ isActive: z.boolean() });

export const costCentreCreateSchema = z.object({
  code,
  name: requiredText("Name", 150),
  nameAr: optionalText(150),
  parentId: optionalUuid,
});
export type CostCentreCreateInput = z.input<typeof costCentreCreateSchema>;

export const costCentreUpdateSchema = z.object({
  name: requiredText("Name", 150),
  nameAr: optionalText(150),
  parentId: optionalUuid,
  isActive: z.boolean(),
});
export type CostCentreUpdateInput = z.input<typeof costCentreUpdateSchema>;

/** List filters from the URL. Anything malformed is ignored rather than an error. */
export const listParamsSchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).catch(1),
  q: z.string().trim().max(100).optional().catch(undefined),
  status: z.enum(JOURNAL_STATUSES).optional().catch(undefined),
  kind: z.enum(JOURNAL_KINDS).optional().catch(undefined),
  type: z.enum(ACCOUNT_TYPES).optional().catch(undefined),
  active: z.enum(["active", "inactive", "all"]).catch("all"),
  from: isoDate.optional().catch(undefined),
  to: isoDate.optional().catch(undefined),
  period: z.uuid().optional().catch(undefined),
});

/** Finance settings (ADR-027). Account types are checked by the service. */
export const financeSettingsSchema = z.object({
  allowSelfPosting: z.boolean({
    error: "Choose whether people may post their own entries.",
  }),
  retainedEarningsAccountId: optionalUuid,
  openingBalanceAccountId: optionalUuid,
});

/** A calendar fiscal year (ADR-028). */
const fiscalYear = z.coerce
  .number({ error: "Choose a year." })
  .int("Choose a year.")
  .min(1900, "Choose a year.")
  .max(9999, "Choose a year.");

export const fiscalYearSchema = z.object({ year: fiscalYear });

export const fiscalYearReopenSchema = z.object({
  year: fiscalYear,
  reason: requiredText("Reason", 500),
});

/** Dates for the ledger reports (ADR-026). The service applies the defaults. */
export const ledgerReportParamsSchema = z.object({
  from: isoDate.optional().catch(undefined),
  to: isoDate.optional().catch(undefined),
});

/* ========================================================================== */
/* Accounts receivable (ADR-023)                                              */
/* ========================================================================== */

/** A quantity typed as text, kept exact to four decimal places, above zero. */
const quantity = z
  .union([z.string(), z.number()], { error: "Enter a quantity." })
  .transform((value, context) => {
    const parsed = parseQuantityText(String(value));
    if (!parsed.ok) {
      context.addIssue({ code: "custom", message: parsed.message });
      return z.NEVER;
    }
    return parsed.scaled;
  });

const positiveAmount = amount.refine(
  (value) => value > 0n,
  "Enter an amount above zero.",
);

/** An optional money amount: blank means "not set", never zero. */
const optionalAmount = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((value, context) => {
    if (value === null || value === undefined || String(value).trim() === "") return null;
    const parsed = parseAmountText(String(value));
    if (!parsed.ok) {
      context.addIssue({ code: "custom", message: parsed.message });
      return z.NEVER;
    }
    return parsed.minor;
  });

const DAYS_MESSAGE = "Enter whole days between 0 and 3650.";

function daysOf(value: string | number): number | null {
  const text = String(value).trim();
  return /^\d{1,4}$/.test(text) && Number(text) <= 3650 ? Number(text) : null;
}

const requiredDays = z
  .union([z.string(), z.number()], { error: DAYS_MESSAGE })
  .transform((value, context) => {
    const days = daysOf(value);
    if (days === null) {
      context.addIssue({ code: "custom", message: DAYS_MESSAGE });
      return z.NEVER;
    }
    return days;
  });

const optionalDays = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((value, context) => {
    if (value === null || value === undefined || String(value).trim() === "") return null;
    const days = daysOf(value);
    if (days === null) {
      context.addIssue({ code: "custom", message: DAYS_MESSAGE });
      return z.NEVER;
    }
    return days;
  });

export const arInvoiceLineSchema = z.object({
  description: requiredText("Description", 300),
  quantity,
  unitPrice: amount,
  discount: amount,
  taxRateId: optionalUuid,
  revenueAccountId: z.uuid({ error: "Choose a revenue account." }),
  costCentreId: optionalUuid,
});

/**
 * A draft invoice as typed. It carries no totals and no status: the server prices
 * every line and decides the lifecycle.
 */
export const arInvoiceDraftSchema = z
  .object({
    crmAccountId: z.uuid({ error: "Choose a customer." }),
    invoiceDate: isoDate,
    /** Defaults from the customer's payment terms when left blank. */
    dueDate: z.preprocess(blankToUndefined, isoDate.optional()),
    reference: optionalText(100),
    notes: optionalText(1000),
    lines: z
      .array(arInvoiceLineSchema, { error: "Add the invoice lines." })
      .min(1, "An invoice needs at least one line.")
      .max(MAX_INVOICE_LINES, `An invoice can have at most ${MAX_INVOICE_LINES} lines.`),
  })
  .refine(
    (invoice) => invoice.dueDate === undefined || invoice.dueDate >= invoice.invoiceDate,
    { path: ["dueDate"], message: "The due date cannot be before the invoice date." },
  );
export type ArInvoiceDraftInput = z.input<typeof arInvoiceDraftSchema>;

/**
 * A credit note as typed: the invoice it corrects, its reason and its lines. Like an
 * invoice it carries no totals and no status — the server prices and decides (ADR-029).
 */
export const arCreditNoteDraftSchema = z.object({
  invoiceId: z.uuid({ error: "Choose the invoice to credit." }),
  creditNoteDate: isoDate,
  reason: requiredText("Reason", 500),
  notes: optionalText(1000),
  lines: z
    .array(arInvoiceLineSchema, { error: "Add the credit note lines." })
    .min(1, "A credit note needs at least one line.")
    .max(MAX_INVOICE_LINES, `A credit note can have at most ${MAX_INVOICE_LINES} lines.`),
});
export type ArCreditNoteDraftInput = z.input<typeof arCreditNoteDraftSchema>;

export const arReasonSchema = z.object({ reason: requiredText("Reason", 500) });

export const arCancelSchema = z.object({
  reason: requiredText("Reason", 500),
  /** For a posted document: the date of the void entry. Defaults to today. */
  voidDate: z.preprocess(blankToUndefined, isoDate.optional()),
});

export const arReceiptDraftSchema = z.object({
  crmAccountId: z.uuid({ error: "Choose a customer." }),
  receiptDate: isoDate,
  amount: positiveAmount,
  paymentMethodId: z.uuid({ error: "Choose a payment method." }),
  depositAccountId: z.uuid({ error: "Choose the bank or cash account." }),
  reference: optionalText(100),
  notes: optionalText(1000),
});
export type ArReceiptDraftInput = z.input<typeof arReceiptDraftSchema>;

export const arAllocationSchema = z
  .object({
    allocations: z
      .array(
        z.object({
          invoiceId: z.uuid({ error: "Choose an invoice." }),
          amount: positiveAmount,
        }),
        { error: "Enter the allocations." },
      )
      .min(1, "Allocate to at least one invoice.")
      .max(100, "Allocate to at most 100 invoices at once."),
  })
  .refine(
    (input) =>
      new Set(input.allocations.map((allocation) => allocation.invoiceId)).size ===
      input.allocations.length,
    { path: ["allocations"], message: "Each invoice can appear only once." },
  );

export const arUnallocateSchema = z.object({
  invoiceId: z.uuid({ error: "Choose an invoice." }),
});

export const arCustomerProfileSchema = z.object({
  paymentTermsDays: optionalDays,
  creditLimit: optionalAmount,
  receivableAccountId: optionalUuid,
  notes: optionalText(1000),
});

export const arSettingsSchema = z.object({
  defaultReceivableAccountId: optionalUuid,
  invoiceApprovalRequired: z.boolean(),
  approvalThreshold: optionalAmount,
  allowSelfApproval: z.boolean(),
  defaultPaymentTermsDays: requiredDays,
  agingBucketDays: z
    .union([z.string(), z.array(z.number())], { error: "Enter the aging boundaries." })
    .transform((value, context) => {
      const parts = Array.isArray(value)
        ? value
        : value
            .split(/[\s,]+/)
            .filter((part) => part !== "")
            .map(Number);
      const problem = agingBoundaryProblem(parts);
      if (problem !== null) {
        context.addIssue({ code: "custom", message: problem });
        return z.NEVER;
      }
      return parts;
    }),
});

export const taxRateSchema = z.object({
  code,
  name: requiredText("Name", 100),
  nameAr: optionalText(100),
  rate: z
    .union([z.string(), z.number()], { error: "Enter the rate." })
    .transform((value, context) => {
      const parsed = parseRateText(String(value));
      if (!parsed.ok) {
        context.addIssue({ code: "custom", message: parsed.message });
        return z.NEVER;
      }
      return parsed.basisPoints;
    }),
  taxAccountId: z.uuid({ error: "Choose the tax account." }),
  /** For purchases (ADR-033): input VAT asset account, or an expense if not reclaimable. */
  inputTaxAccountId: optionalUuid,
  isActive: z.boolean().default(true),
});

export const paymentMethodSchema = z.object({
  code,
  name: requiredText("Name", 100),
  nameAr: optionalText(100),
  defaultDepositAccountId: optionalUuid,
  isActive: z.boolean().default(true),
  sortOrder: z.coerce
    .number({ error: "Enter a number." })
    .int("Use a whole number.")
    .min(0, "Use 0 or more.")
    .max(999, "Use 999 or less.")
    .default(0),
});

export const numberSeriesSchema = z.object({
  prefix: z
    .string({ error: "Enter a prefix." })
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{1,12}$/, "Use up to 12 letters and digits."),
  padding: z.coerce
    .number({ error: "Enter a number of digits." })
    .int("Use a whole number.")
    .min(1, "Use at least 1 digit.")
    .max(12, "Use at most 12 digits."),
  resetsYearly: z.boolean(),
});

/** AR list filters from the URL. Anything malformed is ignored rather than an error. */
export const arListParamsSchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).catch(1),
  q: z.string().trim().max(100).optional().catch(undefined),
  status: z.string().trim().max(40).optional().catch(undefined),
  customer: z.uuid().optional().catch(undefined),
  from: isoDate.optional().catch(undefined),
  to: isoDate.optional().catch(undefined),
  dueFrom: isoDate.optional().catch(undefined),
  dueTo: isoDate.optional().catch(undefined),
  asOf: isoDate.optional().catch(undefined),
  overdue: z.enum(["1"]).optional().catch(undefined),
  sort: z
    .enum(["date", "due", "number", "total", "outstanding", "amount"])
    .optional()
    .catch(undefined),
  dir: z.enum(["asc", "desc"]).catch("desc"),
  vendor: z.uuid().optional().catch(undefined),
});

/* Accounts payable (ADR-033) ---------------------------------------------------- */

const optionalEmail = z
  .string()
  .trim()
  .max(200, "This is too long.")
  .nullish()
  .transform((value) =>
    value === undefined || value === null || value === "" ? null : value,
  )
  .refine((value) => value === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), {
    message: "Enter a valid email address.",
  });

export const vendorSchema = z.object({
  name: requiredText("Name", 200),
  nameAr: optionalText(200),
  taxRegistrationNumber: optionalText(50),
  crmAccountId: optionalUuid,
  email: optionalEmail,
  phone: optionalText(50),
  address: optionalText(500),
  paymentTermsDays: optionalDays,
  payableAccountId: optionalUuid,
  defaultExpenseAccountId: optionalUuid,
  defaultWithholdingTaxRateId: optionalUuid,
  notes: optionalText(1000),
  isActive: z.boolean().default(true),
});
export type VendorInput = z.input<typeof vendorSchema>;

export const withholdingTaxRateSchema = z.object({
  code,
  name: requiredText("Name", 100),
  nameAr: optionalText(100),
  rate: z
    .union([z.string(), z.number()], { error: "Enter the rate." })
    .transform((value, context) => {
      const parsed = parseRateText(String(value));
      if (!parsed.ok) {
        context.addIssue({ code: "custom", message: parsed.message });
        return z.NEVER;
      }
      if (parsed.basisPoints <= 0) {
        context.addIssue({
          code: "custom",
          message: "A withholding rate is above zero.",
        });
        return z.NEVER;
      }
      return parsed.basisPoints;
    }),
  payableAccountId: z.uuid({ error: "Choose the withholding tax payable account." }),
  isActive: z.boolean().default(true),
});

export const apSettingsSchema = z.object({
  defaultPayableAccountId: optionalUuid,
  billApprovalRequired: z.boolean(),
  billApprovalThreshold: optionalAmount,
  paymentApprovalRequired: z.boolean(),
  paymentApprovalThreshold: optionalAmount,
  allowSelfApproval: z.boolean(),
  defaultPaymentTermsDays: requiredDays,
  agingBucketDays: arSettingsSchema.shape.agingBucketDays,
});

export const apBillLineSchema = z.object({
  description: requiredText("Description", 300),
  quantity,
  unitPrice: amount,
  discount: amount,
  taxRateId: optionalUuid,
  expenseAccountId: z.uuid({ error: "Choose an expense account." }),
  costCentreId: optionalUuid,
});

/** A draft bill as typed: no totals and no status — the server prices and decides. */
export const apBillDraftSchema = z
  .object({
    vendorId: z.uuid({ error: "Choose a vendor." }),
    vendorInvoiceNumber: requiredText("The supplier's invoice number", 100),
    billDate: isoDate,
    /** Defaults from the vendor's payment terms when left blank. */
    dueDate: z.preprocess(blankToUndefined, isoDate.optional()),
    reference: optionalText(100),
    notes: optionalText(1000),
    lines: z
      .array(apBillLineSchema, { error: "Add the bill lines." })
      .min(1, "A bill needs at least one line.")
      .max(MAX_INVOICE_LINES, `A bill can have at most ${MAX_INVOICE_LINES} lines.`),
  })
  .refine((bill) => bill.dueDate === undefined || bill.dueDate >= bill.billDate, {
    path: ["dueDate"],
    message: "The due date cannot be before the bill date.",
  });
export type ApBillDraftInput = z.input<typeof apBillDraftSchema>;

/**
 * A draft payment as typed: which bills it settles, how much of each, and the
 * withholding rate for each. Withholding and cash are the server's to calculate.
 */
export const apPaymentDraftSchema = z
  .object({
    vendorId: z.uuid({ error: "Choose a vendor." }),
    paymentDate: isoDate,
    paymentMethodId: z.uuid({ error: "Choose a payment method." }),
    bankAccountId: z.uuid({ error: "Choose the bank or cash account paid from." }),
    reference: optionalText(100),
    notes: optionalText(1000),
    lines: z
      .array(
        z.object({
          billId: z.uuid({ error: "Choose a bill." }),
          amount: positiveAmount,
          withholdingTaxRateId: optionalUuid,
        }),
        { error: "Choose the bills to pay." },
      )
      .min(1, "Choose at least one bill to pay.")
      .max(100, "A payment can settle at most 100 bills."),
  })
  .refine(
    (payment) =>
      new Set(payment.lines.map((line) => line.billId)).size === payment.lines.length,
    { path: ["lines"], message: "Each bill can appear only once." },
  );
export type ApPaymentDraftInput = z.input<typeof apPaymentDraftSchema>;
