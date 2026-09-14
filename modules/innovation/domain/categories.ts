/**
 * The categories a new installation starts with. Rows, not an enum: administrators
 * add, rename and archive them afterwards (CLAUDE.md §8.4).
 */
export const INNOVATION_DEFAULT_CATEGORIES = {
  IDEA: [
    "Process improvement",
    "Product",
    "Technology",
    "Customer experience",
    "Cost saving",
    "Other",
  ],
  KNOWLEDGE: ["Documents", "SOPs", "Best Practices", "Lessons Learned", "Templates"],
} as const;

/** The knowledge category that holds lessons learned, recognised by its seeded name. */
export const LESSONS_LEARNED_CATEGORY = "lessons learned";
