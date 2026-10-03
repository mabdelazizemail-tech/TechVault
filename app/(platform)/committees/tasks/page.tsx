import type { Metadata } from "next";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader, Panel } from "@/components/ui/primitives";
import {
  getTaskSummary,
  listCommitteeOptions,
  listTasks,
} from "@/modules/committees/contracts/service";
import { flatParams, taskFilterSelects } from "@/modules/committees/ui/page-helpers";
import {
  TaskSummaryTiles,
  TaskTable,
  taskSortFrom,
} from "@/modules/committees/ui/task-table";
import { getActor } from "@/platform/auth/current-user";

export const metadata: Metadata = { title: "Team to-dos" };

const BASE = "/committees/tasks";

/**
 * Every Team To-Do List you can see, in one list: search, filter by status,
 * responsible person, due date and committee, and sort.
 */
export default async function CommitteeTasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = flatParams(await searchParams);
  const actor = await getActor();
  const [page, summary, committees] = await Promise.all([
    listTasks(actor, params),
    getTaskSummary(actor),
    listCommitteeOptions(actor),
  ]);

  const kept = {
    q: params.q,
    status: params.status,
    responsible: params.responsible,
    due: params.due,
    committee: params.committee,
    sort: params.sort,
    dir: params.dir,
  };

  return (
    <div>
      <PageHeader
        title="Team to-dos"
        description="Action items from the meetings of your committees. Open a task to see its discussion or update its status."
      />

      <section aria-label="Summary" className="mb-4">
        <TaskSummaryTiles
          summary={summary}
          href={(status) => (status === undefined ? BASE : `${BASE}?status=${status}`)}
        />
      </section>

      <FilterBar
        basePath={BASE}
        query={params.q}
        searchLabel="Search tasks or people"
        preserve={{ sort: params.sort, dir: params.dir }}
        selects={[
          ...taskFilterSelects(params, null),
          {
            name: "committee",
            label: "Committee",
            value: params.committee,
            allLabel: "All committees",
            options: committees.map((committee) => ({
              value: committee.id,
              label: committee.name,
            })),
          },
        ]}
      />

      <Panel>
        <TaskTable
          page={page}
          basePath={BASE}
          searchParams={kept}
          sort={taskSortFrom(params)}
          showMeeting
          emptyTitle={summary.total === 0 ? "No tasks yet" : "No tasks match"}
          emptyDescription={
            summary.total === 0
              ? "Tasks are added from a meeting's Team To-Do List. Open a meeting to add the first one."
              : "No task matches these filters. Clear them to see every task."
          }
        />
      </Panel>
    </div>
  );
}
