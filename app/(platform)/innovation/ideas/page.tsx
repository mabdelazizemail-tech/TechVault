import { MessageSquare, ThumbsUp } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Pagination } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filter-bar";
import { EmptyState, PageHeader, Panel, PanelHeader } from "@/components/ui/primitives";
import { INNOVATION_PERMISSIONS } from "@/modules/innovation/contracts/permissions";
import {
  isFileStorageAvailable,
  listCategories,
  listIdeas,
  listTopVotedIdeas,
} from "@/modules/innovation/contracts/service";
import {
  IDEA_STATUSES,
  IDEA_STATUS_LABELS,
  type IdeaListItem,
} from "@/modules/innovation/contracts/types";
import { IdeaStatusBadge } from "@/modules/innovation/ui/badges";
import { SubmitIdeaButton } from "@/modules/innovation/ui/idea-form";
import { IdeaRow } from "@/modules/innovation/ui/lists";
import { flatParams, orNotFound } from "@/modules/innovation/ui/page-helpers";
import { getActor } from "@/platform/auth/current-user";
import { canAll } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "Ideas" };

/**
 * Every idea, searchable and filterable, each with its 👍 vote and comment count.
 * Administrators also see the ideas with the strongest support at the top.
 */
export default async function IdeasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = flatParams(await searchParams);
  const actor = await getActor();

  const [result, categories, rights] = await Promise.all([
    orNotFound(listIdeas(actor, params)),
    listCategories(actor, "IDEA"),
    canAll(actor, [
      INNOVATION_PERMISSIONS.IDEA_CREATE,
      INNOVATION_PERMISSIONS.IDEA_VOTE,
      INNOVATION_PERMISSIONS.IDEA_ADMINISTER,
    ]),
  ]);
  const isAdmin = rights[INNOVATION_PERMISSIONS.IDEA_ADMINISTER] === true;
  const topVoted = isAdmin ? await listTopVotedIdeas(actor, 5) : [];

  const canSubmit = rights[INNOVATION_PERMISSIONS.IDEA_CREATE] === true;
  const submit = canSubmit ? (
    <SubmitIdeaButton categories={categories} filesEnabled={isFileStorageAvailable()} />
  ) : undefined;
  const filtered = [params.q, params.status, params.category].some(
    (value) => (value ?? "") !== "",
  );

  return (
    <div>
      <PageHeader
        title="Ideas"
        description="Improvements anyone can suggest. Give a 👍 to the ones you want to see happen."
        actions={submit}
      />

      {isAdmin && <TopVotedIdeas ideas={topVoted} />}

      <FilterBar
        basePath="/innovation/ideas"
        query={params.q}
        searchLabel="Search ideas…"
        selects={[
          {
            name: "sort",
            label: "Sort",
            value: params.sort,
            allLabel: "Newest",
            options: [
              { value: "top", label: "Most voted" },
              { value: "comments", label: "Most commented" },
            ],
          },
          {
            name: "status",
            label: "Status",
            value: params.status,
            allLabel: "Any status",
            options: IDEA_STATUSES.map((value) => ({
              value,
              label: IDEA_STATUS_LABELS[value],
            })),
          },
          {
            name: "category",
            label: "Category",
            value: params.category,
            allLabel: "All categories",
            options: categories.map((category) => ({
              value: category.id,
              label: category.name,
            })),
          },
        ]}
      />
      <Panel className="overflow-hidden">
        {result.rows.length === 0 ? (
          <EmptyState
            title={filtered ? "No ideas match" : "No ideas yet"}
            description={
              filtered
                ? "Try other words or clear the filters."
                : "Have a thought about how we could work better? It takes a minute to share."
            }
            action={filtered ? undefined : submit}
          />
        ) : (
          <>
            <ul>
              {result.rows.map((idea) => (
                <IdeaRow
                  key={idea.id}
                  idea={idea}
                  canVote={rights[INNOVATION_PERMISSIONS.IDEA_VOTE] === true}
                />
              ))}
            </ul>
            <Pagination
              page={{ page: result.page, pageSize: result.pageSize, total: result.total }}
              basePath="/innovation/ideas"
              searchParams={params}
            />
          </>
        )}
      </Panel>
    </div>
  );
}

/** Administrators only: where employee interest is strongest. */
function TopVotedIdeas({ ideas }: { ideas: IdeaListItem[] }) {
  return (
    <Panel className="mb-4 overflow-hidden">
      <PanelHeader
        kicker="For administrators"
        title="Top voted ideas"
        description="Where employee interest is strongest, across all ideas."
        actions={
          <Link
            href="/innovation/ideas?sort=top"
            className="text-primary-ink text-[13px] font-extrabold hover:underline"
          >
            See all by votes →
          </Link>
        }
      />
      {ideas.length === 0 ? (
        <p className="text-foreground-muted px-4 py-4 text-[13px]">
          No votes yet. Ideas appear here as people vote for them.
        </p>
      ) : (
        <ol>
          {ideas.map((idea, index) => (
            <li key={idea.id} className="border-border border-b last:border-0">
              <Link
                href={`/innovation/ideas/${idea.id}`}
                className="hover:bg-surface-hover flex items-center gap-3 px-4 py-2.5"
              >
                <span className="text-foreground-subtle w-5 shrink-0 text-[13px] font-extrabold tabular-nums">
                  {index + 1}
                </span>
                <span
                  dir="auto"
                  className="text-foreground min-w-0 flex-1 truncate text-[13.5px] font-semibold"
                >
                  {idea.title}
                </span>
                <IdeaStatusBadge status={idea.status} />
                <span className="text-foreground inline-flex w-14 shrink-0 items-center justify-end gap-1 text-[13px] font-extrabold tabular-nums">
                  <ThumbsUp aria-hidden="true" size={14} />
                  {idea.voteCount}
                </span>
                <span className="text-foreground-muted hidden w-12 shrink-0 items-center justify-end gap-1 text-[12.5px] tabular-nums sm:inline-flex">
                  <MessageSquare aria-hidden="true" size={13} />
                  {idea.commentCount}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
