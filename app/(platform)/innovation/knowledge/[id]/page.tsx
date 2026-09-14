import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { BreadcrumbTitle } from "@/components/shell/breadcrumbs";
import { Panel, PanelHeader } from "@/components/ui/primitives";
import { isAppError } from "@/lib/errors";
import { INNOVATION_PERMISSIONS } from "@/modules/innovation/contracts/permissions";
import {
  getFileLink,
  getKnowledgeItem,
  isFileStorageAvailable,
  listCategories,
} from "@/modules/innovation/contracts/service";
import { fileLabel, formatBytes } from "@/modules/innovation/domain/files";
import { formatDate } from "@/modules/innovation/ui/format";
import { DeleteButton } from "@/modules/innovation/ui/idea-interactions";
import { EditKnowledgeButton } from "@/modules/innovation/ui/knowledge-form";
import { Fact } from "@/modules/innovation/ui/lists";
import { orNotFound } from "@/modules/innovation/ui/page-helpers";
import { getActor } from "@/platform/auth/current-user";
import { canAll } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "Knowledge" };

/**
 * One knowledge item: the document itself when the browser can show it (PDFs and
 * images, through a link that expires in minutes), otherwise a download.
 */
export default async function KnowledgeItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await getActor();

  const [item, rights] = await Promise.all([
    orNotFound(getKnowledgeItem(actor, id)),
    canAll(actor, [
      INNOVATION_PERMISSIONS.KNOWLEDGE_DOWNLOAD,
      INNOVATION_PERMISSIONS.KNOWLEDGE_ADMINISTER,
    ]),
  ]);
  const canDownload = rights[INNOVATION_PERMISSIONS.KNOWLEDGE_DOWNLOAD] === true;
  const canManage = rights[INNOVATION_PERMISSIONS.KNOWLEDGE_ADMINISTER] === true;

  const [categories, preview] = await Promise.all([
    canManage
      ? listCategories(actor, "KNOWLEDGE", { includeArchived: true })
      : Promise.resolve([]),
    item.file !== null && item.file.preview !== null && canDownload
      ? getFileLink(actor, item.file.id, "preview").then(
          (url) => ({ url, error: null }),
          (error: unknown) => ({
            url: null,
            error: isAppError(error) ? error.message : "The preview could not be loaded.",
          }),
        )
      : Promise.resolve(null),
  ]);

  return (
    <div>
      <BreadcrumbTitle segment={item.id} label={item.title} />

      <div className="flex flex-wrap items-start justify-between gap-4 pb-4">
        <div className="min-w-0">
          <h1 dir="auto" className="text-foreground text-[30px] leading-tight">
            {item.title}
          </h1>
          <p className="text-foreground-muted mt-1.5 flex flex-wrap items-center gap-2 text-[12.5px]">
            <span className="text-foreground">{item.category.name}</span>
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
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {item.file !== null && canDownload && (
            <a
              href={`/innovation/files/${item.file.id}`}
              className="bg-primary text-primary-foreground hover:bg-primary-hover inline-flex min-h-9 items-center gap-1.5 px-3.5 text-sm font-extrabold"
            >
              <Download aria-hidden="true" size={15} />
              Download
            </a>
          )}
          {canManage && (
            <>
              <EditKnowledgeButton
                item={{
                  id: item.id,
                  title: item.title,
                  description: item.description,
                  categoryId: item.categoryId,
                  tags: item.tags,
                  file: item.file,
                  projectId: item.project?.id ?? null,
                }}
                categories={categories}
                filesEnabled={isFileStorageAvailable()}
              />
              <DeleteButton kind="knowledge" id={item.id} name={item.title} />
            </>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          {item.description !== null && (
            <Panel className="px-5 py-4">
              <p
                dir="auto"
                className="text-foreground text-[14.5px] leading-relaxed whitespace-pre-line"
              >
                {item.description}
              </p>
            </Panel>
          )}

          {item.file !== null && (
            <Panel className="overflow-hidden">
              <PanelHeader title={item.file.fileName} />
              {preview?.url != null && item.file.preview === "pdf" ? (
                <iframe
                  src={preview.url}
                  title={`Preview of ${item.file.fileName}`}
                  className="h-[72vh] w-full border-0"
                />
              ) : preview?.url != null && item.file.preview === "image" ? (
                // A signed, expiring URL: next/image cannot optimise it.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={preview.url}
                  alt={item.title}
                  className="mx-auto max-h-[72vh] w-auto"
                />
              ) : (
                <p className="text-foreground-muted px-5 py-6 text-[13px]">
                  {preview?.error ??
                    (canDownload
                      ? `${fileLabel(item.file.fileName)} files can't be previewed here. Download to open it.`
                      : "You can see this item, but not download its file.")}
                </p>
              )}
            </Panel>
          )}
        </div>

        <Panel className="h-fit overflow-hidden">
          <PanelHeader title="Details" />
          <dl>
            <Fact label="Category">{item.category.name}</Fact>
            {item.file !== null && (
              <Fact label="File">
                {fileLabel(item.file.fileName)} · {formatBytes(item.file.sizeBytes)}
              </Fact>
            )}
            <Fact label="Owner">{item.owner?.name ?? "—"}</Fact>
            {item.project !== null && (
              <Fact label="Project">
                <Link
                  href={`/innovation/projects/${item.project.id}`}
                  className="text-primary-ink font-extrabold hover:underline"
                >
                  {item.project.name}
                </Link>
              </Fact>
            )}
            <Fact label="Added">{formatDate(item.createdAt)}</Fact>
            <Fact label="Updated">{formatDate(item.updatedAt)}</Fact>
          </dl>
        </Panel>
      </div>
    </div>
  );
}
