import type { Metadata } from "next";
import { Pagination } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filter-bar";
import { EmptyState, PageHeader, Panel } from "@/components/ui/primitives";
import { INNOVATION_PERMISSIONS } from "@/modules/innovation/contracts/permissions";
import {
  isFileStorageAvailable,
  listCategories,
  listIdeas,
} from "@/modules/innovation/contracts/service";
import { IDEA_STATUSES, IDEA_STATUS_LABELS } from "@/modules/innovation/contracts/types";
import { SubmitIdeaButton } from "@/modules/innovation/ui/idea-form";
import { IdeaRow } from "@/modules/innovation/ui/lists";
import { flatParams, orNotFound } from "@/modules/innovation/ui/page-helpers";
import { getActor } from "@/platform/auth/current-user";
import { canAll } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "Ideas" };

/** Every idea, searchable and filterable, with a vote button on each. */
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
    canAll(actor, [INNOVATION_PERMISSIONS.IDEA_CREATE, INNOVATION_PERMISSIONS.IDEA_VOTE]),
  ]);
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
        description="Improvements anyone can suggest. Vote for the ones you want to see happen."
        actions={submit}
      />
      <FilterBar
        basePath="/innovation/ideas"
        query={params.q}
        searchLabel="Search ideas…"
        selects={[
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
          {
            name: "sort",
            label: "Sort",
            value: params.sort,
            allLabel: "Newest",
            options: [{ value: "top", label: "Most votes" }],
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
