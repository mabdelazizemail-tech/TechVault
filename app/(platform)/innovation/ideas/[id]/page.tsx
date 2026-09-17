import { Download, FileText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { BreadcrumbTitle } from "@/components/shell/breadcrumbs";
import { Panel, PanelHeader } from "@/components/ui/primitives";
import { INNOVATION_PERMISSIONS } from "@/modules/innovation/contracts/permissions";
import {
  getIdea,
  isFileStorageAvailable,
  listCategories,
} from "@/modules/innovation/contracts/service";
import { fileLabel, formatBytes } from "@/modules/innovation/domain/files";
import { IdeaStatusBadge } from "@/modules/innovation/ui/badges";
import { formatDate, formatRelative } from "@/modules/innovation/ui/format";
import { EditIdeaButton, EditOwnIdeaButton } from "@/modules/innovation/ui/idea-form";
import {
  CommentForm,
  ConvertIdeaButton,
  DeleteButton,
  DeleteCommentButton,
  VoteButton,
} from "@/modules/innovation/ui/idea-interactions";
import { Fact } from "@/modules/innovation/ui/lists";
import { orNotFound } from "@/modules/innovation/ui/page-helpers";
import { getActor } from "@/platform/auth/current-user";
import { canAll } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "Idea" };

/** One idea: what it is, who is behind it, votes, discussion, and review controls. */
export default async function IdeaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await getActor();

  const [idea, rights] = await Promise.all([
    orNotFound(getIdea(actor, id)),
    canAll(actor, [
      INNOVATION_PERMISSIONS.IDEA_VOTE,
      INNOVATION_PERMISSIONS.IDEA_COMMENT,
      INNOVATION_PERMISSIONS.IDEA_CREATE,
      INNOVATION_PERMISSIONS.IDEA_ADMINISTER,
      INNOVATION_PERMISSIONS.PROJECT_ADMINISTER,
      INNOVATION_PERMISSIONS.KNOWLEDGE_DOWNLOAD,
    ]),
  ]);
  const canManage = rights[INNOVATION_PERMISSIONS.IDEA_ADMINISTER] === true;
  // Administrators edit through review; the submitter edits their own idea while it
  // is New (ADR-031). The server enforces both rules again.
  const canEditOwn =
    !canManage &&
    idea.isMine &&
    idea.status === "NEW" &&
    rights[INNOVATION_PERMISSIONS.IDEA_CREATE] === true;
  const categories = canManage
    ? await listCategories(actor, "IDEA", { includeArchived: true })
    : canEditOwn
      ? // Archived ones too, so an idea filed under an archived category keeps it.
        await listCategories(actor, "IDEA", { includeArchived: true })
      : [];
  const canConvert =
    canManage &&
    rights[INNOVATION_PERMISSIONS.PROJECT_ADMINISTER] === true &&
    idea.status === "APPROVED" &&
    idea.project === null;

  return (
    <div>
      <BreadcrumbTitle segment={idea.id} label={idea.title} />

      <div className="flex flex-wrap items-start gap-4 pb-4">
        <VoteButton
          ideaId={idea.id}
          voteCount={idea.voteCount}
          hasVoted={idea.hasVoted}
          canVote={rights[INNOVATION_PERMISSIONS.IDEA_VOTE] === true}
          isMine={idea.isMine}
          size="lg"
        />
        <div className="min-w-0 flex-1">
          <h1 dir="auto" className="text-foreground text-[30px] leading-tight">
            {idea.title}
          </h1>
          <p className="text-foreground-muted mt-1.5 flex flex-wrap items-center gap-2 text-[12.5px]">
            <IdeaStatusBadge status={idea.status} />
            <span>{idea.category.name}</span>
            <span aria-hidden="true">·</span>
            <span dir="auto">Submitted by {idea.submitter.name}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={idea.createdAt.toISOString()}>
              {formatRelative(idea.createdAt)}
            </time>
          </p>
        </div>
        {canEditOwn && (
          <EditOwnIdeaButton
            idea={{
              id: idea.id,
              title: idea.title,
              description: idea.description,
              categoryId: idea.categoryId,
              attachment:
                idea.attachment === null
                  ? null
                  : {
                      fileId: idea.attachment.id,
                      fileName: idea.attachment.fileName,
                      sizeBytes: idea.attachment.sizeBytes,
                    },
            }}
            categories={categories}
            filesEnabled={isFileStorageAvailable()}
          />
        )}
        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            {canConvert && <ConvertIdeaButton ideaId={idea.id} title={idea.title} />}
            <EditIdeaButton
              idea={{
                id: idea.id,
                title: idea.title,
                description: idea.description,
                categoryId: idea.categoryId,
                status: idea.status,
                ownerId: idea.owner?.id ?? null,
              }}
              categories={categories}
            />
            <DeleteButton kind="idea" id={idea.id} name={idea.title} />
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
              {idea.description}
            </p>
            {idea.attachment !== null && (
              <div className="border-border mt-4 flex items-center gap-3 border px-3 py-2.5">
                <FileText
                  aria-hidden="true"
                  size={18}
                  className="text-foreground-muted"
                />
                <span className="min-w-0 flex-1">
                  <span
                    dir="auto"
                    className="text-foreground block truncate text-[13.5px]"
                  >
                    {idea.attachment.fileName}
                  </span>
                  <span className="text-foreground-subtle text-[11.5px]">
                    {fileLabel(idea.attachment.fileName)} ·{" "}
                    {formatBytes(idea.attachment.sizeBytes)}
                  </span>
                </span>
                {rights[INNOVATION_PERMISSIONS.KNOWLEDGE_DOWNLOAD] === true && (
                  <a
                    href={`/innovation/files/${idea.attachment.id}`}
                    className="text-primary-ink inline-flex items-center gap-1.5 text-[13px] font-extrabold hover:underline"
                  >
                    <Download aria-hidden="true" size={14} />
                    Download
                  </a>
                )}
              </div>
            )}
          </Panel>

          <Panel className="overflow-hidden">
            <PanelHeader title={`Comments (${idea.commentCount})`} />
            {idea.comments.length === 0 ? (
              <p className="text-foreground-muted px-5 py-4 text-[13px]">
                No comments yet. What do you think?
              </p>
            ) : (
              <ul>
                {idea.comments.map((comment) => (
                  <li
                    key={comment.id}
                    className="border-border border-b px-5 py-3 last:border-0"
                  >
                    <p className="text-foreground-muted flex items-center gap-2 text-[12px]">
                      <span dir="auto" className="text-foreground font-extrabold">
                        {comment.author.name}
                      </span>
                      <time dateTime={comment.createdAt.toISOString()}>
                        {formatRelative(comment.createdAt)}
                      </time>
                      {(comment.isMine || canManage) && (
                        <span className="ms-auto">
                          <DeleteCommentButton commentId={comment.id} />
                        </span>
                      )}
                    </p>
                    <p
                      dir="auto"
                      className="text-foreground mt-1 text-[13.5px] whitespace-pre-line"
                    >
                      {comment.body}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {rights[INNOVATION_PERMISSIONS.IDEA_COMMENT] === true && (
              <div className="border-border border-t px-5 py-4">
                <CommentForm ideaId={idea.id} />
              </div>
            )}
          </Panel>
        </div>

        <Panel className="h-fit overflow-hidden">
          <PanelHeader title="Details" />
          <dl>
            <Fact label="Status">
              <IdeaStatusBadge status={idea.status} />
            </Fact>
            <Fact label="Category">{idea.category.name}</Fact>
            <Fact label="Votes">{idea.voteCount}</Fact>
            <Fact label="Submitted by">{idea.submitter.name}</Fact>
            <Fact label="Owner">{idea.owner?.name ?? "Not assigned yet"}</Fact>
            {idea.project !== null && (
              <Fact label="Project">
                <Link
                  href={`/innovation/projects/${idea.project.id}`}
                  className="text-primary-ink font-extrabold hover:underline"
                >
                  {idea.project.name}
                </Link>
              </Fact>
            )}
            <Fact label="Submitted">{formatDate(idea.createdAt)}</Fact>
            <Fact label="Last updated">{formatDate(idea.updatedAt)}</Fact>
          </dl>
        </Panel>
      </div>
    </div>
  );
}
