import {
  BusinessRuleError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/platform/audit/audit";
import { type Actor, can, requirePermission } from "@/platform/authz/authz";
import type { ScopeTarget } from "@/platform/authz/types";
import { publish } from "@/platform/events/publish";
import {
  MAX_FILE_BYTES,
  SNIFF_BYTES,
  cleanFileName,
  extensionOf,
  matchesContent,
  ruleFor,
} from "@/platform/storage/file-types";
import {
  createDownloadUrl,
  createUploadUrl,
  isStorageConfigured,
  readObjectStart,
} from "@/platform/storage/storage";
import { CRM_EVENTS } from "../contracts/events";
import { CRM_PERMISSIONS } from "../contracts/permissions";
import { attachFilesSchema, attachmentUploadSchema } from "../contracts/schemas";
import type {
  OpportunityAttachmentDto,
  OpportunityAttachments,
} from "../contracts/types";
import { toScopeTarget, toUserRef, userRefSelect } from "../repositories/selects";
import { CRM_MODULE, assertCanRead, auditFields, isUuid, parseInput } from "./support";

/**
 * Files attached to a deal — a signed contract, a purchase order (ADR-039). The CRM
 * keeps them in the private storage bucket until ECM exists, following the Think
 * Tank's pattern (ADR-021):
 *
 * 1. `prepareOpportunityAttachment` checks the caller may edit the deal, records the
 *    file as PENDING under a random key and returns a one-time upload link, so the
 *    bytes go from the browser straight to storage.
 * 2. `attachOpportunityFiles` checks each upload's size and first bytes against its
 *    type, then attaches them all in one transaction with an audit record and event.
 *
 * Anyone who may see the deal may open its files, through an audited link that
 * expires within minutes. The uploader (while they may edit the deal) or someone who
 * may delete deals can remove a file; it stays on record and in storage.
 */

const PENDING_LIFETIME_MS = 24 * 60 * 60 * 1000;
const DOWNLOAD_LINK_SECONDS = 60;
const PREVIEW_LINK_SECONDS = 300;

const NOT_CONFIGURED =
  "Files cannot be attached yet: this server has no storage key configured.";

/** The deal, if the caller may see it, with the scope target its writes are checked against. */
async function visibleOpportunity(
  actor: Actor,
  opportunityId: string,
): Promise<{ id: string; name: string; target: ScopeTarget }> {
  if (!isUuid(opportunityId)) throw new NotFoundError("opportunity");
  const row = await prisma.crmOpportunity.findFirst({
    where: { id: opportunityId, deletedAt: null },
    select: { id: true, name: true, ownerId: true, owner: { select: userRefSelect } },
  });
  if (row === null) throw new NotFoundError("opportunity");
  const target = toScopeTarget(row.ownerId, row.owner);
  await assertCanRead(actor, CRM_PERMISSIONS.OPPORTUNITY_READ, target, "opportunity");
  return { id: row.id, name: row.name, target };
}

export async function prepareOpportunityAttachment(
  actor: Actor,
  opportunityId: string,
  rawInput: unknown,
): Promise<{ attachmentId: string; uploadUrl: string; contentType: string }> {
  const deal = await visibleOpportunity(actor, opportunityId);
  await requirePermission(actor, CRM_PERMISSIONS.OPPORTUNITY_UPDATE, deal.target);
  if (!isStorageConfigured()) throw new BusinessRuleError(NOT_CONFIGURED);

  const input = parseInput(attachmentUploadSchema, rawInput);
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
  const storageKey = `crm/opportunities/${now.getUTCFullYear()}/${month}/${random}.${extensionOf(fileName)}`;

  const attachment = await prisma.crmOpportunityAttachment.create({
    data: {
      opportunityId: deal.id,
      storageKey,
      fileName,
      contentType: rule.contentType,
      sizeBytes: input.sizeBytes,
      uploadedBy: actor.id,
    },
    select: { id: true },
  });
  const { url } = await createUploadUrl(storageKey);
  return { attachmentId: attachment.id, uploadUrl: url, contentType: rule.contentType };
}

/**
 * Attaches uploaded files to the deal once their bytes are checked. All or none: if
 * any file fails its check, nothing is attached and the message names that file.
 */
export async function attachOpportunityFiles(
  actor: Actor,
  opportunityId: string,
  rawInput: unknown,
): Promise<{ attached: number }> {
  const deal = await visibleOpportunity(actor, opportunityId);
  await requirePermission(actor, CRM_PERMISSIONS.OPPORTUNITY_UPDATE, deal.target);
  const { attachmentIds } = parseInput(attachFilesSchema, rawInput);
  if (!isStorageConfigured()) throw new BusinessRuleError(NOT_CONFIGURED);

  const pending = await prisma.crmOpportunityAttachment.findMany({
    where: { id: { in: attachmentIds } },
    select: {
      id: true,
      opportunityId: true,
      storageKey: true,
      fileName: true,
      sizeBytes: true,
      status: true,
      uploadedBy: true,
      createdAt: true,
    },
  });
  // Storage is read outside the transaction, which would otherwise wait on the network.
  for (const id of attachmentIds) {
    const file = pending.find((candidate) => candidate.id === id);
    const invalid = (message: string) =>
      new ValidationError(message, { file: [message] });
    if (
      file === undefined ||
      file.opportunityId !== deal.id ||
      file.uploadedBy !== actor.id ||
      file.status !== "PENDING" ||
      Date.now() - file.createdAt.getTime() > PENDING_LIFETIME_MS
    ) {
      throw invalid("A file could not be found. Please choose it again.");
    }
    const stored = await readObjectStart(file.storageKey, SNIFF_BYTES);
    if (stored === null) {
      throw invalid(`“${file.fileName}” did not finish uploading. Please try again.`);
    }
    if (stored.size !== file.sizeBytes || stored.size > MAX_FILE_BYTES) {
      throw invalid(
        `“${file.fileName}” does not match the file that was chosen. Please try again.`,
      );
    }
    if (!matchesContent(file.fileName, stored.head)) {
      throw invalid(
        `The content of “${file.fileName}” does not match its type, so it was not accepted.`,
      );
    }
  }

  const names = attachmentIds.map(
    (id) => pending.find((file) => file.id === id)?.fileName ?? "",
  );
  await prisma.$transaction(async (tx) => {
    const attached = await tx.crmOpportunityAttachment.updateMany({
      where: {
        id: { in: attachmentIds },
        opportunityId: deal.id,
        uploadedBy: actor.id,
        status: "PENDING",
      },
      data: { status: "READY", attachedAt: new Date() },
    });
    if (attached.count !== attachmentIds.length) {
      throw new ValidationError("A file could not be attached. Please choose it again.", {
        file: ["A file could not be attached. Please choose it again."],
      });
    }
    await recordAudit(
      {
        ...auditFields(actor),
        action: "crm.opportunity.attachments_added",
        module: CRM_MODULE,
        entityType: "CrmOpportunity",
        entityId: deal.id,
        summary: `Attached ${names.length === 1 ? `“${names[0]}”` : `${names.length} files`} to ${deal.name}`,
      },
      tx,
    );
    await publish(tx, {
      name: CRM_EVENTS.OPPORTUNITY_ATTACHMENTS_ADDED,
      actorId: actor.id,
      correlationId: actor.correlationId ?? null,
      payload: { opportunityId: deal.id, attachmentIds },
    });
  });
  return { attached: attachmentIds.length };
}

/** The deal's attached files, newest first, and what the viewer may do with them. */
export async function listOpportunityAttachments(
  actor: Actor,
  opportunityId: string,
): Promise<OpportunityAttachments> {
  const deal = await visibleOpportunity(actor, opportunityId);
  const [canUpdate, canDelete, rows] = await Promise.all([
    can(actor, CRM_PERMISSIONS.OPPORTUNITY_UPDATE, deal.target),
    can(actor, CRM_PERMISSIONS.OPPORTUNITY_DELETE, deal.target),
    prisma.crmOpportunityAttachment.findMany({
      where: { opportunityId: deal.id, status: "READY", deletedAt: null },
      orderBy: [{ attachedAt: "desc" }, { id: "desc" }],
      take: 100,
      select: {
        id: true,
        fileName: true,
        contentType: true,
        sizeBytes: true,
        attachedAt: true,
        uploadedBy: true,
        uploader: { select: userRefSelect },
      },
    }),
  ]);
  return {
    canAdd: canUpdate,
    storageAvailable: isStorageConfigured(),
    items: rows.map((row): OpportunityAttachmentDto => ({
      id: row.id,
      fileName: row.fileName,
      contentType: row.contentType,
      sizeBytes: row.sizeBytes,
      uploadedBy: toUserRef(row.uploader),
      attachedAt: row.attachedAt ?? new Date(0),
      preview: (ruleFor(row.fileName)?.preview ?? null) !== null,
      canRemove: canDelete || (canUpdate && row.uploadedBy === actor.id),
    })),
  };
}

/**
 * A link to one of the deal's files, valid for a minute (download) or five (opened
 * in the browser), for someone who may see the deal. Every link is audited.
 */
export async function getOpportunityAttachmentLink(
  actor: Actor,
  opportunityId: string,
  attachmentId: string,
): Promise<string> {
  const deal = await visibleOpportunity(actor, opportunityId);
  if (!isUuid(attachmentId)) throw new NotFoundError("attachment");
  const file = await prisma.crmOpportunityAttachment.findFirst({
    where: { id: attachmentId, opportunityId: deal.id, status: "READY", deletedAt: null },
    select: { storageKey: true, fileName: true },
  });
  if (file === null) throw new NotFoundError("attachment");
  if (!isStorageConfigured()) throw new BusinessRuleError(NOT_CONFIGURED);

  const preview = (ruleFor(file.fileName)?.preview ?? null) !== null;
  const url = await createDownloadUrl(file.storageKey, {
    downloadAs: preview ? null : file.fileName,
    expiresInSeconds: preview ? PREVIEW_LINK_SECONDS : DOWNLOAD_LINK_SECONDS,
  });
  await recordAudit({
    ...auditFields(actor),
    action: "crm.opportunity.attachment_opened",
    module: CRM_MODULE,
    entityType: "CrmOpportunity",
    entityId: deal.id,
    summary: `Opened “${file.fileName}” on ${deal.name}`,
  });
  return url;
}

/**
 * Removes a file from the deal. It stays on record, and in storage, for the audit
 * trail; the deal no longer lists it and its link stops working.
 */
export async function removeOpportunityAttachment(
  actor: Actor,
  opportunityId: string,
  attachmentId: string,
): Promise<void> {
  const deal = await visibleOpportunity(actor, opportunityId);
  if (!isUuid(attachmentId)) throw new NotFoundError("attachment");
  const file = await prisma.crmOpportunityAttachment.findFirst({
    where: { id: attachmentId, opportunityId: deal.id, status: "READY", deletedAt: null },
    select: { fileName: true, uploadedBy: true },
  });
  if (file === null) throw new NotFoundError("attachment");

  const [canUpdate, canDelete] = await Promise.all([
    can(actor, CRM_PERMISSIONS.OPPORTUNITY_UPDATE, deal.target),
    can(actor, CRM_PERMISSIONS.OPPORTUNITY_DELETE, deal.target),
  ]);
  if (!canDelete && !(canUpdate && file.uploadedBy === actor.id)) {
    throw new ForbiddenError(
      "Only the person who attached this file, or an administrator, can remove it.",
    );
  }

  await prisma.$transaction(async (tx) => {
    const removed = await tx.crmOpportunityAttachment.updateMany({
      where: { id: attachmentId, deletedAt: null },
      data: { deletedAt: new Date(), deletedBy: actor.id },
    });
    if (removed.count !== 1) throw new NotFoundError("attachment");
    await recordAudit(
      {
        ...auditFields(actor),
        action: "crm.opportunity.attachment_removed",
        module: CRM_MODULE,
        entityType: "CrmOpportunity",
        entityId: deal.id,
        summary: `Removed “${file.fileName}” from ${deal.name}`,
        severity: "WARNING",
      },
      tx,
    );
    await publish(tx, {
      name: CRM_EVENTS.OPPORTUNITY_ATTACHMENT_REMOVED,
      actorId: actor.id,
      correlationId: actor.correlationId ?? null,
      payload: { opportunityId: deal.id, attachmentId },
    });
  });
}
