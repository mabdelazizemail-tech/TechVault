import type { Prisma } from "@prisma/client";
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/platform/audit/audit";
import {
  type Actor,
  canGlobally,
  requireGlobalPermission,
  requirePermission,
} from "@/platform/authz/authz";
import { publish } from "@/platform/events/publish";
import { findDirectoryPeople } from "@/platform/iam/services/directory-service";
import { notify } from "@/platform/notifications/notifications";
import {
  createDownloadUrl,
  createUploadUrl,
  isStorageConfigured,
  readObjectStart,
} from "@/platform/storage/storage";
import { COMMITTEES_EVENTS, COMMITTEES_NOTIFICATIONS } from "../contracts/events";
import { COMMITTEES_PERMISSIONS } from "../contracts/permissions";
import {
  expenseListParamsSchema,
  expenseReviewSchema,
  expenseSchema,
  receiptUploadSchema,
} from "../contracts/schemas";
import {
  PAGE_SIZE,
  type ExpenseDetail,
  type ExpenseListItem,
  type ExpenseTotal,
  type Paginated,
  type PersonRef,
} from "../contracts/types";
import { addDays, dateFromIso, isoDateOf, todayInCairo } from "../domain/dates";
import {
  EXPENSE_CATEGORY_LABELS,
  MAX_RECEIPT_BYTES,
  RECEIPT_SNIFF_BYTES,
  cleanReceiptName,
  formatExpenseAmount,
  receiptContentType,
  receiptMatchesContent,
} from "../domain/expenses";
import {
  COMMITTEES_MODULE,
  assertId,
  auditFields,
  parseInput,
  personSelect,
  toPerson,
} from "./support";

/**
 * Mission expenses (ADR-037): a person claims what they paid on a mission, with a
 * picture of the receipt; an approver approves or rejects it.
 *
 * - Everyone with `committees.expense.read` sees their own claims; holders of
 *   `committees.expense.approve` (organisation-wide) see everyone's. Anything else
 *   is "not found".
 * - The receipt goes from the phone straight to private storage through a one-time
 *   link (`prepareReceiptUpload`); before the claim is saved the server checks the
 *   stored bytes really are the picture declared (`verifyReceipt`).
 * - A claim never changes after it is submitted, and nobody reviews their own — the
 *   database refuses both whatever the code does.
 */

const NOT_CONFIGURED =
  "Receipt pictures cannot be stored yet: this server has no storage key configured.";
const PENDING_LIFETIME_MS = 24 * 60 * 60 * 1000;
const RECEIPT_LINK_SECONDS = 300;

/* -------------------------------------------------------------------------- */
/* Who is looking                                                             */
/* -------------------------------------------------------------------------- */

type ExpenseViewer = { actor: Actor; isApprover: boolean };

async function expenseViewer(actor: Actor): Promise<ExpenseViewer> {
  await requirePermission(actor, COMMITTEES_PERMISSIONS.EXPENSE_READ);
  return {
    actor,
    isApprover: await canGlobally(actor, COMMITTEES_PERMISSIONS.EXPENSE_APPROVE),
  };
}

/** Own claims, or every claim for an approver — the one rule behind every read. */
function visibleWhere(viewer: ExpenseViewer): Prisma.CommitteeMissionExpenseWhereInput {
  return viewer.isApprover ? {} : { submittedBy: viewer.actor.id };
}

export function isReceiptStorageAvailable(): boolean {
  return isStorageConfigured();
}

/* -------------------------------------------------------------------------- */
/* Receipt upload                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Authorises a receipt upload: chooses a random storage key, records the receipt as
 * PENDING and returns a one-time link the browser sends the picture to.
 */
export async function prepareReceiptUpload(
  actor: Actor,
  rawInput: unknown,
): Promise<{ receiptId: string; uploadUrl: string; contentType: string }> {
  await requirePermission(actor, COMMITTEES_PERMISSIONS.EXPENSE_CREATE);
  if (!isStorageConfigured()) throw new BusinessRuleError(NOT_CONFIGURED);
  const input = parseInput(receiptUploadSchema, rawInput);
  const fileName = cleanReceiptName(input.fileName);
  const contentType = receiptContentType(fileName);
  if (fileName === "" || contentType === null) {
    throw new ValidationError("Use a JPG or PNG picture.", {
      receipt: ["Use a JPG, JPEG or PNG picture of the invoice or receipt."],
    });
  }
  if (input.sizeBytes > MAX_RECEIPT_BYTES) {
    throw new ValidationError("This picture is too large.", {
      receipt: ["Pictures are limited to 10 MB."],
    });
  }

  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const random = crypto.randomUUID().replaceAll("-", "");
  const extension = contentType === "image/png" ? "png" : "jpg";
  const storageKey = `committees/receipts/${now.getUTCFullYear()}/${month}/${random}.${extension}`;

  const receipt = await prisma.committeeExpenseReceipt.create({
    data: {
      storageKey,
      fileName,
      contentType,
      sizeBytes: input.sizeBytes,
      uploadedBy: actor.id,
    },
    select: { id: true },
  });
  const { url } = await createUploadUrl(storageKey);
  return { receiptId: receipt.id, uploadUrl: url, contentType };
}

