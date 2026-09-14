import { z } from "zod";
import { CATEGORY_KINDS, IDEA_STATUSES, PROJECT_STATUSES } from "./types";

/**
 * Input schemas for THE THINK TANK (CLAUDE.md §9 rule 3). Forms send what people
 * typed; empty optional fields arrive as "" and are treated as absent.
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
    .optional()
    .transform((value) => (value === undefined || value === "" ? null : value));

const uuid = z.uuid({ error: "Not a valid identifier." });
const optionalUuid = z
  .preprocess(blankToUndefined, uuid.optional())
  .transform((value) => value ?? null);

/** "ocr, banking,  OCR" → ["ocr", "banking"]: trimmed, lower-cased, unique. */
const tags = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((value) => {
    const parts = Array.isArray(value) ? value : (value ?? "").split(",");
    return [
      ...new Set(
        parts.map((part) => part.trim().toLowerCase()).filter((part) => part.length > 0),
      ),
    ];
  })
  .refine((value) => value.length <= 12, "Use at most 12 tags.")
  .refine(
    (value) => value.every((tag) => tag.length <= 40),
    "Tags are limited to 40 characters.",
  );

export const listParamsSchema = z.object({
  page: z.coerce.number().int().min(1).catch(1),
  q: z.string().trim().max(200).optional().catch(undefined),
  status: z.string().max(40).optional().catch(undefined),
  category: z.uuid().optional().catch(undefined),
  sort: z.enum(["new", "top"]).optional().catch(undefined),
});

export const ideaCreateSchema = z.object({
  title: requiredText("Title", 160),
  description: requiredText("Description", 5000),
  categoryId: uuid,
  attachmentFileId: optionalUuid,
});

export const ideaUpdateSchema = z.object({
  title: requiredText("Title", 160),
  description: requiredText("Description", 5000),
  categoryId: uuid,
  status: z.enum(IDEA_STATUSES),
  ownerId: optionalUuid,
});

export const commentSchema = z.object({
  body: requiredText("Comment", 2000),
});

export const knowledgeSchema = z
  .object({
    title: requiredText("Title", 200),
    description: optionalText(4000),
    categoryId: uuid,
    tags,
    fileId: optionalUuid,
    projectId: optionalUuid,
  })
  .refine((value) => value.description !== null || value.fileId !== null, {
    message: "Add a file or write a short description.",
    path: ["description"],
  });

export const projectSchema = z.object({
  name: requiredText("Project name", 160),
  description: optionalText(5000),
  ownerId: optionalUuid,
  status: z.enum(PROJECT_STATUSES),
  memberIds: z.array(uuid).max(50, "A project team is limited to 50 people.").default([]),
  lessonsLearned: optionalText(8000),
});

export const categorySchema = z.object({
  kind: z.enum(CATEGORY_KINDS),
  name: requiredText("Name", 60),
});

export const categoryUpdateSchema = z.object({
  name: requiredText("Name", 60),
  isActive: z.boolean(),
});

export const uploadRequestSchema = z.object({
  fileName: requiredText("File name", 255),
  sizeBytes: z.number().int().positive("The file is empty."),
});

export const askSchema = z.object({
  question: z
    .string()
    .trim()
    .min(2, "Ask a question first.")
    .max(500, "Keep the question under 500 characters."),
});
