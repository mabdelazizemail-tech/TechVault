import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/primitives";
import { listActivities } from "@/modules/crm/contracts/service";
import { ActivityList } from "@/modules/crm/ui/activity-list";
import { FilterBar } from "@/modules/crm/ui/filter-bar";
import { flatParams } from "@/modules/crm/ui/page-helpers";
import { getActor } from "@/platform/auth/current-user";

export const metadata: Metadata = { title: "Notes" };

/** Notes across the CRM, each tied to the record it is about. */
export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = flatParams(await searchParams);
  const actor = await getActor();
  const mine = params.mine === "1";

  const result = await listActivities(actor, params, { view: "notes", mine });

  return (
    <div>
      <PageHeader
        title="Notes"
        description="What people wrote down about leads, companies, contacts and deals, newest first."
      />
      <FilterBar
        basePath="/crm/notes"
        query={params.q}
        searchLabel="Search notes…"
        selects={[
          {
            name: "mine",
            label: "Whose",
            value: mine ? "1" : undefined,
            allLabel: "Everyone’s",
            options: [{ value: "1", label: "Mine" }],
          },
        ]}
      />
      <ActivityList
        result={result}
        basePath="/crm/notes"
        searchParams={params}
        canCompleteTasks={false}
        emptyTitle="No notes yet"
        emptyDescription="Add a note from a record’s timeline with Add activity → Note."
      />
    </div>
  );
}
