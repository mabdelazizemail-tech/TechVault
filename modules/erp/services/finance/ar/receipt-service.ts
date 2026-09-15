import type { Prisma } from "@prisma/client";
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/platform/audit/audit";
import { type Actor, requireGlobalPermission } from "@/platform/authz/authz";
import { publish } from "@/platform/events/publish";
import {
  ERP_EVENTS,
  type ArReceiptAllocationPayload,
  type ArReceiptCancelledPayload,
  type ArReceiptPostedPayload,
} from "../../../contracts/events";
import { ERP_PERMISSIONS } from "../../../contracts/permissions";
import {
  arAllocationSchema,
  arCancelSchema,
  arListParamsSchema,
  arReceiptDraftSchema,
  arUnallocateSchema,
} from "../../../contracts/schemas";
import {
  AR_RECEIPT_STATUSES,
  type ArReceiptDetail,
  type ArReceiptListItem,
  type Paginated,
} from "../../../contracts/types";
import { formatMinorAmount } from "../../../domain/journal";
import { arReceiptListSelect } from "../../../repositories/ar-selects";
import { accountRefSelect, personSelect } from "../../../repositories/selects";
import { recordPostedJournal, reverseJournalInTransaction } from "../ledger";
import { nextDocumentNumber } from "../numbering";
import {
  ERP_MODULE,
  asFinanceError,
  assertId,
  auditFields,
  dateFromIso,
  isUniqueViolation,
  isoDateOf,
  parseInput,
  todayIso,
  toAmount,
  toPerson,
} from "../support";
import {
  AR_POSTING_TRANSACTION,
  customerIdsMatching,
  customerRefs,
  loadArSettings,
  lockReceipt,
  requireAccount,
  requireLiveCustomer,
  resolveReceivableAccount,
  toReceiptListItem,
} from "./support";

/**
 * Customer receipts and their allocation to invoices (ADR-023).
 *
 * Posting a receipt books Dr bank or cash / Cr receivable through the ledger engine.
 * Allocating it matches that money to invoices of the same customer: no journal,
 * because receivables were already credited. Allocations are applied and bounded by
 * a database trigger under row locks, so neither the receipt nor any invoice can be
 * over-allocated, however many people work at once.
 */

const PAGE_SIZE = 25;
const SOURCE_TYPE = "ar_receipt";

async function prepareDraft(input: unknown) {
  const draft = parseInput(arReceiptDraftSchema, input);
  await requireLiveCustomer(draft.crmAccountId);

  const method = await prisma.erpPaymentMethod.findUnique({
    where: { id: draft.paymentMethodId },
    select: { code: true, isActive: true },
  });
  if (method === null || !method.isActive) {
    throw new ValidationError("Please correct the highlighted fields.", {
      paymentMethodId: [
        method === null
          ? "Choose a valid payment method."
          : `Payment method ${method.code} is inactive.`,
      ],
    });
  }
  await requireAccount(draft.depositAccountId, ["ASSET"], "depositAccountId");

  const settings = await loadArSettings();
  const { receivableAccountId } = await resolveReceivableAccount(
    draft.crmAccountId,
    settings,
  );
  if (receivableAccountId === draft.depositAccountId) {
    throw new ValidationError("Please correct the highlighted fields.", {
      depositAccountId: ["Choose a bank or cash account, not the receivable account."],
    });
  }
  return { draft, receivableAccountId };
}

/* Reads --------------------------------------------------------------------------- */

export async function listReceipts(
  actor: Actor,
  rawParams: Record<string, unknown> = {},
): Promise<Paginated<ArReceiptListItem>> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AR_RECEIPT_READ);
  const params = arListParamsSchema.parse(rawParams);
  const status = AR_RECEIPT_STATUSES.find((value) => value === params.status);
  const matchingCustomers = await customerIdsMatching(params.q);

  const where: Prisma.ErpArReceiptWhereInput = {
    ...(status !== undefined ? { status } : {}),
    ...(params.customer !== undefined ? { crmAccountId: params.customer } : {}),
    ...(params.from !== undefined || params.to !== undefined
      ? {
          receiptDate: {
            ...(params.from !== undefined ? { gte: dateFromIso(params.from) } : {}),
            ...(params.to !== undefined ? { lte: dateFromIso(params.to) } : {}),
          },
        }
      : {}),
    ...(params.q !== undefined && params.q !== ""
      ? {
          OR: [
            { receiptNumber: { contains: params.q, mode: "insensitive" } },
            { reference: { contains: params.q, mode: "insensitive" } },
            ...(matchingCustomers !== null && matchingCustomers.length > 0
              ? [{ crmAccountId: { in: matchingCustomers } }]
              : []),
          ],
        }
      : {}),
  };
  const orderBy: Prisma.ErpArReceiptOrderByWithRelationInput[] =
    params.sort === "number"
      ? [{ receiptNumber: params.dir }]
      : params.sort === "amount"
        ? [{ amountMinor: params.dir }, { createdAt: "desc" }]
        : [{ receiptDate: params.dir }, { createdAt: "desc" }];

  const [total, rows] = await Promise.all([
    prisma.erpArReceipt.count({ where }),
    prisma.erpArReceipt.findMany({
      where,
      orderBy,
      skip: (params.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: arReceiptListSelect,
    }),
  ]);
  const customers = await customerRefs(rows.map((row) => row.crmAccountId));

  return {
    rows: rows.map((row) => toReceiptListItem(row, customers)),
    total,
    page: params.page,
    pageSize: PAGE_SIZE,
  };
}

