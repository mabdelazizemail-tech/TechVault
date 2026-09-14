import { Pagination } from "@/components/ui/data-table";
import { EmptyState, Panel } from "@/components/ui/primitives";
import type { ActivityDto, Paginated } from "../contracts/types";
import { TimelineItem } from "./activity-timeline";

/** A paginated feed of activities across records — activities, tasks or notes. */
export function ActivityList({
  result,
  basePath,
  searchParams,
  canUpdateActivities,
  emptyTitle,
  emptyDescription,
}: {
  result: Paginated<ActivityDto>;
  basePath: string;
  searchParams: Record<string, string | undefined>;
  canUpdateActivities: boolean;
  emptyTitle: string;
  emptyDescription: string;
}) {
  return (
    <Panel className="overflow-hidden">
      {result.rows.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <>
          <ol>
            {result.rows.map((activity) => (
              <TimelineItem
                key={activity.id}
                activity={activity}
                canUpdateActivities={canUpdateActivities}
              />
            ))}
          </ol>
          <Pagination
            page={{ page: result.page, pageSize: result.pageSize, total: result.total }}
            basePath={basePath}
            searchParams={searchParams}
          />
        </>
      )}
    </Panel>
  );
}
