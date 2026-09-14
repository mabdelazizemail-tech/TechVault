import type { Metadata } from "next";
import { Pagination } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filter-bar";
import { EmptyState, PageHeader, Panel } from "@/components/ui/primitives";
import { INNOVATION_PERMISSIONS } from "@/modules/innovation/contracts/permissions";
import { listProjects } from "@/modules/innovation/contracts/service";
import {
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
} from "@/modules/innovation/contracts/types";
import { ProjectCard } from "@/modules/innovation/ui/lists";
import { flatParams, orNotFound } from "@/modules/innovation/ui/page-helpers";
import { NewProjectButton } from "@/modules/innovation/ui/project-form";
import { getActor } from "@/platform/auth/current-user";
import { canAll } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "Projects" };

/** Projects that grew out of ideas. */
export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = flatParams(await searchParams);
  const actor = await getActor();

  const [result, rights] = await Promise.all([
    orNotFound(listProjects(actor, params)),
    canAll(actor, [INNOVATION_PERMISSIONS.PROJECT_ADMINISTER]),
  ]);
  const canManage = rights[INNOVATION_PERMISSIONS.PROJECT_ADMINISTER] === true;
  const filtered = (params.q ?? "") !== "" || (params.status ?? "") !== "";

  return (
    <div>
      <PageHeader
        title="Projects"
        description="Approved ideas being built, with their team, documents and lessons learned."
        actions={canManage ? <NewProjectButton /> : undefined}
      />
      <FilterBar
        basePath="/innovation/projects"
        query={params.q}
        searchLabel="Search projects…"
        selects={[
          {
            name: "status",
            label: "Status",
            value: params.status,
            allLabel: "Any status",
            options: PROJECT_STATUSES.map((value) => ({
              value,
              label: PROJECT_STATUS_LABELS[value],
            })),
          },
        ]}
      />
      {result.rows.length === 0 ? (
        <Panel>
          <EmptyState
            title={filtered ? "No projects match" : "No projects yet"}
            description={
              filtered
                ? "Try other words or another status."
                : "Projects appear here when an approved idea is turned into one."
            }
            action={!filtered && canManage ? <NewProjectButton /> : undefined}
          />
        </Panel>
      ) : (
        <>
          <ul className="bg-border border-border grid gap-px border md:grid-cols-2">
            {result.rows.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </ul>
          <Panel className="mt-3 overflow-hidden">
            <Pagination
              page={{ page: result.page, pageSize: result.pageSize, total: result.total }}
              basePath="/innovation/projects"
              searchParams={params}
            />
          </Panel>
        </>
      )}
    </div>
  );
}