export async function getReceipt(
  actor: Actor,
  receiptId: string,
): Promise<ArReceiptDetail> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AR_RECEIPT_READ);
  assertId(receiptId, "receipt");

  const row = await prisma.erpArReceipt.findUnique({
    where: { id: receiptId },
    select: {
      ...arReceiptListSelect,
      currency: true,
      reference: true,
      notes: true,
      postedAt: true,
      cancelledAt: true,
      cancelReason: true,
      createdAt: true,
      updatedAt: true,
      poster: { select: personSelect },
      depositAccount: { select: accountRefSelect },
      receivableAccount: { select: accountRefSelect },
      period: { select: { id: true, name: true, status: true } },
      journalEntry: { select: { id: true, journalNumber: true } },
      voidJournalEntry: { select: { id: true, journalNumber: true } },
      allocations: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          amountMinor: true,
          createdAt: true,
          invoice: {
            select: { id: true, invoiceNumber: true, invoiceDate: true, dueDate: true },
          },
        },
      },
    },
  });
  if (row === null) throw new NotFoundError("receipt");
  const customers = await customerRefs([row.crmAccountId]);

  return {
    ...toReceiptListItem(row, customers),
    currency: row.currency,
    reference: row.reference,
    notes: row.notes,
    depositAccount: row.depositAccount,
    receivableAccount: row.receivableAccount,
    period: row.period,
    journal: row.journalEntry,
    voidJournal: row.voidJournalEntry,
    allocations: row.allocations.map((allocation) => ({
      id: allocation.id,
      receiptId: row.id,
      receiptNumber: row.receiptNumber,
      receiptDate: isoDateOf(row.receiptDate),
      invoiceId: allocation.invoice.id,
      invoiceNumber: allocation.invoice.invoiceNumber,
      invoiceDate: isoDateOf(allocation.invoice.invoiceDate),
      dueDate: isoDateOf(allocation.invoice.dueDate),
      amountMinor: toAmount(allocation.amountMinor),
      allocatedAt: allocation.createdAt,
    })),
    postedAt: row.postedAt,
    postedBy: toPerson(row.poster),
    cancelledAt: row.cancelledAt,
    cancelReason: row.cancelReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/* Drafts ----------------------------------------------------------------------------- */

export async function createReceipt(
  actor: Actor,
  input: unknown,
): Promise<{ id: string }> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AR_RECEIPT_CREATE);
  const { draft, receivableAccountId } = await prepareDraft(input);

  try {
    return await prisma.$transaction(async (tx) => {
      const receipt = await tx.erpArReceipt.create({
        data: {
          crmAccountId: draft.crmAccountId,
          receiptDate: dateFromIso(draft.receiptDate),
          amountMinor: draft.amount,
          paymentMethodId: draft.paymentMethodId,
          depositAccountId: draft.depositAccountId,
          receivableAccountId,
          reference: draft.reference,
          notes: draft.notes,
          createdBy: actor.id,
          updatedBy: actor.id,
        },
        select: { id: true },
      });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.ar_receipt.created",
          module: ERP_MODULE,
          entityType: "ar_receipt",
          entityId: receipt.id,
          summary: `Recorded a draft receipt dated ${draft.receiptDate}`,
          changes: { crmAccountId: draft.crmAccountId, receiptDate: draft.receiptDate },
        },
        tx,
      );
      return receipt;
    });
  } catch (error) {
    throw asFinanceError(error);
  }
}

