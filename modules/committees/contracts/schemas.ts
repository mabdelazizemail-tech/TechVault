import { z } from "zod";
import { isIsoDate } from "../domain/dates";
import { DUE_WINDOWS, TASK_DISPLAY_STATUSES, TASK_STATUSES } from "./types";

/**
 * Input schemas for Committees (CLAUDE.md §9 rule 3), shared by Server Actions and
 * forms. Forms send what people typed; empty optional fields arrive as "" and are
 * treated as absent. Status, creator, dates of record and counts are never taken
 * from a client.
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

const isoDate = z
  .string({ error: "Choose a date." })
  .trim()
  .refine(isIsoDate, "Choose a valid date.")
  .refine(
    (value) => value >= "2000-01-01" && value <= "2100-12-31",
    "Choose a date between 2000 and 2100.",
  );

/** A moment sent by the browser as an ISO timestamp (converted from local time there). */
const isoDateTime = z
  .string({ error: "Choose a date and time." })
  .trim()
  .min(1, "Choose a date and time.")
  .transform((value, context) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      context.addIssue({ code: "custom", message: "Choose a valid date and time." });
      return z.NEVER;
    }
    return date;
  });

/* Committees -------------------------------------------------------------------- */

const memberIds = z
  .array(uuid)
  .max(200, "A committee can have at most 200 members.")
  .default([])
  .transform((ids) => [...new Set(ids)]);

export const committeeCreateSchema = z.object({
  name: requiredText("Name", 120),
  description: optionalText(2000),
  memberIds,
});

export const committeeUpdateSchema = committeeCreateSchema.extend({
  isActive: z.boolean(),
});

/* Meetings ----------------------------------------------------------------------- */

export const meetingCreateSchema = z.object({
  committeeId: uuid,
  title: requiredText("Title", 200),
  scheduledAt: isoDateTime,
  location: optionalText(200),
  description: optionalText(5000),
});

export const meetingUpdateSchema = meetingCreateSchema.omit({ committeeId: true });

export const agendaItemSchema = z.object({
  title: requiredText("Title", 200),
  notes: optionalText(5000),
});

/* Tasks -------------------------------------------------------------------------- */

const assignee = z.union([
  z.object({ userId: uuid }),
  z.object({
    name: z
      .string()
      .trim()
      .min(1, "Enter a name.")
      .max(120, "Names are limited to 120 characters."),
  }),
]);

export const taskSchema = z.object({
  description: requiredText("Task description", 5000),
  dueDate: isoDate,
  assignees: z
    .array(assignee, { error: "Choose who is responsible." })
    .min(1, "Choose at least one responsible person.")
    .max(20, "A task can have at most 20 responsible people."),
});

export const statusChangeSchema = z.object({
  status: z.enum(TASK_STATUSES, { error: "Choose a status." }),
  comment: optionalText(5000),
});

export const replySchema = z.object({
  body: requiredText("Reply", 5000),
});

/* List parameters ------------------------------------------------------------------ */

/**
 * "me", "user:<id>" or "name:<typed name>" — the responsible-person filter, which
 * must tell registered users and typed names apart.
 */
const responsibleFilter = z
  .string()
  .trim()
  .max(140)
  .optional()
  .catch(undefined)
  .transform((value) => {
    if (value === undefined || value === "") return undefined;
    if (value === "me") return { kind: "me" as const };
    if (value.startsWith("user:")) {
      const id = value.slice(5);
      return z.uuid().safeParse(id).success ? { kind: "user" as const, id } : undefined;
    }
    if (value.startsWith("name:") && value.length > 5) {
      return { kind: "name" as const, name: value.slice(5) };
    }
    return undefined;
  });

export const taskListParamsSchema = z.object({
  page: z.coerce.number().int().min(1).catch(1),
  q: z.string().trim().max(200).optional().catch(undefined),
  status: z.enum(TASK_DISPLAY_STATUSES).optional().catch(undefined),
  responsible: responsibleFilter,
  due: z.enum(DUE_WINDOWS).optional().catch(undefined),
  committee: z.uuid().optional().catch(undefined),
  sort: z.enum(["due", "created", "status"]).optional().catch(undefined),
  dir: z.enum(["asc", "desc"]).optional().catch(undefined),
});

export const meetingListParamsSchema = z.object({
  page: z.coerce.number().int().min(1).catch(1),
  q: z.string().trim().max(200).optional().catch(undefined),
  committee: z.uuid().optional().catch(undefined),
  when: z.enum(["upcoming", "past"]).catch("upcoming"),
});

export const committeeListParamsSchema = z.object({
  page: z.coerce.number().int().min(1).catch(1),
  q: z.string().trim().max(200).optional().catch(undefined),
  show: z.enum(["active", "archived"]).catch("active"),
});

/* Re-exported so forms can blank-check optional values the same way. */
export { blankToUndefined };