/** Checks the uploaded picture before the claim is saved. Reads storage, so it runs outside the transaction. */
async function verifyReceipt(actor: Actor, receiptId: string): Promise<void> {
  const invalid = (message: string) =>
    new ValidationError(message, { receipt: [message] });
  const receipt = await prisma.committeeExpenseReceipt.findUnique({
    where: { id: receiptId },
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
    receipt === null ||
    receipt.uploadedBy !== actor.id ||
    receipt.status !== "PENDING" ||
    Date.now() - receipt.createdAt.getTime() > PENDING_LIFETIME_MS
  ) {
    throw invalid("The receipt picture could not be found. Please attach it again.");
  }
  if (!isStorageConfigured()) throw new BusinessRuleError(NOT_CONFIGURED);
  const stored = await readObjectStart(receipt.storageKey, RECEIPT_SNIFF_BYTES);
  if (stored === null) {
    throw invalid("The receipt picture did not finish uploading. Please try again.");
  }
  if (stored.size !== receipt.sizeBytes || stored.size > MAX_RECEIPT_BYTES) {
    throw invalid(
      "The uploaded picture does not match the one selected. Please try again.",
    );
  }
  if (!receiptMatchesContent(receipt.fileName, stored.head)) {
    throw invalid("This file is not a JPG or PNG picture, so it was not accepted.");
  }
}

/* -------------------------------------------------------------------------- */
/* Submitting                                                                 */
/* -------------------------------------------------------------------------- */

export async function submitExpense(
  actor: Actor,
  rawInput: unknown,
): Promise<{ id: string }> {
  await requirePermission(actor, COMMITTEES_PERMISSIONS.EXPENSE_CREATE);
  const input = parseInput(expenseSchema, rawInput);

  const mission = await prisma.committeeMission.findFirst({
    where: { id: input.missionId, isActive: true },
    select: { id: true, name: true },
  });
  if (mission === null) {
    throw new ValidationError("Choose an active mission.", {
      missionId: ["Choose an active mission."],
    });
  }
  // A day's grace covers a claim entered abroad, a time zone ahead of Cairo.
  if (input.expenseDate > addDays(todayInCairo(), 1)) {
    throw new ValidationError("The expense date cannot be in the future.", {
      expenseDate: ["The expense date cannot be in the future."],
    });
  }
  await verifyReceipt(actor, input.receiptId);

  return prisma.$transaction(async (tx) => {
    // Claims the verified picture for this claim only; a second use finds nothing.
    const claimed = await tx.committeeExpenseReceipt.updateMany({
      where: { id: input.receiptId, uploadedBy: actor.id, status: "PENDING" },
      data: { status: "READY" },
    });
    if (claimed.count !== 1) {
      throw new ValidationError(
        "The receipt picture could not be used. Please attach it again.",
        {
          receipt: ["The receipt picture could not be used. Please attach it again."],
        },
      );
    }
    const expense = await tx.committeeMissionExpense.create({
      data: {
        missionId: mission.id,
        submittedBy: actor.id,
        category: input.category,
        description: input.description,
        expenseDate: dateFromIso(input.expenseDate),
        amountMinor: input.amount,
        currency: input.currency,
        receiptId: input.receiptId,
      },
      select: { id: true },
    });
    await recordAudit(
      {
        ...auditFields(actor),
        action: "committees.expense.submitted",
        module: COMMITTEES_MODULE,
        entityType: "CommitteeMissionExpense",
        entityId: expense.id,
        summary: `Claimed ${EXPENSE_CATEGORY_LABELS[input.category]} ${formatExpenseAmount(input.amount, input.currency)} on ${mission.name}`,
      },
      tx,
    );
    await publish(tx, {
      name: COMMITTEES_EVENTS.MISSION_EXPENSE_SUBMITTED,
      actorId: actor.id,
      correlationId: actor.correlationId ?? null,
      payload: {
        expenseId: expense.id,
        missionId: mission.id,
        currency: input.currency,
        amountMinor: input.amount,
      },
    });
    return expense;
  });
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

const listSelect = {
  id: true,
  category: true,
  description: true,
  expenseDate: true,
  amountMinor: true,
  currency: true,
  status: true,
  createdAt: true,
  reviewedAt: true,
  mission: { select: { id: true, name: true } },
  submitter: { select: personSelect },
  reviewer: { select: personSelect },
} satisfies Prisma.CommitteeMissionExpenseSelect;

type ListRow = Prisma.CommitteeMissionExpenseGetPayload<{ select: typeof listSelect }>;

function toListItem(row: ListRow): ExpenseListItem {
  return {
    id: row.id,
    mission: row.mission,
    submitter: toPerson(row.submitter),
    category: row.category,
    description: row.description,
    expenseDate: isoDateOf(row.expenseDate),
    amountMinor: row.amountMinor,
    currency: row.currency,
    status: row.status,
    submittedAt: row.createdAt,
    reviewer: row.reviewer === null ? null : toPerson(row.reviewer),
    reviewedAt: row.reviewedAt,
  };
}

function listWhere(
  viewer: ExpenseViewer,
  params: ReturnType<typeof expenseListParamsSchema.parse>,
): Prisma.CommitteeMissionExpenseWhereInput {
  return {
    AND: [
      visibleWhere(viewer),
      params.mission !== undefined ? { missionId: params.mission } : {},
      // Only an approver sees other people's claims to filter by.
      viewer.isApprover && params.user !== undefined ? { submittedBy: params.user } : {},
      params.category !== undefined ? { category: params.category } : {},
      params.status !== undefined ? { status: params.status } : {},
      params.from !== undefined ? { expenseDate: { gte: dateFromIso(params.from) } } : {},
      params.to !== undefined ? { expenseDate: { lte: dateFromIso(params.to) } } : {},
    ],
  };
}

export async function listExpenses(
  actor: Actor,
  rawParams: Record<string, unknown> = {},
): Promise<Paginated<ExpenseListItem> & { isApprover: boolean }> {
  const viewer = await expenseViewer(actor);
  const params = expenseListParamsSchema.parse(rawParams);
  const where = listWhere(viewer, params);
  const [total, rows] = await Promise.all([
    prisma.committeeMissionExpense.count({ where }),
    prisma.committeeMissionExpense.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (params.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: listSelect,
    }),
  ]);
  return {
    rows: rows.map(toListItem),
    total,
    page: params.page,
    pageSize: PAGE_SIZE,
    isApprover: viewer.isApprover,
  };
}

/**
 * Totals for the same filters as the list, one row per currency: amounts in
 * different currencies are never added together. Rejected claims are left out.
 */
export async function getExpenseTotals(
  actor: Actor,
  rawParams: Record<string, unknown> = {},
): Promise<ExpenseTotal[]> {
  const viewer = await expenseViewer(actor);
  const params = expenseListParamsSchema.parse(rawParams);
  const groups = await prisma.committeeMissionExpense.groupBy({
    by: ["currency", "status"],
    where: { AND: [listWhere(viewer, params), { status: { not: "REJECTED" } }] },
    _sum: { amountMinor: true },
    _count: { _all: true },
  });

  const totals = new Map<string, ExpenseTotal>();
  for (const group of groups) {
    const total = totals.get(group.currency) ?? {
      currency: group.currency,
      claimedMinor: 0,
      approvedMinor: 0,
      count: 0,
    };
    const amount = group._sum.amountMinor ?? 0;
    total.claimedMinor += amount;
    total.count += group._count._all;
    if (group.status === "APPROVED") total.approvedMinor += amount;
    totals.set(group.currency, total);
  }
  return [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

/** The people who have claimed expenses, for an approver's filter. Empty for anyone else. */
export async function listExpenseSubmitters(actor: Actor): Promise<PersonRef[]> {
  const viewer = await expenseViewer(actor);
  if (!viewer.isApprover) return [];
  const groups = await prisma.committeeMissionExpense.groupBy({
    by: ["submittedBy"],
    orderBy: { submittedBy: "asc" },
    take: 300,
  });
  const people = await findDirectoryPeople(
    actor,
    groups.map((group) => group.submittedBy),
  );
  return people
    .map((person) => ({ id: person.id, name: person.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getExpense(
  actor: Actor,
  expenseId: string,
): Promise<ExpenseDetail> {
  const viewer = await expenseViewer(actor);
  assertId(expenseId, "expense");
  const row = await prisma.committeeMissionExpense.findFirst({
    where: { id: expenseId, ...visibleWhere(viewer) },
    select: {
      ...listSelect,
      submittedBy: true,
      reviewNote: true,
      receipt: { select: { fileName: true, contentType: true, sizeBytes: true } },
    },
  });
  if (row === null) throw new NotFoundError("expense");
  return {
    ...toListItem(row),
    reviewNote: row.reviewNote,
    receipt: row.receipt,
    canReview:
      viewer.isApprover && row.status === "SUBMITTED" && row.submittedBy !== actor.id,
  };
}

/* -------------------------------------------------------------------------- */
/* Reviewing                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Approves or rejects a submitted claim, recording who did it and when. Never one's
 * own claim, and only once: a claim someone reviewed a moment earlier is a conflict.
 * The submitter is notified.
 */
export async function reviewExpense(
  actor: Actor,
  expenseId: string,
  rawInput: unknown,
): Promise<void> {
  await requireGlobalPermission(actor, COMMITTEES_PERMISSIONS.EXPENSE_APPROVE);
  assertId(expenseId, "expense");
  const expense = await prisma.committeeMissionExpense.findUnique({
    where: { id: expenseId },
    select: {
      submittedBy: true,
      status: true,
      category: true,
      amountMinor: true,
      currency: true,
      mission: { select: { name: true } },
    },
  });
  if (expense === null) throw new NotFoundError("expense");
  if (expense.submittedBy === actor.id) {
    throw new ForbiddenError("You can't approve or reject your own expense.");
  }
  const input = parseInput(expenseReviewSchema, rawInput);
  if (expense.status !== "SUBMITTED") {
    throw new ConflictError("This expense has already been reviewed.");
  }
  const [reviewer] = await findDirectoryPeople(actor, [actor.id]);
  const approved = input.decision === "APPROVED";
  const what = `${EXPENSE_CATEGORY_LABELS[expense.category]} ${formatExpenseAmount(expense.amountMinor, expense.currency)} on ${expense.mission.name}`;

  await prisma.$transaction(async (tx) => {
    // Conditional, so two approvers acting at once cannot both review it.
    const reviewed = await tx.committeeMissionExpense.updateMany({
      where: { id: expenseId, status: "SUBMITTED" },
      data: {
        status: input.decision,
        reviewedBy: actor.id,
        reviewedAt: new Date(),
        reviewNote: input.note,
      },
    });
    if (reviewed.count !== 1) {
      throw new ConflictError("This expense has already been reviewed.");
    }
    await recordAudit(
      {
        ...auditFields(actor),
        action: approved ? "committees.expense.approved" : "committees.expense.rejected",
        module: COMMITTEES_MODULE,
        entityType: "CommitteeMissionExpense",
        entityId: expenseId,
        summary: `${approved ? "Approved" : "Rejected"} ${what}`,
        changes: { status: { from: "SUBMITTED", to: input.decision } },
      },
      tx,
    );
    await publish(tx, {
      name: COMMITTEES_EVENTS.MISSION_EXPENSE_REVIEWED,
      actorId: actor.id,
      correlationId: actor.correlationId ?? null,
      payload: { expenseId, status: input.decision },
    });
    await notify(tx, {
      type: COMMITTEES_NOTIFICATIONS.EXPENSE_REVIEWED,
      module: COMMITTEES_MODULE,
      entityType: "CommitteeMissionExpense",
      entityId: expenseId,
      sourceId: expenseId,
      actorId: actor.id,
      recipientIds: [expense.submittedBy],
      title: `${reviewer?.name ?? "An approver"} ${approved ? "approved" : "rejected"} your expense`,
      body: input.note === null ? what : `${what} — “${input.note}”`,
      link: `/committees/expenses/${expenseId}`,
    });
  });
}

/**
 * A link to a claim's receipt picture, valid for five minutes, for someone who may
 * see the claim. Every view is audited.
 */
export async function getReceiptLink(actor: Actor, expenseId: string): Promise<string> {
  const viewer = await expenseViewer(actor);
  assertId(expenseId, "expense");
  const row = await prisma.committeeMissionExpense.findFirst({
    where: { id: expenseId, ...visibleWhere(viewer) },
    select: { receipt: { select: { storageKey: true, status: true } } },
  });
  if (row === null || row.receipt.status !== "READY") throw new NotFoundError("receipt");
  if (!isStorageConfigured()) throw new BusinessRuleError(NOT_CONFIGURED);

  const url = await createDownloadUrl(row.receipt.storageKey, {
    downloadAs: null,
    expiresInSeconds: RECEIPT_LINK_SECONDS,
  });
  await recordAudit({
    ...auditFields(actor),
    action: "committees.expense.receipt_viewed",
    module: COMMITTEES_MODULE,
    entityType: "CommitteeMissionExpense",
    entityId: expenseId,
    summary: "Viewed an expense receipt",
  });
  return url;
}
