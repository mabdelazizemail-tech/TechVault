import {
  BookOpen,
  Bot,
  FolderKanban,
  Lightbulb,
  Rocket,
  Search,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Panel, PanelHeader } from "@/components/ui/primitives";
import { INNOVATION_PERMISSIONS } from "@/modules/innovation/contracts/permissions";
import {
  getOverview,
  isFileStorageAvailable,
  listCategories,
} from "@/modules/innovation/contracts/service";
import type { ActivityKind } from "@/modules/innovation/contracts/types";
import { IdeaStatusBadge } from "@/modules/innovation/ui/badges";
import { formatRelative, plural } from "@/modules/innovation/ui/format";
import { SubmitIdeaButton } from "@/modules/innovation/ui/idea-form";
import { getActor } from "@/platform/auth/current-user";
import { canAll } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "The Think Tank" };

const ACTIVITY: Record<ActivityKind, { label: string; Icon: LucideIcon }> = {
  IDEA_NEW: { label: "New idea", Icon: Lightbulb },
  IDEA_UPDATED: { label: "Updated idea", Icon: Lightbulb },
  KNOWLEDGE_NEW: { label: "New knowledge", Icon: BookOpen },
  KNOWLEDGE_UPDATED: { label: "Updated knowledge", Icon: BookOpen },
  LESSON_NEW: { label: "New lesson learned", Icon: BookOpen },
  PROJECT_NEW: { label: "New project", Icon: Rocket },
  PROJECT_UPDATED: { label: "Updated project", Icon: Rocket },
};

/**
 * THE THINK TANK's front door: one question box, four doors, and what's happening.
 */