export async function updateReceipt(
  actor: Actor,
  receiptId: string,
  input: unknown,
): Promise<{ id: string }> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AR_RECEIPT_UPDATE);
  assertId(receiptId, "receipt");
  const { draft, receivableAccountId } = await prepareDraft(input);

  try {
    await prisma.$transaction(async (tx) => {
      const receipt = await lockReceipt(tx, receiptId);
      if (receipt.status !== "DRAFT") {
        throw new BusinessRuleError("Only a draft receipt can be edited.");
      }
      await tx.erpArReceipt.update({
        where: { id: receiptId },
        data: {
          crmAccountId: draft.crmAccountId,
          receiptDate: dateFromIso(draft.receiptDate),
          amountMinor: draft.amount,
          paymentMethodId: draft.paymentMethodId,
          depositAccountId: draft.depositAccountId,
          receivableAccountId,
          reference: draft.reference,
          notes: draft.notes,
          updatedBy: actor.id,
        },
      });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.ar_receipt.updated",
          module: ERP_MODULE,
          entityType: "ar_receipt",
          entityId: receiptId,
          summary: `Updated a draft receipt dated ${draft.receiptDate}`,
          changes: { crmAccountId: draft.crmAccountId, receiptDate: draft.receiptDate },
        },
        tx,
      );
    });
  } catch (error) {
    throw asFinanceError(error);
  }
  return { id: receiptId };
}

export async function deleteReceipt(actor: Actor, receiptId: string): Promise<void> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AR_RECEIPT_UPDATE);
  assertId(receiptId, "receipt");
  try {
    await prisma.$transaction(async (tx) => {
      const receipt = await lockReceipt(tx, receiptId);
      if (receipt.status !== "DRAFT") {
        throw new BusinessRuleError(
          "Only a draft receipt can be deleted. Cancel it instead.",
        );
      }
      await tx.erpArReceipt.delete({ where: { id: receiptId } });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.ar_receipt.deleted",
          module: ERP_MODULE,
          entityType: "ar_receipt",
          entityId: receiptId,
          summary: `Deleted a draft receipt dated ${receipt.receiptDate}`,
        },
        tx,
      );
    });
  } catch (error) {
    throw asFinanceError(error);
  }
}

/* Posting -------------------------------------------------------------------------------- */

export async function postReceipt(
  actor: Actor,
  receiptId: string,
): Promise<{ receiptNumber: string; journalNumber: string }> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AR_RECEIPT_POST);
  assertId(receiptId, "receipt");

  try {
    return await prisma.$transaction(async (tx) => {
      const locked = await lockReceipt(tx, receiptId);
      if (locked.status !== "DRAFT") {
        throw new BusinessRuleError(
          locked.status === "POSTED"
            ? "This receipt is already posted."
            : "This receipt has been cancelled.",
        );
      }
      const customers = await customerRefs([locked.crmAccountId]);
      if (customers.get(locked.crmAccountId)?.existsInCrm !== true) {
        throw new BusinessRuleError("The customer no longer exists in CRM.");
      }

      const receipt = await tx.erpArReceipt.findUniqueOrThrow({
        where: { id: receiptId },
        select: { amountMinor: true, depositAccountId: true, receivableAccountId: true },
      });
      const receiptNumber = await nextDocumentNumber(
        tx,
        "AR_RECEIPT",
        locked.receiptDate,
      );
      const journal = await recordPostedJournal(tx, actor, {
        entryDate: locked.receiptDate,
        description: `Customer receipt ${receiptNumber}`,
        reference: receiptNumber,
        source: { module: ERP_MODULE, type: SOURCE_TYPE, id: receiptId },
        lines: [
          {
            accountId: receipt.depositAccountId,
            costCentreId: null,
            description: `Receipt ${receiptNumber}`,
            debitMinor: receipt.amountMinor,
            creditMinor: 0n,
          },
          {
            accountId: receipt.receivableAccountId,
            costCentreId: null,
            description: `Receipt ${receiptNumber}`,
            debitMinor: 0n,
            creditMinor: receipt.amountMinor,
          },
        ],
      });

      await tx.erpArReceipt.update({
        where: { id: receiptId },
        data: {
          status: "POSTED",
          receiptNumber,
          journalEntryId: journal.id,
          fiscalPeriodId: journal.fiscalPeriodId,
          postedAt: new Date(),
          postedBy: actor.id,
          updatedBy: actor.id,
        },
      });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.ar_receipt.posted",
          module: ERP_MODULE,
          entityType: "ar_receipt",
          entityId: receiptId,
          summary: `Posted receipt ${receiptNumber} as journal entry ${journal.journalNumber}`,
          changes: {
            receiptNumber,
            journalEntryId: journal.id,
            journalNumber: journal.journalNumber,
            fiscalPeriodId: journal.fiscalPeriodId,
          },
          severity: "NOTICE",
        },
        tx,
      );
      await publish(tx, {
        name: ERP_EVENTS.AR_RECEIPT_POSTED,
        actorId: actor.id,
        correlationId: actor.correlationId ?? null,
        payload: {
          receiptId,
          receiptNumber,
          crmAccountId: locked.crmAccountId,
          receiptDate: locked.receiptDate,
          journalEntryId: journal.id,
        } satisfies ArReceiptPostedPayload,
      });
      return { receiptNumber, journalNumber: journal.journalNumber };
    }, AR_POSTING_TRANSACTION);
  } catch (error) {
    throw asFinanceError(error);
  }
}

