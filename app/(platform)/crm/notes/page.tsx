import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/primitives";
import { CRM_PERMISSIONS } from "@/modules/crm/contracts/permissions";
import { listActivities } from "@/modules/crm/contracts/service";
import { ActivityList } from "@/modules/crm/ui/activity-list";
import { FilterBar } from "@/modules/crm/ui/filter-bar";
import { NewNoteButton } from "@/modules/crm/ui/new-note";
import { flatParams } from "@/modules/crm/ui/page-helpers";
import { getActor } from "@/platform/auth/current-user";
import { canAll } from "@/platform/authz/authz";

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

  const [result, rights] = await Promise.all([
    listActivities(actor, params, { view: "notes", mine }),
    canAll(actor, [
      CRM_PERMISSIONS.ACTIVITY_CREATE,
      CRM_PERMISSIONS.ACTIVITY_UPDATE,
      CRM_PERMISSIONS.ACTIVITY_DELETE,
    ]),
  ]);
  const canCreate = rights[CRM_PERMISSIONS.ACTIVITY_CREATE] === true;

  return (
    <div>
      <PageHeader
        title="Notes"
        description="What people wrote down about leads, companies, contacts and deals, newest first."
        actions={canCreate ? <NewNoteButton currentUserId={actor.id} /> : undefined}
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
        canUpdateActivities={rights[CRM_PERMISSIONS.ACTIVITY_UPDATE] === true}
        canDeleteActivities={rights[CRM_PERMISSIONS.ACTIVITY_DELETE] === true}
        emptyTitle="No notes yet"
        emptyDescription={
          canCreate
            ? "Write the first one with New note, or from a record’s timeline with Add activity → Note."
            : "Notes written about leads, companies, contacts and deals appear here."
        }
      />
    </div>
  );
}
