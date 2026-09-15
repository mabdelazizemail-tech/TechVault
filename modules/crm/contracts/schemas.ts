import { z } from "zod";
import {
  COMPANY_SIZES,
  CRM_CURRENCIES,
  CRM_DEFAULT_CURRENCY,
  DECISION_MAKER_OPTIONS,
  LEAD_SOURCES,
  LEAD_STATUSES,
  LOGGABLE_ACTIVITY_TYPES,
  LOST_REASONS,
  PRIORITIES,
  PURCHASE_TIMELINES,
  SALES_CHANNELS,
} from "./types";

/**
 * Input schemas (CLAUDE.md §9 rule 3, §16.5).
 *
 * The SAME schema validates a form in the browser and the Server Action on the
 * server: client validation is convenience, server validation is truth.
 *
 * Money arrives as a major-unit number from forms and is converted to minor units
 * in the service, in the record's own currency — never stored as a float.
 */

/** Empty form fields arrive as "" — treat them as absent rather than as values. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value === undefined || value === "" ? null : value));

const requiredText = (label: string, max = 200) =>
  z.string().trim().min(1, `${label} is required.`).max(max);

const blankToUndefined = (value: unknown) =>
  value === "" || value === null ? undefined : value;

/** An optional enum where an empty select means "not chosen". */
const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess(blankToUndefined, z.enum(values).optional());

const optionalEmail = z
  .string()
  .trim()
  .max(320)
  .optional()
  .transform((value) =>
    value === undefined || value === "" ? null : value.toLowerCase(),
  )
  .refine((value) => value === null || z.email().safeParse(value).success, {
    message: "Enter a valid email address.",
  });

const optionalUrl = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((value) => {
    if (value === undefined || value === "") return null;
    return /^https?:\/\//i.test(value) ? value : `https://${value}`;
  })
  .refine((value) => value === null || URL.canParse(value), {
    message: "Enter a valid website address.",
  });

/** A non-negative major-unit amount, e.g. 45000 or 45000.50. */
const moneyMajor = z.coerce
  .number({ error: "Enter an amount." })
  .min(0, "The amount cannot be negative.")
  .max(20_000_000, "The amount is too large.");

const optionalMoneyMajor = z.preprocess(blankToUndefined, moneyMajor.optional());

const percentage = z.coerce.number().int().min(0).max(100);

const optionalUuid = z
  .string()
  .nullish()
  .transform((value) =>
    value === undefined || value === null || value === "" ? null : value,
  )
  .refine((value) => value === null || z.uuid().safeParse(value).success, {
    message: "Invalid reference.",
  });

/** A calendar date from an `<input type="date">`, stored as UTC midnight. */
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.")
  .transform((value) => new Date(`${value}T00:00:00.000Z`));

const currency = z.preprocess(
  (value) =>
    value === "" || value === undefined || value === null ? CRM_DEFAULT_CURRENCY : value,
  z.enum(CRM_CURRENCIES),
);

const channel = z.preprocess(
  (value) => (value === "" || value === undefined || value === null ? "DIRECT" : value),
  z.enum(SALES_CHANNELS),
);