/**
 * Cancels a receipt: a draft is simply cancelled; a posted, unallocated receipt is
 * voided by reversing its journal entry. An allocated receipt is refused.
 */
export async function cancelReceipt(
  actor: Actor,
  receiptId: string,
  input: unknown,
): Promise<{ voidJournalNumber: string | null }> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AR_RECEIPT_CANCEL);
  assertId(receiptId, "receipt");
  const data = parseInput(arCancelSchema, input);

  try {
    return await prisma.$transaction(async (tx) => {
      const receipt = await lockReceipt(tx, receiptId);
      if (receipt.status === "CANCELLED") {
        throw new BusinessRuleError("This receipt is already cancelled.");
      }
      if (receipt.allocatedMinor > 0n) {
        throw new BusinessRuleError(
          "Remove this receipt's allocations before voiding it.",
        );
      }

      let voidJournal: { id: string; journalNumber: string } | null = null;
      if (receipt.status === "POSTED" && receipt.journalEntryId !== null) {
        const reversal = await reverseJournalInTransaction(
          tx,
          actor,
          receipt.journalEntryId,
          {
            reversalDate: data.voidDate ?? todayIso(),
            description: `Void of receipt ${receipt.receiptNumber ?? ""}: ${data.reason}`,
          },
        );
        voidJournal = { id: reversal.reversalId, journalNumber: reversal.journalNumber };
      }

      await tx.erpArReceipt.update({
        where: { id: receiptId },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancelledBy: actor.id,
          cancelReason: data.reason,
          ...(voidJournal !== null ? { voidJournalEntryId: voidJournal.id } : {}),
          updatedBy: actor.id,
        },
      });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.ar_receipt.cancelled",
          module: ERP_MODULE,
          entityType: "ar_receipt",
          entityId: receiptId,
          summary:
            voidJournal === null
              ? "Cancelled a draft receipt"
              : `Voided receipt ${receipt.receiptNumber ?? ""} with journal entry ${voidJournal.journalNumber}`,
          changes: {
            reason: data.reason,
            voided: voidJournal !== null,
            ...(voidJournal !== null
              ? { voidJournalNumber: voidJournal.journalNumber }
              : {}),
          },
          severity: "NOTICE",
        },
        tx,
      );
      await publish(tx, {
        name: ERP_EVENTS.AR_RECEIPT_CANCELLED,
        actorId: actor.id,
        correlationId: actor.correlationId ?? null,
        payload: {
          receiptId,
          receiptNumber: receipt.receiptNumber,
          crmAccountId: receipt.crmAccountId,
          voidJournalEntryId: voidJournal?.id ?? null,
        } satisfies ArReceiptCancelledPayload,
      });
      return { voidJournalNumber: voidJournal?.journalNumber ?? null };
    }, AR_POSTING_TRANSACTION);
  } catch (error) {
    throw asFinanceError(error);
  }
}

/* Allocation ------------------------------------------------------------------------------- */

