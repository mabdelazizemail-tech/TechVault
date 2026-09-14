import type { Metadata } from "next";
import Link from "next/link";
import { BreadcrumbTitle } from "@/components/shell/breadcrumbs";
import { Panel, PanelHeader } from "@/components/ui/primitives";
import { INNOVATION_PERMISSIONS } from "@/modules/innovation/contracts/permissions";
import {
  getProject,
  isFileStorageAvailable,
  listCategories,
} from "@/modules/innovation/contracts/service";
import { LESSONS_LEARNED_CATEGORY } from "@/modules/innovation/domain/categories";
import { ProjectStatusBadge } from "@/modules/innovation/ui/badges";
import { formatDate } from "@/modules/innovation/ui/format";
import { DeleteButton } from "@/modules/innovation/ui/idea-interactions";
import { AddKnowledgeButton } from "@/modules/innovation/ui/knowledge-form";
import { Fact, KnowledgeRow } from "@/modules/innovation/ui/lists";
import { orNotFound } from "@/modules/innovation/ui/page-helpers";
import { EditProjectButton } from "@/modules/innovation/ui/project-form";
import { getActor } from "@/platform/auth/current-user";
import { canAll } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "Project" };

/** One project: what it is, who is on it, its documents and what it taught us. */
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await getActor();

  const [project, rights] = await Promise.all([
    orNotFound(getProject(actor, id)),
    canAll(actor, [
      INNOVATION_PERMISSIONS.PROJECT_ADMINISTER,
      INNOVATION_PERMISSIONS.KNOWLEDGE_CREATE,
      INNOVATION_PERMISSIONS.KNOWLEDGE_DOWNLOAD,
    ]),
  ]);
  const canManage = rights[INNOVATION_PERMISSIONS.PROJECT_ADMINISTER] === true;
  const canAddDocuments = rights[INNOVATION_PERMISSIONS.KNOWLEDGE_CREATE] === true;
  const categories = canAddDocuments ? await listCategories(actor, "KNOWLEDGE") : [];
  const lessonsCategory = categories.find(
    (category) => category.name.toLowerCase() === LESSONS_LEARNED_CATEGORY,
  );
  const filesEnabled = isFileStorageAvailable();

  return (
    <div>
      <BreadcrumbTitle segment={project.id} label={project.name} />

      <div className="flex flex-wrap items-start justify-between gap-4 pb-4">
        <div className="min-w-0">
          <h1 dir="auto" className="text-foreground text-[30px] leading-tight">
            {project.name}
          </h1>
          <p className="text-foreground-muted mt-1.5 flex flex-wrap items-center gap-2 text-[12.5px]">
            <ProjectStatusBadge status={project.status} />
            {project.owner !== null && (
              <span dir="auto">Led by {project.owner.name}</span>
            )}
          </p>
        </div>
        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <EditProjectButton
              project={{
                id: project.id,
                name: project.name,
                description: project.description,
                ownerId: project.owner?.id ?? null,
                status: project.status,
                memberIds: project.members.map((member) => member.id),
                lessonsLearned: project.lessonsLearned,
              }}
            />
            <DeleteButton kind="project" id={project.id} name={project.name} />
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Panel className="px-5 py-4">
            <p
              dir="auto"
              className="text-foreground text-[14.5px] leading-relaxed whitespace-pre-line"
            >
              {project.description ?? (
                <span className="text-foreground-muted">No description yet.</span>
              )}
            </p>
          </Panel>

          <Panel className="overflow-hidden">
            <PanelHeader
              title={`Documents (${project.documents.length})`}
              actions={
                canAddDocuments ? (
                  <AddKnowledgeButton
                    categories={categories}
                    filesEnabled={filesEnabled}
                    projectId={project.id}
                    label="Add document"
                    variant="secondary"
                  />
                ) : undefined
              }
            />
            {project.documents.length === 0 ? (
              <p className="text-foreground-muted px-5 py-4 text-[13px]">
                No documents yet. Add plans, specifications or anything the team produced.
              </p>
            ) : (
              <ul>
                {project.documents.map((document) => (
                  <KnowledgeRow
                    key={document.id}
                    item={document}
                    canDownload={
                      rights[INNOVATION_PERMISSIONS.KNOWLEDGE_DOWNLOAD] === true
                    }
                  />
                ))}
              </ul>
            )}
          </Panel>

          <Panel className="overflow-hidden">
            <PanelHeader
              title="Lessons learned"
              actions={
                canAddDocuments && lessonsCategory !== undefined ? (
                  <AddKnowledgeButton
                    categories={categories}
                    filesEnabled={filesEnabled}
                    projectId={project.id}
                    defaultCategoryId={lessonsCategory.id}
                    label="Add lesson learned"
                    variant="secondary"
                  />
                ) : undefined
              }
            />
            <p
              dir="auto"
              className="text-foreground px-5 py-4 text-[14px] whitespace-pre-line"
            >
              {project.lessonsLearned ?? (
                <span className="text-foreground-muted">
                  Nothing recorded yet. What would you tell the next team?
                </span>
              )}
            </p>
          </Panel>
        </div>

        <div className="flex flex-col gap-4">
          <Panel className="overflow-hidden">
            <PanelHeader title="Details" />
            <dl>
              <Fact label="Status">
                <ProjectStatusBadge status={project.status} />
              </Fact>
              <Fact label="Owner">{project.owner?.name ?? "Not assigned"}</Fact>
              {project.idea !== null && (
                <Fact label="From idea">
                  <Link
                    href={`/innovation/ideas/${project.idea.id}`}
                    className="text-primary-ink font-extrabold hover:underline"
                  >
                    {project.idea.name}
                  </Link>
                </Fact>
              )}
              <Fact label="Started">{formatDate(project.createdAt)}</Fact>
              <Fact label="Updated">{formatDate(project.updatedAt)}</Fact>
            </dl>
          </Panel>
          <Panel className="overflow-hidden">
            <PanelHeader title={`Team (${project.members.length})`} />
            {project.members.length === 0 ? (
              <p className="text-foreground-muted px-4 py-3 text-[13px]">
                No one on the team yet.
              </p>
            ) : (
              <ul className="flex flex-wrap gap-1.5 px-4 py-3">
                {project.members.map((member) => (
                  <li
                    key={member.id}
                    dir="auto"
                    className="bg-surface-sunken text-foreground px-2 py-1 text-[12.5px]"
                  >
                    {member.name}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
