import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/primitives";
import { CRM_PERMISSIONS } from "@/modules/crm/contracts/permissions";
import { listActivities } from "@/modules/crm/contracts/service";
import { ActivityList } from "@/modules/crm/ui/activity-list";
import { FilterBar } from "@/modules/crm/ui/filter-bar";
import { flatParams, oneOf } from "@/modules/crm/ui/page-helpers";
import { getActor } from "@/platform/auth/current-user";
import { canAll } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "Tasks" };

const TASK_STATUSES = ["done", "all"] as const;

/** Follow-ups: open tasks by due date by default, overdue ones flagged. */
export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = flatParams(await searchParams);
  const actor = await getActor();
  const status = oneOf(TASK_STATUSES, params.status);
  const mine = params.mine === "1";

  const [result, rights] = await Promise.all([
    listActivities(actor, params, { view: "tasks", taskStatus: status ?? "open", mine }),
    canAll(actor, [CRM_PERMISSIONS.ACTIVITY_UPDATE]),
  ]);

  return (
    <div>
      <PageHeader
        title="Tasks"
        description="Follow-ups, soonest due first. Create a task from a lead, company, contact or opportunity so it always has context."
      />
      <FilterBar
        basePath="/crm/tasks"
        query={params.q}
        searchLabel="Search tasks…"
        selects={[
          {
            name: "status",
            label: "Status",
            value: status,
            allLabel: "Open",
            options: [
              { value: "done", label: "Done" },
              { value: "all", label: "All tasks" },
            ],
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
        basePath="/crm/tasks"
        searchParams={params}
        canCompleteTasks={rights[CRM_PERMISSIONS.ACTIVITY_UPDATE] === true}
        emptyTitle={status === "done" ? "No completed tasks" : "No open tasks"}
        emptyDescription="Add a task from a record’s timeline with Add activity → Task."
      />
    </div>
  );
}
