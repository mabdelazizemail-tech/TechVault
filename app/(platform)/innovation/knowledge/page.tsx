import type { Metadata } from "next";
import Link from "next/link";
import { Pagination } from "@/components/ui/data-table";
import { EmptyState, PageHeader, Panel } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { INNOVATION_PERMISSIONS } from "@/modules/innovation/contracts/permissions";
import {
  isFileStorageAvailable,
  listCategories,
  listKnowledge,
} from "@/modules/innovation/contracts/service";
import { AddKnowledgeButton } from "@/modules/innovation/ui/knowledge-form";
import { KnowledgeRow } from "@/modules/innovation/ui/lists";
import { flatParams, orNotFound } from "@/modules/innovation/ui/page-helpers";
import { getActor } from "@/platform/auth/current-user";
import { canAll } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "Knowledge" };

/** The knowledge library: one search box, category chips, results. */
export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = flatParams(await searchParams);
  const actor = await getActor();

  const [result, categories, rights] = await Promise.all([
    orNotFound(listKnowledge(actor, params)),
    listCategories(actor, "KNOWLEDGE"),
    canAll(actor, [
      INNOVATION_PERMISSIONS.KNOWLEDGE_CREATE,
      INNOVATION_PERMISSIONS.KNOWLEDGE_DOWNLOAD,
    ]),
  ]);
  const add =
    rights[INNOVATION_PERMISSIONS.KNOWLEDGE_CREATE] === true ? (
      <AddKnowledgeButton
        categories={categories}
        filesEnabled={isFileStorageAvailable()}
        defaultCategoryId={params.category}
      />
    ) : undefined;
  const filtered = (params.q ?? "") !== "" || (params.category ?? "") !== "";

  const chipHref = (categoryId: string | undefined) => {
    const query = new URLSearchParams();
    if ((params.q ?? "") !== "") query.set("q", params.q ?? "");
    if (categoryId !== undefined) query.set("category", categoryId);
    const text = query.toString();
    return text === "" ? "/innovation/knowledge" : `/innovation/knowledge?${text}`;
  };

  return (
    <div>
      <PageHeader
        title="Knowledge"
        description="What we know, in one place: documents, SOPs, best practices, lessons learned and templates."
        actions={add}
      />

      <form
        action="/innovation/knowledge"
        method="get"
        role="search"
        className="mb-3 max-w-3xl"
      >
        {params.category !== undefined && (
          <input type="hidden" name="category" value={params.category} />
        )}
        <label className="sr-only" htmlFor="knowledge-search">
          Search knowledge
        </label>
        <input
          id="knowledge-search"
          type="search"
          name="q"
          defaultValue={params.q}
          placeholder="Search titles, descriptions and tags…"
          maxLength={200}
          className="bg-surface border-border-strong text-foreground placeholder:text-foreground-subtle focus-visible:border-primary min-h-11 w-full border-2 px-4 text-[15px] focus-visible:outline-offset-0"
        />
      </form>

      <nav aria-label="Categories" className="mb-4 flex flex-wrap gap-2">
        {[{ id: undefined, name: "All" }, ...categories].map((category) => {
          const active = (params.category ?? undefined) === category.id;
          return (
            <Link
              key={category.id ?? "all"}
              href={chipHref(category.id)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "border px-3 py-1 text-[13px]",
                active
                  ? "border-foreground bg-foreground text-canvas font-extrabold"
                  : "border-border-strong text-foreground hover:bg-surface-hover",
              )}
            >
              {category.name}
            </Link>
          );
        })}
      </nav>

      <Panel className="overflow-hidden">
        {result.rows.length === 0 ? (
          <EmptyState
            title={filtered ? "Nothing matches" : "The library is empty"}
            description={
              filtered
                ? "Try fewer or different words, or another category."
                : "Add a document, an SOP or a lesson learned so the next person doesn't start from scratch."
            }
            action={filtered ? undefined : add}
          />
        ) : (
          <>
            <ul>
              {result.rows.map((item) => (
                <KnowledgeRow
                  key={item.id}
                  item={item}
                  canDownload={rights[INNOVATION_PERMISSIONS.KNOWLEDGE_DOWNLOAD] === true}
                />
              ))}
            </ul>
            <Pagination
              page={{ page: result.page, pageSize: result.pageSize, total: result.total }}
              basePath="/innovation/knowledge"
              searchParams={params}
            />
          </>
        )}
      </Panel>
    </div>
  );
}
