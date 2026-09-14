import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AnswerSource } from "../../contracts/types";
import { toAnyWordQuery } from "../../domain/search";
import type { AnswerContext, AnswerEngine, EngineResult } from "./engine";

/**
 * V1 engine: finds the knowledge items, projects and ideas that best match the
 * question's words, ranked, with a highlighted passage from each. It does not
 * compose an answer — that is Phase 3 — but it always shows where to look.
 */

const PER_SOURCE = 4;
const MAX_SOURCES = 8;
/** ts_headline marks matches; these are stripped again, since excerpts render as text. */
const MARK_START = "⟦";
const MARK_END = "⟧";
const HEADLINE = `MaxWords=28, MinWords=10, ShortWord=2, MaxFragments=1, StartSel=${MARK_START}, StopSel=${MARK_END}`;

type Row = {
  id: string;
  title: string;
  excerpt: string;
  context: string | null;
  file_id: string | null;
  rank: number;
};

export const keywordEngine: AnswerEngine = {
  name: "keyword",

  async answer(question: string, context: AnswerContext): Promise<EngineResult> {
    const words = toAnyWordQuery(question);
    if (words === null) return { answer: null, sources: [] };
    const query = Prisma.sql`to_tsquery('simple', ${words})`;

    const [knowledge, projects, ideas] = await Promise.all([
      context.rights.knowledge
        ? prisma.$queryRaw<Row[]>`
            SELECT k.id, k.title,
                   ts_headline('simple', coalesce(k.description, k.title), ${query}, ${HEADLINE}) AS excerpt,
                   coalesce(p.name, c.name) AS context,
                   f.id AS file_id,
                   ts_rank(innovation.knowledge_search(k.title, k.description, k.tags), ${query}) AS rank
              FROM innovation.knowledge_items k
              JOIN innovation.categories c ON c.id = k.category_id
              LEFT JOIN innovation.projects p ON p.id = k.project_id AND p.deleted_at IS NULL
              LEFT JOIN innovation.files f ON f.id = k.file_id AND f.status = 'READY'
             WHERE k.deleted_at IS NULL
               AND innovation.knowledge_search(k.title, k.description, k.tags) @@ ${query}
             ORDER BY rank DESC
             LIMIT ${PER_SOURCE}`
        : Promise.resolve([]),
      context.rights.projects
        ? prisma.$queryRaw<Row[]>`
            SELECT p.id, p.name AS title,
                   ts_headline('simple', coalesce(p.lessons_learned, p.description, p.name), ${query}, ${HEADLINE}) AS excerpt,
                   'Project'::text AS context,
                   NULL::uuid AS file_id,
                   ts_rank(innovation.project_search(p.name, p.description, p.lessons_learned), ${query}) AS rank
              FROM innovation.projects p
             WHERE p.deleted_at IS NULL
               AND innovation.project_search(p.name, p.description, p.lessons_learned) @@ ${query}
             ORDER BY rank DESC
             LIMIT ${PER_SOURCE}`
        : Promise.resolve([]),
      context.rights.ideas
        ? prisma.$queryRaw<Row[]>`
            SELECT i.id, i.title,
                   ts_headline('simple', i.description, ${query}, ${HEADLINE}) AS excerpt,
                   'Idea'::text AS context,
                   NULL::uuid AS file_id,
                   ts_rank(innovation.idea_search(i.title, i.description), ${query}) AS rank
              FROM innovation.ideas i
             WHERE i.deleted_at IS NULL
               AND innovation.idea_search(i.title, i.description) @@ ${query}
             ORDER BY rank DESC
             LIMIT ${PER_SOURCE}`
        : Promise.resolve([]),
    ]);

    const toSources = (rows: Row[], kind: AnswerSource["kind"], segment: string) =>
      rows.map((row) => ({
        source: {
          kind,
          id: row.id,
          title: row.title,
          excerpt: row.excerpt.replaceAll(MARK_START, "").replaceAll(MARK_END, ""),
          context: row.context,
          href: `/innovation/${segment}/${row.id}`,
          fileId: row.file_id,
        } satisfies AnswerSource,
        rank: Number(row.rank),
      }));

    const sources = [
      ...toSources(knowledge, "knowledge", "knowledge"),
      ...toSources(projects, "project", "projects"),
      ...toSources(ideas, "idea", "ideas"),
    ]
      .sort((a, b) => b.rank - a.rank)
      .slice(0, MAX_SOURCES)
      .map((entry) => entry.source);

    return { answer: null, sources };
  },
};
