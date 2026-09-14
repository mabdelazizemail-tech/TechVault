import { z } from "zod";
import { MAX_JOURNAL_LINES, isIsoDate, parseAmountText } from "../domain/journal";
import { ACCOUNT_TYPES, JOURNAL_STATUSES, NORMAL_BALANCES } from "./types";

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
  type: z.enum(ACCOUNT_TYPES).optional().catch(undefined),
  active: z.enum(["active", "inactive", "all"]).catch("all"),
  from: isoDate.optional().catch(undefined),
  to: isoDate.optional().catch(undefined),
  period: z.uuid().optional().catch(undefined),
});