/** An indirect deal must name its channel partner. */
function requirePartner(
  value: { channel: "DIRECT" | "INDIRECT"; partnerName: string | null },
  context: z.RefinementCtx,
): void {
  if (value.channel === "INDIRECT" && value.partnerName === null) {
    context.addIssue({
      code: "custom",
      path: ["partnerName"],
      message: "Name the channel partner for an indirect deal.",
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Leads                                                                      */
/* -------------------------------------------------------------------------- */

export const leadInfoSchema = z.object({
  firstName: requiredText("First name", 100),
  lastName: requiredText("Last name", 100),
  company: requiredText("Company"),
  jobTitle: optionalText(150),
  email: optionalEmail,
  phone: optionalText(50),
  website: optionalUrl,
  source: z.enum(LEAD_SOURCES, { error: "Choose where this lead came from." }),
  industry: optionalText(100),
  companySize: optionalEnum(COMPANY_SIZES).transform((value) => value ?? null),
  country: optionalText(100),
  city: optionalText(100),
});

/** The qualification statuses a salesperson can choose in the wizard. */
export const QUALIFICATION_STATUSES = [
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "DISQUALIFIED",
] as const;

export const leadQualificationSchema = z.object({
  interest: optionalText(500),
  budget: optionalMoneyMajor,
  budgetCurrency: currency,
  timeline: optionalEnum(PURCHASE_TIMELINES),
  decisionMaker: optionalEnum(DECISION_MAKER_OPTIONS),
  currentSolution: optionalText(500),
  painPoint: optionalText(1000),
  score: percentage.default(50),
  status: z.enum(QUALIFICATION_STATUSES).default("NEW"),
});

export const opportunityDraftSchema = z
  .object({
    name: requiredText("Opportunity name"),
    amount: moneyMajor,
    currency,
    closeDate: calendarDate,
    product: optionalText(200),
    probability: percentage,
    channel,
    partnerName: optionalText(150),
    ownerId: optionalUuid,
    stageId: optionalUuid,
  })
  .superRefine(requirePartner);

/** The whole wizard, submitted once on the review step. */
export const createLeadSchema = z.object({
  info: leadInfoSchema,
  qualification: leadQualificationSchema,
  ownerId: optionalUuid,
  /** Present only when the salesperson chose "Save & Create Opportunity". */
  opportunity: opportunityDraftSchema.nullable(),
});

export const updateLeadSchema = leadInfoSchema
  .extend(leadQualificationSchema.shape)
  .extend({
    ownerId: optionalUuid,
  });

export const setLeadStatusSchema = z.object({
  leadId: z.uuid(),
  status: z.enum(LEAD_STATUSES).exclude(["CONVERTED"]),
});

export const convertLeadSchema = z.object({
  leadId: z.uuid(),
  /** "existing" reuses `accountId`; "new" creates a company from the lead. */
  accountMode: z.enum(["existing", "new"]),
  accountId: optionalUuid,
  contactMode: z.enum(["existing", "new"]),
  contactId: optionalUuid,
  createOpportunity: z.boolean(),
  opportunity: opportunityDraftSchema.nullable(),
});

/* -------------------------------------------------------------------------- */
/* Accounts and contacts                                                      */
/* -------------------------------------------------------------------------- */

export const accountSchema = z.object({
  name: requiredText("Company name"),
  website: optionalUrl,
  industry: optionalText(100),
  companySize: optionalEnum(COMPANY_SIZES).transform((value) => value ?? null),
  country: optionalText(100),
  city: optionalText(100),
  phone: optionalText(50),
  description: optionalText(2000),
  ownerId: optionalUuid,
});

export const contactSchema = z.object({
  firstName: requiredText("First name", 100),
  lastName: requiredText("Last name", 100),
  jobTitle: optionalText(150),
  email: optionalEmail,
  phone: optionalText(50),
  country: optionalText(100),
  city: optionalText(100),
  accountId: optionalUuid,
  ownerId: optionalUuid,
});

/* -------------------------------------------------------------------------- */
/* Opportunities                                                              */
/* -------------------------------------------------------------------------- */

const opportunityFields = z.object({
  name: requiredText("Opportunity name"),
  accountId: z.uuid({ error: "Choose a company." }),
  primaryContactId: optionalUuid,
  stageId: z.uuid({ error: "Choose a stage." }),
  amount: moneyMajor,
  currency,
  closeDate: calendarDate,
  probability: percentage,
  priority: z.preprocess(blankToUndefined, z.enum(PRIORITIES).default("MEDIUM")),
  channel,
  partnerName: optionalText(150),
  source: optionalEnum(LEAD_SOURCES).transform((value) => value ?? null),
  product: optionalText(200),
  description: optionalText(4000),
  ownerId: optionalUuid,
});

export const opportunitySchema = opportunityFields.superRefine(requirePartner);

/** Editing a deal never changes its stage — that goes through the pipeline. */
export const opportunityEditSchema = opportunityFields
  .omit({ stageId: true })
  .superRefine(requirePartner);

/** Closing details, required when the destination stage is WON or LOST. */
export const closeWonSchema = z.object({
  kind: z.literal("WON"),
  actualCloseDate: calendarDate,
  finalAmount: moneyMajor,
  notes: optionalText(2000),
});

export const closeLostSchema = z.object({
  kind: z.literal("LOST"),
  lostReason: z.enum(LOST_REASONS, { error: "Choose why the deal was lost." }),
  notes: optionalText(2000),
});

export const moveOpportunitySchema = z.object({
  opportunityId: z.uuid(),
  stageId: z.uuid(),
  close: z.discriminatedUnion("kind", [closeWonSchema, closeLostSchema]).nullable(),
});

/* -------------------------------------------------------------------------- */
/* Activities                                                                 */
/* -------------------------------------------------------------------------- */

const optionalDateTime = (message: string) =>
  z
    .string()
    .nullish()
    .transform((value) =>
      value === undefined || value === null || value === "" ? null : new Date(value),
    )
    .refine((value) => value === null || !Number.isNaN(value.getTime()), { message });

/** What an activity says and when — everything a person may later correct. */
const activityFields = z.object({
  subject: requiredText("Subject"),
  body: optionalText(8000),
  occurredAt: optionalDateTime("Choose a valid date and time."),
  durationMinutes: z.preprocess(
    blankToUndefined,
    z.coerce
      .number()
      .int()
      .min(0)
      .max(24 * 60)
      .optional(),
  ),
  dueAt: optionalDateTime("Choose a valid due date."),
  priority: optionalEnum(PRIORITIES),
  assigneeId: optionalUuid,
});

/**
 * Editing an activity. Its type and the records it is linked to are not part of
 * this schema: what an activity is about never changes after it is logged.
 */
export const activityUpdateSchema = activityFields;

export const activitySchema = activityFields
  .extend({
    type: z.enum(LOGGABLE_ACTIVITY_TYPES),
    leadId: optionalUuid,
    accountId: optionalUuid,
    contactId: optionalUuid,
    opportunityId: optionalUuid,
  })
  .refine(
    (value) =>
      value.leadId !== null ||
      value.accountId !== null ||
      value.contactId !== null ||
      value.opportunityId !== null,
    { message: "An activity must be linked to a record.", path: ["subject"] },
  );

/** A CRM record an administrator is about to delete. */
export const deletionTargetSchema = z.object({
  kind: z.enum(["lead", "account", "contact", "opportunity"]),
  id: z.string(),
});

/* -------------------------------------------------------------------------- */
/* Lists                                                                      */
/* -------------------------------------------------------------------------- */

export const listParamsSchema = z.object({
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce.number().int().min(1).max(100).catch(25),
  q: z.string().trim().max(200).optional().catch(undefined),
  sort: z.string().max(40).optional().catch(undefined),
  dir: z.enum(["asc", "desc"]).catch("desc"),
});

const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .catch(undefined);

export const pipelineFiltersSchema = z.object({
  ownerId: optionalUuid.catch(null),
  stageId: optionalUuid.catch(null),
  minAmount: z
    .preprocess(blankToUndefined, z.coerce.number().min(0).optional())
    .catch(undefined),
  maxAmount: z
    .preprocess(blankToUndefined, z.coerce.number().min(0).optional())
    .catch(undefined),
  currency: optionalEnum(CRM_CURRENCIES).catch(undefined),
  channel: optionalEnum(SALES_CHANNELS).catch(undefined),
  closeFrom: isoDay,
  closeTo: isoDay,
  industry: z.string().trim().max(100).optional().catch(undefined),
  source: optionalEnum(LEAD_SOURCES).catch(undefined),
  q: z.string().trim().max(200).optional().catch(undefined),
});

export type CreateLeadInput = z.input<typeof createLeadSchema>;
export type UpdateLeadInput = z.input<typeof updateLeadSchema>;
export type ConvertLeadInput = z.input<typeof convertLeadSchema>;
export type AccountInput = z.input<typeof accountSchema>;
export type ContactInput = z.input<typeof contactSchema>;
export type OpportunityInput = z.input<typeof opportunitySchema>;
export type MoveOpportunityInput = z.input<typeof moveOpportunitySchema>;
export type ActivityInput = z.input<typeof activitySchema>;
export type ListParams = z.output<typeof listParamsSchema>;
export type PipelineFilters = z.output<typeof pipelineFiltersSchema>;
