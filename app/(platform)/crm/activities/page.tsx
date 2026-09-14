import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/primitives";
import { CRM_PERMISSIONS } from "@/modules/crm/contracts/permissions";
import { listActivities } from "@/modules/crm/contracts/service";
import { ACTIVITY_TYPE_LABELS, type ActivityType } from "@/modules/crm/contracts/types";
import { ActivityList } from "@/modules/crm/ui/activity-list";
import { FilterBar } from "@/modules/crm/ui/filter-bar";
import { flatParams, oneOf } from "@/modules/crm/ui/page-helpers";
import { getActor } from "@/platform/auth/current-user";
import { canAll } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "Activities" };

const TYPES = Object.keys(ACTIVITY_TYPE_LABELS) as ActivityType[];

/** Every call, email, meeting, task, note and stage change across the CRM. */
export default async function ActivitiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = flatParams(await searchParams);
  const actor = await getActor();
  const type = oneOf(TYPES, params.type);
  const mine = params.mine === "1";

  const [result, rights] = await Promise.all([
    listActivities(actor, params, { view: "all", type, mine }),
    canAll(actor, [CRM_PERMISSIONS.ACTIVITY_UPDATE]),
  ]);

  return (
    <div>
      <PageHeader
        title="Activities"
        description="The unified timeline of the CRM, newest first. Log activity from a lead, company, contact or opportunity so it always has context."
      />
      <FilterBar
        basePath="/crm/activities"
        query={params.q}
        searchLabel="Search subject or details…"
        selects={[
          {
            name: "type",
            label: "Type",
            value: type,
            allLabel: "All types",
            options: TYPES.map((value) => ({
              value,
              label: ACTIVITY_TYPE_LABELS[value],
            })),
          },
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
        basePath="/crm/activities"
        searchParams={params}
        canCompleteTasks={rights[CRM_PERMISSIONS.ACTIVITY_UPDATE] === true}
        emptyTitle="No activity matches"
        emptyDescription="Try clearing the filters. New activity is logged from a record’s timeline."
      />
    </div>
  );
}
