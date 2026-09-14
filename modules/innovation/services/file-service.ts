import {
  BusinessRuleError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { prisma, type PrismaTransaction } from "@/lib/prisma";
import { recordAudit } from "@/platform/audit/audit";
import { type Actor, canAll, requirePermission } from "@/platform/authz/authz";
import {
  createDownloadUrl,
  createUploadUrl,
  isStorageConfigured,
  readObjectStart,
} from "@/platform/storage/storage";
import { INNOVATION_PERMISSIONS } from "../contracts/permissions";
import { uploadRequestSchema } from "../contracts/schemas";
import {
  MAX_FILE_BYTES,
  SNIFF_BYTES,
  cleanFileName,
  extensionOf,
  matchesContent,
  ruleFor,
} from "../domain/files";
import { INNOVATION_MODULE, assertId, auditFields, parseInput } from "./support";

/**
 * Files for knowledge items and idea attachments (CLAUDE.md §12).
 *
 * 1. `prepareUpload` authorises the upload, chooses a random storage key, records
 *    the file as PENDING and returns a short-lived upload URL. The browser sends the
 *    bytes straight to storage, so large files never pass through the app server.
 * 2. `verifyUploadedFile` (before the item is saved) confirms the object exists,
 *    has the size that was declared, and that its first bytes match its type.
 * 3. `markFileReady` (inside the item's transaction) claims it for that item.
 *
 * Downloads and previews are authorised against the item the file belongs to,
 * audited, and served through links that expire within minutes.
 */

const PENDING_LIFETIME_MS = 24 * 60 * 60 * 1000;
const DOWNLOAD_LINK_SECONDS = 60;
const PREVIEW_LINK_SECONDS = 300;

const NOT_CONFIGURED =
  "File uploads are not available yet: this server has no storage key configured.";

export function isFileStorageAvailable(): boolean {
  return isStorageConfigured();
}

export async function prepareUpload(
  actor: Actor,
  rawInput: unknown,
): Promise<{ fileId: string; uploadUrl: string; contentType: string }> {
  const rights = await canAll(actor, [
    INNOVATION_PERMISSIONS.IDEA_CREATE,
    INNOVATION_PERMISSIONS.KNOWLEDGE_CREATE,
  ]);
  if (!Object.values(rights).some(Boolean)) throw new ForbiddenError();
  if (!isStorageConfigured()) throw new BusinessRuleError(NOT_CONFIGURED);

  const input = parseInput(uploadRequestSchema, rawInput);
  const fileName = cleanFileName(input.fileName);
  const rule = ruleFor(fileName);
  if (fileName === "" || rule === null) {
    throw new ValidationError("This type of file is not accepted.", {
      file: [
        "Use a PDF, Word, Excel, PowerPoint, text or CSV file, or a PNG, JPEG or WebP image.",
      ],
    });
  }
  if (input.sizeBytes > MAX_FILE_BYTES) {
    throw new ValidationError("This file is too large.", {
      file: ["Files are limited to 25 MB."],
    });
  }

  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const random = crypto.randomUUID().replaceAll("-", "");
  const storageKey = `innovation/${now.getUTCFullYear()}/${month}/${random}.${extensionOf(fileName)}`;

  const file = await prisma.innovationFile.create({
    data: {
      storageKey,
      fileName,
      contentType: rule.contentType,
      sizeBytes: input.sizeBytes,
      uploadedBy: actor.id,
    },
    select: { id: true },
  });
  const { url } = await createUploadUrl(storageKey);
  return { fileId: file.id, uploadUrl: url, contentType: rule.contentType };
}

/**
 * Checks an uploaded file before an item is saved with it. Runs OUTSIDE the item's
 * transaction because it reads from storage over the network.
 */
export async function verifyUploadedFile(actor: Actor, fileId: string): Promise<void> {
  const invalid = (message: string) => new ValidationError(message, { file: [message] });

  assertId(fileId, "file");
  const file = await prisma.innovationFile.findUnique({
    where: { id: fileId },
    select: {
      storageKey: true,
      fileName: true,
      sizeBytes: true,
      status: true,
      uploadedBy: true,
      createdAt: true,
    },
  });
  if (
    file === null ||
    file.uploadedBy !== actor.id ||
    file.status !== "PENDING" ||
    Date.now() - file.createdAt.getTime() > PENDING_LIFETIME_MS
  ) {
    throw invalid("The attached file could not be found. Please upload it again.");
  }
  if (!isStorageConfigured()) throw new BusinessRuleError(NOT_CONFIGURED);

  const stored = await readObjectStart(file.storageKey, SNIFF_BYTES);
  if (stored === null) {
    throw invalid("The file did not finish uploading. Please try again.");
  }
  if (stored.size !== file.sizeBytes || stored.size > MAX_FILE_BYTES) {
    throw invalid("The uploaded file does not match the one selected. Please try again.");
  }
  if (!matchesContent(file.fileName, stored.head)) {
    throw invalid("This file's content does not match its type, so it was not accepted.");
  }
}

/** Claims a verified upload for the item being saved, in that item's transaction. */
export async function markFileReady(
  tx: PrismaTransaction,
  actor: Actor,
  fileId: string,
): Promise<void> {
  const claimed = await tx.innovationFile.updateMany({
    where: { id: fileId, uploadedBy: actor.id, status: "PENDING" },
    data: { status: "READY" },
  });
  if (claimed.count !== 1) {
    throw new ValidationError(
      "The attached file could not be used. Please upload it again.",
      {
        file: ["The attached file could not be used. Please upload it again."],
      },
    );
  }
}

/**
 * A short-lived link to a file, after checking the reader may see the item it
 * belongs to and may download files. Every download and preview is audited.
 */
export async function getFileLink(
  actor: Actor,
  fileId: string,
  mode: "download" | "preview",
): Promise<string> {
  assertId(fileId, "file");
  const file = await prisma.innovationFile.findUnique({
    where: { id: fileId },
    select: {
      storageKey: true,
      fileName: true,
      status: true,
      knowledgeItem: { select: { id: true, deletedAt: true } },
      idea: { select: { id: true, deletedAt: true } },
    },
  });
  if (file === null || file.status !== "READY") throw new NotFoundError("file");

  if (file.knowledgeItem !== null && file.knowledgeItem.deletedAt === null) {
    await requirePermission(actor, INNOVATION_PERMISSIONS.KNOWLEDGE_READ);
  } else if (file.idea !== null && file.idea.deletedAt === null) {
    await requirePermission(actor, INNOVATION_PERMISSIONS.IDEA_READ);
  } else {
    throw new NotFoundError("file");
  }
  await requirePermission(actor, INNOVATION_PERMISSIONS.KNOWLEDGE_DOWNLOAD);
  if (!isStorageConfigured()) throw new BusinessRuleError(NOT_CONFIGURED);

  const url = await createDownloadUrl(file.storageKey, {
    downloadAs: mode === "download" ? file.fileName : null,
    expiresInSeconds: mode === "download" ? DOWNLOAD_LINK_SECONDS : PREVIEW_LINK_SECONDS,
  });

  await recordAudit({
    ...auditFields(actor),
    action:
      mode === "download" ? "innovation.file.downloaded" : "innovation.file.previewed",
    module: INNOVATION_MODULE,
    entityType: "InnovationFile",
    entityId: fileId,
    summary: `${mode === "download" ? "Downloaded" : "Previewed"} ${file.fileName}`,
  });

  return url;
}
