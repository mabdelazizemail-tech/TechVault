import { prisma } from "@/lib/prisma";
import { type Actor, canAll, requirePermission } from "@/platform/authz/authz";
import { INNOVATION_PERMISSIONS } from "../contracts/permissions";
import type { ActivityKind, RecentActivity, ThinkTankOverview } from "../contracts/types";
import { LESSONS_LEARNED_CATEGORY } from "../domain/categories";

/**
 * The Think Tank landing page: how much there is, what changed lately, and which
 * ideas are gathering votes. Three statements in parallel, each reading at most a
 * handful of rows through indexes — nothing proportional to the size of the library.
 */

const RECENT_LIMIT = 8;
const TRENDING_LIMIT = 5;
const TRENDING_WINDOW_DAYS = 30;
/** An item edited more than this after it was created counts as "updated". */
const UPDATED_AFTER_MS = 60_000;

type RecentRow = {
  source: "idea" | "knowledge" | "project";
  id: string;
  title: string;
  category: string | null;
  created_at: Date;
  updated_at: Date;
};

export async function getOverview(actor: Actor): Promise<ThinkTankOverview> {
  await requirePermission(actor, INNOVATION_PERMISSIONS.ACCESS);
  const rights = await canAll(actor, [
    INNOVATION_PERMISSIONS.IDEA_READ,
    INNOVATION_PERMISSIONS.KNOWLEDGE_READ,
    INNOVATION_PERMISSIONS.PROJECT_READ,
  ]);
  const mayRead = {
    idea: rights[INNOVATION_PERMISSIONS.IDEA_READ] === true,
    knowledge: rights[INNOVATION_PERMISSIONS.KNOWLEDGE_READ] === true,
    project: rights[INNOVATION_PERMISSIONS.PROJECT_READ] === true,
  };

  const since = new Date(Date.now() - TRENDING_WINDOW_DAYS * 86_400_000);

  const [[counts], recentRows, trending] = await Promise.all([
    prisma.$queryRaw<[{ ideas: bigint; knowledge: bigint; projects: bigint }]>`
      SELECT (SELECT count(*) FROM innovation.ideas WHERE deleted_at IS NULL) AS ideas,
             (SELECT count(*) FROM innovation.knowledge_items WHERE deleted_at IS NULL) AS knowledge,
             (SELECT count(*) FROM innovation.projects WHERE deleted_at IS NULL) AS projects
    `,
    prisma.$queryRaw<RecentRow[]>`
      (SELECT 'idea' AS source, i.id, i.title, NULL::text AS category, i.created_at, i.updated_at
         FROM innovation.ideas i
        WHERE i.deleted_at IS NULL
        ORDER BY i.updated_at DESC LIMIT ${RECENT_LIMIT})
      UNION ALL
      (SELECT 'knowledge', k.id, k.title, c.name, k.created_at, k.updated_at
         FROM innovation.knowledge_items k
         JOIN innovation.categories c ON c.id = k.category_id
        WHERE k.deleted_at IS NULL
        ORDER BY k.updated_at DESC LIMIT ${RECENT_LIMIT})
      UNION ALL
      (SELECT 'project', p.id, p.name, NULL::text, p.created_at, p.updated_at
         FROM innovation.projects p
        WHERE p.deleted_at IS NULL
        ORDER BY p.updated_at DESC LIMIT ${RECENT_LIMIT})
      ORDER BY updated_at DESC
      LIMIT ${RECENT_LIMIT * 3}
    `,
    mayRead.idea
      ? prisma.innovationIdea.findMany({
          where: { deletedAt: null, createdAt: { gte: since }, voteCount: { gt: 0 } },
          orderBy: [
            { voteCount: "desc" },
            { commentCount: "desc" },
            { createdAt: "desc" },
          ],
          take: TRENDING_LIMIT,
          select: {
            id: true,
            title: true,
            voteCount: true,
            commentCount: true,
            status: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const recent: RecentActivity[] = recentRows
    .filter((row) => mayRead[row.source])
    .slice(0, RECENT_LIMIT)
    .map((row) => {
      const updated =
        row.updated_at.getTime() - row.created_at.getTime() > UPDATED_AFTER_MS;
      const kind: ActivityKind =
        row.source === "idea"
          ? updated
            ? "IDEA_UPDATED"
            : "IDEA_NEW"
          : row.source === "project"
            ? updated
              ? "PROJECT_UPDATED"
              : "PROJECT_NEW"
            : !updated && row.category?.toLowerCase() === LESSONS_LEARNED_CATEGORY
              ? "LESSON_NEW"
              : updated
                ? "KNOWLEDGE_UPDATED"
                : "KNOWLEDGE_NEW";
      const segment =
        row.source === "idea"
          ? "ideas"
          : row.source === "project"
            ? "projects"
            : "knowledge";
      return {
        kind,
        id: row.id,
        title: row.title,
        href: `/innovation/${segment}/${row.id}`,
        at: row.updated_at,
      };
    });

  return {
    counts: {
      ideas: mayRead.idea ? Number(counts?.ideas ?? 0) : 0,
      knowledge: mayRead.knowledge ? Number(counts?.knowledge ?? 0) : 0,
      projects: mayRead.project ? Number(counts?.projects ?? 0) : 0,
    },
    recent,
    trending,
  };
}