export async function allocateReceipt(
  actor: Actor,
  receiptId: string,
  input: unknown,
): Promise<void> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AR_RECEIPT_ALLOCATE);
  assertId(receiptId, "receipt");
  const data = parseInput(arAllocationSchema, input);
  // A fixed order, so two allocations touching the same invoices queue, not deadlock.
  const allocations = [...data.allocations].sort((a, b) =>
    a.invoiceId.localeCompare(b.invoiceId),
  );

  try {
    await prisma.$transaction(async (tx) => {
      const receipt = await lockReceipt(tx, receiptId);
      if (receipt.status !== "POSTED") {
        throw new BusinessRuleError("Post the receipt before allocating it.");
      }
      const requested = allocations.reduce(
        (sum, allocation) => sum + allocation.amount,
        0n,
      );
      const unallocated = receipt.amountMinor - receipt.allocatedMinor;
      if (requested > unallocated) {
        throw new BusinessRuleError(
          `The allocations total ${formatMinorAmount(requested)}, more than the ${formatMinorAmount(unallocated)} left on this receipt.`,
        );
      }

      const invoiceIds = allocations.map((allocation) => allocation.invoiceId);
      const [invoices, existing] = await Promise.all([
        tx.erpArInvoice.findMany({
          where: { id: { in: invoiceIds } },
          select: {
            id: true,
            invoiceNumber: true,
            crmAccountId: true,
            status: true,
            outstandingMinor: true,
          },
        }),
        tx.erpArReceiptAllocation.findMany({
          where: { receiptId, invoiceId: { in: invoiceIds } },
          select: { invoice: { select: { invoiceNumber: true } } },
        }),
      ]);
      const first = existing[0];
      if (first !== undefined) {
        throw new ConflictError(
          `This receipt is already allocated to invoice ${first.invoice.invoiceNumber ?? ""}. Remove that allocation to change it.`,
        );
      }
      const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
      for (const allocation of allocations) {
        const invoice = invoiceById.get(allocation.invoiceId);
        if (invoice === undefined) throw new NotFoundError("invoice");
        const label = invoice.invoiceNumber ?? "this invoice";
        if (invoice.crmAccountId !== receipt.crmAccountId) {
          throw new BusinessRuleError(`Invoice ${label} belongs to another customer.`);
        }
        if (invoice.status !== "POSTED" && invoice.status !== "PARTIALLY_PAID") {
          throw new BusinessRuleError(`Invoice ${label} is not open for payment.`);
        }
        if (allocation.amount > invoice.outstandingMinor) {
          throw new BusinessRuleError(
            `${formatMinorAmount(allocation.amount)} is more than the ${formatMinorAmount(invoice.outstandingMinor)} outstanding on invoice ${label}.`,
          );
        }
      }

      for (const allocation of allocations) {
        await tx.erpArReceiptAllocation.create({
          data: {
            receiptId,
            invoiceId: allocation.invoiceId,
            amountMinor: allocation.amount,
            createdBy: actor.id,
          },
        });
      }

      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.ar_receipt.allocated",
          module: ERP_MODULE,
          entityType: "ar_receipt",
          entityId: receiptId,
          summary: `Allocated receipt ${receipt.receiptNumber ?? ""} to ${allocations.length} invoice${allocations.length === 1 ? "" : "s"}`,
          changes: {
            allocations: allocations.map((allocation) => ({
              invoiceId: allocation.invoiceId,
              invoiceNumber: invoiceById.get(allocation.invoiceId)?.invoiceNumber ?? null,
              amountMinor: allocation.amount.toString(),
            })),
          },
        },
        tx,
      );
      await publish(tx, {
        name: ERP_EVENTS.AR_RECEIPT_ALLOCATED,
        actorId: actor.id,
        correlationId: actor.correlationId ?? null,
        payload: {
          receiptId,
          crmAccountId: receipt.crmAccountId,
          invoiceIds,
        } satisfies ArReceiptAllocationPayload,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError(
        "This receipt is already allocated to one of these invoices. Refresh and try again.",
      );
    }
    throw asFinanceError(error);
  }
}

export async function unallocateReceipt(
  actor: Actor,
  receiptId: string,
  input: unknown,
): Promise<void> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AR_RECEIPT_ALLOCATE);
  assertId(receiptId, "receipt");
  const { invoiceId } = parseInput(arUnallocateSchema, input);

  try {
    await prisma.$transaction(async (tx) => {
      const receipt = await lockReceipt(tx, receiptId);
      const allocation = await tx.erpArReceiptAllocation.findUnique({
        where: { receiptId_invoiceId: { receiptId, invoiceId } },
        select: {
          id: true,
          amountMinor: true,
          invoice: { select: { invoiceNumber: true } },
        },
      });
      if (allocation === null) throw new NotFoundError("allocation");

      await tx.erpArReceiptAllocation.delete({ where: { id: allocation.id } });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.ar_receipt.unallocated",
          module: ERP_MODULE,
          entityType: "ar_receipt",
          entityId: receiptId,
          summary: `Removed the allocation of receipt ${receipt.receiptNumber ?? ""} from invoice ${allocation.invoice.invoiceNumber ?? ""}`,
          changes: { invoiceId, amountMinor: allocation.amountMinor.toString() },
          severity: "NOTICE",
        },
        tx,
      );
      await publish(tx, {
        name: ERP_EVENTS.AR_RECEIPT_UNALLOCATED,
        actorId: actor.id,
        correlationId: actor.correlationId ?? null,
        payload: {
          receiptId,
          crmAccountId: receipt.crmAccountId,
          invoiceIds: [invoiceId],
        } satisfies ArReceiptAllocationPayload,
      });
    });
  } catch (error) {
    throw asFinanceError(error);
  }
}
