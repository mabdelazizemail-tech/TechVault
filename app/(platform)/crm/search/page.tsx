import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader, Panel, PanelHeader } from "@/components/ui/primitives";
import { searchCrm } from "@/modules/crm/contracts/service";
import type { SearchHit } from "@/modules/crm/contracts/types";
import { recordHref } from "@/modules/crm/ui/links";
import { param } from "@/modules/crm/ui/page-helpers";
import { getActor } from "@/platform/auth/current-user";

export const metadata: Metadata = { title: "Search" };

/**
 * Global CRM search results. Each group lists only records the signed-in user may
 * read — the service filters by scope before anything is returned (§7).
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = (param((await searchParams).q) ?? "").trim();
  const actor = await getActor();
  const results = await searchCrm(actor, query);

  const groups = [
    { title: "Opportunities", hits: results.opportunities },
    { title: "Leads", hits: results.leads },
    { title: "Companies", hits: results.accounts },
    { title: "Contacts", hits: results.contacts },
  ];
  const total = groups.reduce((sum, group) => sum + group.hits.length, 0);
  const tooShort = query.length < 2;

  return (
    <div>
      <PageHeader
        title="Search"
        description={
          tooShort
            ? "Type at least two characters in the search box above."
            : total === 0
              ? `Nothing you have access to matches “${query}”.`
              : `${total} ${total === 1 ? "result" : "results"} for “${query}”.`
        }
      />

      {!tooShort && total === 0 && (
        <Panel>
          <EmptyState
            title="No results"
            description="Try a company name, a person’s name, an email address, or part of a deal name."
          />
        </Panel>
      )}

      {total > 0 && (
        <div className="grid items-start gap-4 md:grid-cols-2">
          {groups
            .filter((group) => group.hits.length > 0)
            .map((group) => (
              <Panel key={group.title}>
                <PanelHeader
                  title={group.title}
                  description={`${group.hits.length} shown`}
                />
                <ul>
                  {group.hits.map((hit) => (
                    <Hit key={hit.id} hit={hit} />
                  ))}
                </ul>
              </Panel>
            ))}
        </div>
      )}
    </div>
  );
}

function Hit({ hit }: { hit: SearchHit }) {
  return (
    <li className="border-border hover:bg-surface-hover relative border-b px-4 py-2.5 last:border-0">
      <Link
        href={recordHref(hit)}
        className="text-foreground block truncate text-[13.5px] font-extrabold after:absolute after:inset-0 hover:underline"
        dir="auto"
      >
        {hit.label}
      </Link>
      {hit.detail !== null && (
        <p className="text-foreground-muted truncate text-xs" dir="auto">
          {hit.detail}
        </p>
      )}
    </li>
  );
}
