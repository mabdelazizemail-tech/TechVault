/**
 * DTOs and vocabularies of THE THINK TANK (CLAUDE.md §9.5). Never Prisma entities.
 */

export const IDEA_STATUSES = [
  "NEW",
  "REVIEWING",
  "APPROVED",
  "IN_PROGRESS",
  "IMPLEMENTED",
  "REJECTED",
] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];

export const IDEA_STATUS_LABELS: Record<IdeaStatus, string> = {
  NEW: "New",
  REVIEWING: "Reviewing",
  APPROVED: "Approved",
  IN_PROGRESS: "In progress",
  IMPLEMENTED: "Implemented",
  REJECTED: "Rejected",
};

export const PROJECT_STATUSES = ["PLANNING", "IN_PROGRESS", "COMPLETED"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  PLANNING: "Planning",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
};

export const CATEGORY_KINDS = ["IDEA", "KNOWLEDGE"] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

export const PAGE_SIZE = 20;

export type Paginated<T> = { rows: T[]; total: number; page: number; pageSize: number };

export type PersonRef = { id: string; name: string };

export type CategoryDto = {
  id: string;
  kind: CategoryKind;
  name: string;
  isActive: boolean;
  sortOrder: number;
};

export type FileDto = {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  /** How the browser can show it inline, if at all. */
  preview: "pdf" | "image" | null;
};

export type IdeaListItem = {
  id: string;
  title: string;
  excerpt: string;
  status: IdeaStatus;
  category: PersonRef;
  submitter: PersonRef;
  owner: PersonRef | null;
  voteCount: number;
  commentCount: number;
  hasVoted: boolean;
  isMine: boolean;
  hasAttachment: boolean;
  createdAt: Date;
};

export type CommentDto = {
  id: string;
  body: string;
  author: PersonRef;
  isMine: boolean;
  createdAt: Date;
};

export type IdeaDetail = Omit<IdeaListItem, "excerpt" | "hasAttachment"> & {
  description: string;
  categoryId: string;
  attachment: FileDto | null;
  comments: CommentDto[];
  project: PersonRef | null;
  updatedAt: Date;
};

export type KnowledgeListItem = {
  id: string;
  title: string;
  excerpt: string;
  category: PersonRef;
  tags: string[];
  owner: PersonRef | null;
  file: FileDto | null;
  project: PersonRef | null;
  updatedAt: Date;
};

export type KnowledgeDetail = KnowledgeListItem & {
  description: string | null;
  categoryId: string;
  createdAt: Date;
};

export type ProjectListItem = {
  id: string;
  name: string;
  excerpt: string;
  status: ProjectStatus;
  owner: PersonRef | null;
  memberCount: number;
  documentCount: number;
  idea: PersonRef | null;
  updatedAt: Date;
};

export type ProjectDetail = Omit<
  ProjectListItem,
  "excerpt" | "memberCount" | "documentCount"
> & {
  description: string | null;
  lessonsLearned: string | null;
  members: PersonRef[];
  documents: KnowledgeListItem[];
  createdAt: Date;
};

export type ActivityKind =
  | "IDEA_NEW"
  | "IDEA_UPDATED"
  | "KNOWLEDGE_NEW"
  | "KNOWLEDGE_UPDATED"
  | "LESSON_NEW"
  | "PROJECT_NEW"
  | "PROJECT_UPDATED";

export type RecentActivity = {
  kind: ActivityKind;
  id: string;
  title: string;
  href: string;
  at: Date;
};

export type ThinkTankOverview = {
  counts: { ideas: number; knowledge: number; projects: number };
  recent: RecentActivity[];
  trending: Pick<
    IdeaListItem,
    "id" | "title" | "voteCount" | "commentCount" | "status"
  >[];
};

export type SourceKind = "knowledge" | "project" | "idea";

/** One piece of evidence behind an answer. */
export type AnswerSource = {
  kind: SourceKind;
  id: string;
  title: string;
  /** A short passage around the matching words. */
  excerpt: string;
  /** Where it sits: a project name or a knowledge category. */
  context: string | null;
  href: string;
  /** For knowledge items with a file: open the document itself. */
  fileId: string | null;
};

export type AssistantAnswer = {
  question: string;
  /** The generated answer. Null until an AI engine is connected (Phase 3). */
  answer: string | null;
  sources: AnswerSource[];
  /** Which engine answered, so the UI can say how the result was produced. */
  engine: "keyword" | "ai";
};