export default async function ThinkTankPage() {
  const actor = await getActor();
  const [overview, rights] = await Promise.all([
    getOverview(actor),
    canAll(actor, [
      INNOVATION_PERMISSIONS.IDEA_READ,
      INNOVATION_PERMISSIONS.IDEA_CREATE,
      INNOVATION_PERMISSIONS.KNOWLEDGE_READ,
      INNOVATION_PERMISSIONS.PROJECT_READ,
      INNOVATION_PERMISSIONS.ASSISTANT_ACCESS,
    ]),
  ]);
  const canSubmit = rights[INNOVATION_PERMISSIONS.IDEA_CREATE] === true;
  const ideaCategories = canSubmit ? await listCategories(actor, "IDEA") : [];

  const cards = [
    {
      permission: INNOVATION_PERMISSIONS.IDEA_READ,
      href: "/innovation/ideas",
      title: "Ideas",
      Icon: Lightbulb,
      count: plural(overview.counts.ideas, "idea"),
      description:
        "Suggest an improvement, vote for the best ones, and follow their progress.",
    },
    {
      permission: INNOVATION_PERMISSIONS.KNOWLEDGE_READ,
      href: "/innovation/knowledge",
      title: "Knowledge",
      Icon: BookOpen,
      count: plural(overview.counts.knowledge, "item"),
      description: "Documents, SOPs, best practices, lessons learned and templates.",
    },
    {
      permission: INNOVATION_PERMISSIONS.PROJECT_READ,
      href: "/innovation/projects",
      title: "Projects",
      Icon: FolderKanban,
      count: plural(overview.counts.projects, "project"),
      description: "Ideas we are turning into reality, with their documents and lessons.",
    },
    {
      permission: INNOVATION_PERMISSIONS.ASSISTANT_ACCESS,
      href: "/innovation/ask",
      title: "Ask Think Tank",
      Icon: Bot,
      count: "Ask a question",
      description: "Describe what you need and get pointed to what we already know.",
    },
  ].filter((card) => rights[card.permission] === true);

  return (
    <div>
      <PageHeader
        title="The Think Tank"
        description="Innovation & Knowledge Management — ideas, what we know, and the projects they become."
        actions={
          canSubmit ? (
            <SubmitIdeaButton
              categories={ideaCategories}
              filesEnabled={isFileStorageAvailable()}
            />
          ) : undefined
        }
      />
      <div className="flex flex-col gap-6">
        {rights[INNOVATION_PERMISSIONS.ASSISTANT_ACCESS] === true && (
          <form action="/innovation/ask" method="get" role="search" className="max-w-3xl">
            <label className="bg-surface border-border-strong focus-within:border-primary flex items-center gap-3 border-2 px-4">
              <span className="sr-only">Ask anything about our knowledge</span>
              <Search
                aria-hidden="true"
                size={19}
                className="text-foreground-muted shrink-0"
              />
              <input
                type="search"
                name="q"
                placeholder="Ask anything about our knowledge…"
                maxLength={500}
                className="text-foreground placeholder:text-foreground-subtle min-h-12 flex-1 bg-transparent text-[15px] focus-visible:outline-none"
              />
            </label>
          </form>
        )}

        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map(({ href, title, Icon, count, description }) => (
            <li key={href}>
              <Link
                href={href}
                className="bg-surface border-border hover:border-primary group flex h-full flex-col gap-3 border-2 p-5 transition-colors"
              >
                <span className="bg-primary text-primary-foreground grid size-11 place-items-center">
                  <Icon aria-hidden="true" size={22} />
                </span>
                <span>
                  <span className="text-foreground block text-[19px] font-extrabold">
                    {title}
                  </span>
                  <span className="text-foreground-subtle text-[12px]">{count}</span>
                </span>
                <span className="text-foreground-muted text-[13px]">{description}</span>
                <span className="text-primary-ink mt-auto text-[13px] font-extrabold">
                  Open <span aria-hidden="true">→</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <div className="grid gap-4 lg:grid-cols-3">
          <Panel className="overflow-hidden lg:col-span-2">
            <PanelHeader title="Recent activity" />
            {overview.recent.length === 0 ? (
              <p className="text-foreground-muted px-4 py-6 text-[13px]">
                Nothing yet. Submit the first idea or add something you know.
              </p>
            ) : (
              <ul>
                {overview.recent.map((entry) => {
                  const { label, Icon } = ACTIVITY[entry.kind];
                  return (
                    <li
                      key={`${entry.kind}-${entry.id}`}
                      className="border-border border-b last:border-0"
                    >
                      <Link
                        href={entry.href}
                        className="hover:bg-surface-hover flex items-center gap-3 px-4 py-2.5"
                      >
                        <Icon
                          aria-hidden="true"
                          size={16}
                          className="text-foreground-muted shrink-0"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="text-foreground-subtle block text-[11px] font-extrabold tracking-[0.04em] uppercase">
                            {label}
                          </span>
                          <span
                            dir="auto"
                            className="text-foreground block truncate text-[13.5px]"
                          >
                            {entry.title}
                          </span>
                        </span>
                        <time
                          dateTime={entry.at.toISOString()}
                          className="text-foreground-subtle shrink-0 text-[11.5px]"
                        >
                          {formatRelative(entry.at)}
                        </time>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel className="overflow-hidden">
            <PanelHeader title="Trending ideas" />
            {overview.trending.length === 0 ? (
              <p className="text-foreground-muted px-4 py-6 text-[13px]">
                No votes this month yet. Vote for the ideas you like.
              </p>
            ) : (
              <ol>
                {overview.trending.map((idea, index) => (
                  <li key={idea.id} className="border-border border-b last:border-0">
                    <Link
                      href={`/innovation/ideas/${idea.id}`}
                      className="hover:bg-surface-hover flex items-start gap-3 px-4 py-2.5"
                    >
                      <span className="text-foreground-subtle w-4 shrink-0 text-[13px] font-extrabold tabular-nums">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          dir="auto"
                          className="text-foreground block text-[13.5px] font-semibold"
                        >
                          {idea.title}
                        </span>
                        <span className="text-foreground-muted mt-0.5 flex items-center gap-2 text-[11.5px]">
                          <TrendingUp aria-hidden="true" size={12} />
                          {plural(idea.voteCount, "vote")} ·{" "}
                          {plural(idea.commentCount, "comment")}
                        </span>
                      </span>
                      <IdeaStatusBadge status={idea.status} />
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
