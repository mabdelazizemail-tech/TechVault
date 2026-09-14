import {
  Download,
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  Lightbulb,
  MessageSquare,
  Paperclip,
  Presentation,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type {
  FileDto,
  IdeaListItem,
  KnowledgeListItem,
  ProjectListItem,
} from "../contracts/types";
import { fileLabel, formatBytes } from "../domain/files";
import { IdeaStatusBadge, ProjectStatusBadge } from "./badges";
import { formatRelative, plural } from "./format";
import { VoteButton } from "./idea-interactions";

/** List rows and small presentational pieces shared by the Think Tank screens. */

/** An icon for a file's type; a plain document icon when there is no file. */
export function FileIcon({ file, size }: { file: FileDto | null; size: number }) {
  if (file === null) return <FileText aria-hidden="true" size={size} />;
  if (file.preview === "image") return <FileImage aria-hidden="true" size={size} />;
  const label = fileLabel(file.fileName);
  if (label === "Excel" || label === "CSV") {
    return <FileSpreadsheet aria-hidden="true" size={size} />;
  }
  if (label === "PowerPoint") return <Presentation aria-hidden="true" size={size} />;
  if (label === "PDF" || label === "Word" || label === "Text") {
    return <FileText aria-hidden="true" size={size} />;
  }
  return <File aria-hidden="true" size={size} />;
}

export function Meta({ children }: { children: ReactNode }) {
  return (
    <p className="text-foreground-muted mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
      {children}
    </p>
  );
}

export function Dot() {
  return (
    <span aria-hidden="true" className="text-foreground-subtle">
      ·
    </span>
  );
}

export function IdeaRow({ idea, canVote }: { idea: IdeaListItem; canVote: boolean }) {
  return (
    <li className="border-border flex gap-3 border-b px-4 py-3.5 last:border-0">
      <Lightbulb
        aria-hidden="true"
        size={18}
        className="text-primary-ink mt-0.5 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <Link
          href={`/innovation/ideas/${idea.id}`}
          dir="auto"
          className="text-foreground hover:text-primary-ink text-[15px] font-extrabold hover:underline"
        >
          {idea.title}
        </Link>
        {idea.excerpt !== "" && (
          <p dir="auto" className="text-foreground-muted mt-0.5 line-clamp-2 text-[13px]">
            {idea.excerpt}
          </p>
        )}
        <Meta>
          <IdeaStatusBadge status={idea.status} />
          <span>{idea.category.name}</span>
          <Dot />
          <span dir="auto">by {idea.submitter.name}</span>
          {idea.hasAttachment && (
            <>
              <Dot />
              <Paperclip aria-label="Has an attachment" size={12} />
            </>
          )}
          <Dot />
          <time dateTime={idea.createdAt.toISOString()}>
            {formatRelative(idea.createdAt)}
          </time>
        </Meta>
        <div className="mt-2.5 flex items-center gap-4">
          <VoteButton
            ideaId={idea.id}
            voteCount={idea.voteCount}
            hasVoted={idea.hasVoted}
            canVote={canVote}
            isMine={idea.isMine}
          />
          <Link
            href={`/innovation/ideas/${idea.id}#comments`}
            className="text-foreground-muted hover:text-foreground inline-flex items-center gap-1.5 text-[13px]"
          >
            <MessageSquare aria-hidden="true" size={15} />
            {plural(idea.commentCount, "comment")}
          </Link>
        </div>
      </div>
    </li>
  );
}

export function KnowledgeRow({
  item,
  canDownload,
}: {
  item: KnowledgeListItem;
  canDownload: boolean;
}) {
  return (
    <li className="border-border flex gap-3 border-b px-4 py-3.5 last:border-0">
      <span
        aria-hidden="true"
        className="bg-surface-sunken text-foreground-muted grid size-10 shrink-0 place-items-center"
      >
        <FileIcon file={item.file} size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <Link
          href={`/innovation/knowledge/${item.id}`}
          dir="auto"
          className="text-foreground hover:text-primary-ink text-[15px] font-extrabold hover:underline"
        >
          {item.title}
        </Link>
        {item.excerpt !== "" && (
          <p dir="auto" className="text-foreground-muted mt-0.5 line-clamp-2 text-[13px]">
            {item.excerpt}
          </p>
        )}
        <Meta>
          <span className="text-foreground">{item.category.name}</span>
          {item.file !== null && (
            <>
              <Dot />
              <span>
                {fileLabel(item.file.fileName)} · {formatBytes(item.file.sizeBytes)}
              </span>
            </>
          )}
          {item.project !== null && (
            <>
              <Dot />
              <Link
                href={`/innovation/projects/${item.project.id}`}
                className="hover:underline"
                dir="auto"
              >
                {item.project.name}
              </Link>
            </>
          )}
          <Dot />
          <span>Updated {formatRelative(item.updatedAt)}</span>
          {item.tags.map((tag) => (
            <Link
              key={tag}
              href={`/innovation/knowledge?q=${encodeURIComponent(tag)}`}
              className="border-border hover:border-border-strong border px-1.5 text-[11px]"
              dir="auto"
            >
              #{tag}
            </Link>
          ))}
        </Meta>
      </div>
      {item.file !== null && canDownload && (
        <a
          href={`/innovation/files/${item.file.id}`}
          aria-label={`Download ${item.file.fileName}`}
          title="Download"
          className="text-foreground-muted hover:bg-surface-hover hover:text-foreground grid size-9 shrink-0 place-items-center self-center"
        >
          <Download aria-hidden="true" size={16} />
        </a>
      )}
    </li>
  );
}

export function ProjectCard({ project }: { project: ProjectListItem }) {
  return (
    <li className="bg-surface flex flex-col px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <Link
          href={`/innovation/projects/${project.id}`}
          dir="auto"
          className="text-foreground hover:text-primary-ink text-[15px] font-extrabold hover:underline"
        >
          {project.name}
        </Link>
        <ProjectStatusBadge status={project.status} />
      </div>
      {project.excerpt !== "" && (
        <p dir="auto" className="text-foreground-muted mt-1 line-clamp-2 text-[13px]">
          {project.excerpt}
        </p>
      )}
      <Meta>
        {project.owner !== null && (
          <>
            <span dir="auto">Led by {project.owner.name}</span>
            <Dot />
          </>
        )}
        <span>{plural(project.memberCount, "person", "people")}</span>
        <Dot />
        <span>{plural(project.documentCount, "document")}</span>
        <Dot />
        <span>Updated {formatRelative(project.updatedAt)}</span>
      </Meta>
      {project.idea !== null && (
        <p className="text-foreground-subtle mt-1.5 text-[11.5px]">
          From idea:{" "}
          <Link
            href={`/innovation/ideas/${project.idea.id}`}
            className="hover:underline"
            dir="auto"
          >
            {project.idea.name}
          </Link>
        </p>
      )}
    </li>
  );
}

/** A compact detail row for side panels. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-border flex items-baseline justify-between gap-3 border-b px-4 py-2.5 text-[13px] last:border-0">
      <dt className="text-foreground-muted shrink-0">{label}</dt>
      <dd className="text-foreground min-w-0 text-end" dir="auto">
        {children}
      </dd>
    </div>
  );
}
