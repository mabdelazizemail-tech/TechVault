import type { Prisma } from "@prisma/client";
import { BusinessRuleError, NotFoundError } from "@/lib/errors";
import { type PrismaTransaction, prisma } from "@/lib/prisma";
import { recordAudit } from "@/platform/audit/audit";
import { type Actor, requireGlobalPermission } from "@/platform/authz/authz";
import { publish } from "@/platform/events/publish";
import {
  ERP_EVENTS,
  type ArCreditNoteApprovedPayload,
  type ArCreditNoteCancelledPayload,
  type ArCreditNotePostedPayload,
} from "../../../contracts/events";
import { ERP_PERMISSIONS } from "../../../contracts/permissions";
import {
  arCancelSchema,
  arCreditNoteDraftSchema,
  arListParamsSchema,
  arReasonSchema,
} from "../../../contracts/schemas";
import {
  AR_CREDIT_NOTE_STATUSES,
  type ArCreditNoteDetail,
  type ArCreditNoteListItem,
  type CreditableInvoice,
  type Paginated,
} from "../../../contracts/types";
import { approvalRequired, formatQuantity } from "../../../domain/ar";
import { arCreditNoteListSelect } from "../../../repositories/ar-selects";
import {
  accountRefSelect,
  costCentreRefSelect,
  personSelect,
} from "../../../repositories/selects";
import {
  recordPostedJournal,
  reverseJournalInTransaction,
  type LedgerLine,
} from "../ledger";
import { nextDocumentNumber } from "../numbering";
import {
  ERP_MODULE,
  asFinanceError,
  assertId,
  auditFields,
  dateFromIso,
  isoDateOf,
  parseInput,
  toAmount,
  toPerson,
  todayIso,
} from "../support";
import { priceDocumentLines } from "./invoice-service";
import {
  AR_POSTING_TRANSACTION,
  customerFrom,
  customerIdsMatching,
  customerRefs,
  loadArSettings,
  lockInvoice,
  POSTED_INVOICE_STATUSES,
} from "./support";

/**
 * Credit notes (ADR-029): a correction raised against ONE posted invoice, for at most
 * what that invoice still owes.
 *
 * DRAFT → PENDING_APPROVAL → APPROVED → POSTED, or CANCELLED. Approval follows the
 * same AR settings rule as invoices, because a credit note reduces revenue. Posting
 * books the mirror image of the invoice — Dr revenue, Dr tax, Cr receivable — through
 * the ledger engine, and the database reduces the invoice's outstanding amount. A
 * posted credit note is corrected only by voiding it, which reverses its entry and
 * restores the invoice.
 */

const PAGE_SIZE = 25;
const SOURCE_TYPE = "ar_credit_note";

/* Reads -------------------------------------------------------------------------- */

export async function listCreditNotes(
  actor: Actor,
  rawParams: Record<string, unknown> = {},
): Promise<Paginated<ArCreditNoteListItem>> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AR_CREDIT_NOTE_READ);
  const params = arListParamsSchema.parse(rawParams);
  const status = AR_CREDIT_NOTE_STATUSES.find((value) => value === params.status);
  const filterIds = await customerIdsMatching(params.q);

  const where: Prisma.ErpArCreditNoteWhereInput = {
    ...(status !== undefined ? { status } : {}),
    ...(params.customer !== undefined ? { crmAccountId: params.customer } : {}),
    ...(filterIds !== null ? { crmAccountId: { in: filterIds } } : {}),
    ...(params.from !== undefined || params.to !== undefined
      ? {
          creditNoteDate: {
            ...(params.from !== undefined ? { gte: dateFromIso(params.from) } : {}),
            ...(params.to !== undefined ? { lte: dateFromIso(params.to) } : {}),
          },
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.erpArCreditNote.count({ where }),
    prisma.erpArCreditNote.findMany({
      where,
      orderBy: [{ creditNoteDate: "desc" }, { createdAt: "desc" }],
      skip: (params.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: arCreditNoteListSelect,
    }),
  ]);
  const customers = await customerRefs(rows.map((row) => row.crmAccountId));

  return {
    rows: rows.map((row) => ({
      id: row.id,
      creditNoteNumber: row.creditNoteNumber,
      customer: customerFrom(customers, row.crmAccountId),
      invoice: row.invoice,
      creditNoteDate: isoDateOf(row.creditNoteDate),
      status: row.status,
      totalMinor: toAmount(row.totalMinor),
      createdBy: toPerson(row.creator) ?? { id: "", name: "Unknown" },
    })),
    total,
    page: params.page,
    pageSize: PAGE_SIZE,
  };
}

export async function getCreditNote(
  actor: Actor,
  creditNoteId: string,
): Promise<ArCreditNoteDetail> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AR_CREDIT_NOTE_READ);
  assertId(creditNoteId, "credit note");

  const row = await prisma.erpArCreditNote.findUnique({
    where: { id: creditNoteId },
    select: {
      ...arCreditNoteListSelect,
      currency: true,
      subtotalMinor: true,
      discountMinor: true,
      taxMinor: true,
      reason: true,
      notes: true,
      submittedAt: true,
      approvalSkipped: true,
      approvedAt: true,
      rejectedAt: true,
      rejectionReason: true,
      postedAt: true,
      cancelledAt: true,
      cancelReason: true,
      createdAt: true,
      updatedAt: true,
      approver: { select: personSelect },
      poster: { select: personSelect },
      receivableAccount: { select: accountRefSelect },
      period: { select: { id: true, name: true, status: true } },
      journalEntry: { select: { id: true, journalNumber: true } },
      voidJournalEntry: { select: { id: true, journalNumber: true } },
      invoice: { select: { id: true, invoiceNumber: true, outstandingMinor: true } },
      lines: {
        orderBy: { lineNo: "asc" },
        select: {
          id: true,
          lineNo: true,
          description: true,
          quantity: true,
          unitPriceMinor: true,
          grossMinor: true,
          discountMinor: true,
          netMinor: true,
          taxRateBasisPoints: true,
          taxMinor: true,
          totalMinor: true,
          taxRate: { select: { id: true, code: true, name: true } },
          revenueAccount: { select: accountRefSelect },
          costCentre: { select: costCentreRefSelect },
        },
      },
    },
  });
  if (row === null) throw new NotFoundError("credit note");
  const customers = await customerRefs([row.crmAccountId]);

  return {
    id: row.id,
    creditNoteNumber: row.creditNoteNumber,
    customer: customerFrom(customers, row.crmAccountId),
    invoice: { id: row.invoice.id, invoiceNumber: row.invoice.invoiceNumber },
    creditNoteDate: isoDateOf(row.creditNoteDate),
    status: row.status,
    totalMinor: toAmount(row.totalMinor),
    createdBy: toPerson(row.creator) ?? { id: "", name: "Unknown" },
    currency: row.currency,
    subtotalMinor: toAmount(row.subtotalMinor),
    discountMinor: toAmount(row.discountMinor),
    taxMinor: toAmount(row.taxMinor),
    reason: row.reason,
    notes: row.notes,
    receivableAccount: row.receivableAccount,
    period: row.period,
    journal: row.journalEntry,
    voidJournal: row.voidJournalEntry,
    invoiceOutstandingMinor: toAmount(row.invoice.outstandingMinor),
    lines: row.lines.map((line) => ({
      id: line.id,
      lineNo: line.lineNo,
      description: line.description,
      quantity: formatQuantity(line.quantity.toString()),
      unitPriceMinor: toAmount(line.unitPriceMinor),
      grossMinor: toAmount(line.grossMinor),
      discountMinor: toAmount(line.discountMinor),
      netMinor: toAmount(line.netMinor),
      taxRate: line.taxRate,
      taxRateBasisPoints: line.taxRateBasisPoints,
      taxMinor: toAmount(line.taxMinor),
      totalMinor: toAmount(line.totalMinor),
      revenueAccount: line.revenueAccount,
      costCentre: line.costCentre,
    })),
    submittedAt: row.submittedAt,
    approvalSkipped: row.approvalSkipped,
    approvedAt: row.approvedAt,
    approvedBy: toPerson(row.approver),
    rejectedAt: row.rejectedAt,
    rejectionReason: row.rejectionReason,
    postedAt: row.postedAt,
    postedBy: toPerson(row.poster),
    cancelledAt: row.cancelledAt,
    cancelReason: row.cancelReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** A posted invoice with something still outstanding, and its lines to credit from. */
export async function getCreditableInvoice(
  actor: Actor,
  invoiceId: string,
): Promise<CreditableInvoice> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AR_CREDIT_NOTE_CREATE);
  assertId(invoiceId, "invoice");

  const invoice = await prisma.erpArInvoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      invoiceNumber: true,
      invoiceDate: true,
      crmAccountId: true,
      status: true,
      totalMinor: true,
      outstandingMinor: true,
      lines: {
        orderBy: { lineNo: "asc" },
        select: {
          id: true,
          lineNo: true,
          description: true,
          quantity: true,
          unitPriceMinor: true,
          grossMinor: true,
          discountMinor: true,
          netMinor: true,
          taxRateBasisPoints: true,
          taxMinor: true,
          totalMinor: true,
          taxRate: { select: { id: true, code: true, name: true } },
          revenueAccount: { select: accountRefSelect },
          costCentre: { select: costCentreRefSelect },
        },
      },
    },
  });
  if (invoice === null) throw new NotFoundError("invoice");
  if (!POSTED_INVOICE_STATUSES.some((status) => status === invoice.status)) {
    throw new BusinessRuleError("Only a posted invoice can be credited.");
  }
  const customers = await customerRefs([invoice.crmAccountId]);

  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber ?? "",
    invoiceDate: isoDateOf(invoice.invoiceDate),
    customer: customerFrom(customers, invoice.crmAccountId),
    totalMinor: toAmount(invoice.totalMinor),
    outstandingMinor: toAmount(invoice.outstandingMinor),
    lines: invoice.lines.map((line) => ({
      id: line.id,
      lineNo: line.lineNo,
      description: line.description,
      quantity: formatQuantity(line.quantity.toString()),
      unitPriceMinor: toAmount(line.unitPriceMinor),
      grossMinor: toAmount(line.grossMinor),
      discountMinor: toAmount(line.discountMinor),
      netMinor: toAmount(line.netMinor),
      taxRate: line.taxRate,
      taxRateBasisPoints: line.taxRateBasisPoints,
      taxMinor: toAmount(line.taxMinor),
      totalMinor: toAmount(line.totalMinor),
      revenueAccount: line.revenueAccount,
      costCentre: line.costCentre,
    })),
  };
}

/* Drafts ------------------------------------------------------------------------- */

/**
 * Prices the lines on the server and checks the invoice can be credited: it is posted,
 * and the credit is no more than what the invoice still owes.
 */
async function prepareDraft(input: unknown) {
  const draft = parseInput(arCreditNoteDraftSchema, input);
  const invoice = await prisma.erpArInvoice.findUnique({
    where: { id: draft.invoiceId },
    select: {
      id: true,
      status: true,
      crmAccountId: true,
      currency: true,
      receivableAccountId: true,
      outstandingMinor: true,
    },
  });
  if (invoice === null) throw new NotFoundError("invoice");
  if (!POSTED_INVOICE_STATUSES.some((status) => status === invoice.status)) {
    throw new BusinessRuleError("Only a posted invoice can be credited.");
  }

  const priced = await priceDocumentLines(draft.lines, "credit note");
  if (priced.totals.totalMinor > invoice.outstandingMinor) {
    throw new BusinessRuleError(
      `A credit note cannot be more than the ${toAmount(invoice.outstandingMinor) / 100} EGP still outstanding on the invoice.`,
    );
  }
  return { draft, priced, invoice };
}

export async function createCreditNote(
  actor: Actor,
  input: unknown,
): Promise<{ id: string }> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AR_CREDIT_NOTE_CREATE);
  const { draft, priced, invoice } = await prepareDraft(input);

  try {
    return await prisma.$transaction(async (tx) => {
      const creditNote = await tx.erpArCreditNote.create({
        data: {
          invoiceId: invoice.id,
          crmAccountId: invoice.crmAccountId,
          creditNoteDate: dateFromIso(draft.creditNoteDate),
          reason: draft.reason,
          notes: draft.notes,
          receivableAccountId: invoice.receivableAccountId,
          subtotalMinor: priced.totals.subtotalMinor,
          discountMinor: priced.totals.discountMinor,
          taxMinor: priced.totals.taxMinor,
          totalMinor: priced.totals.totalMinor,
          createdBy: actor.id,
          updatedBy: actor.id,
          lines: { create: priced.lines },
        },
        select: { id: true },
      });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.ar_credit_note.created",
          module: ERP_MODULE,
          entityType: "ar_credit_note",
          entityId: creditNote.id,
          summary: `Created a draft credit note dated ${draft.creditNoteDate}`,
          changes: {
            invoiceId: invoice.id,
            crmAccountId: invoice.crmAccountId,
            creditNoteDate: draft.creditNoteDate,
            lineCount: priced.lines.length,
          },
        },
        tx,
      );
      return creditNote;
    });
  } catch (error) {
    throw asFinanceError(error);
  }
}

export async function updateCreditNote(
  actor: Actor,
  creditNoteId: string,
  input: unknown,
): Promise<{ id: string }> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AR_CREDIT_NOTE_UPDATE);
  assertId(creditNoteId, "credit note");
  const { draft, priced, invoice } = await prepareDraft(input);

  try {
    await prisma.$transaction(async (tx) => {
      const creditNote = await lockCreditNote(tx, creditNoteId);
      if (creditNote.status !== "DRAFT") {
        throw new BusinessRuleError(
          "Only a draft credit note can be edited. A rejected credit note returns to draft.",
        );
      }
      if (creditNote.invoiceId !== invoice.id) {
        throw new BusinessRuleError(
          "A credit note stays with the invoice it was raised against.",
        );
      }
      await tx.erpArCreditNoteLine.deleteMany({ where: { creditNoteId } });
      await tx.erpArCreditNote.update({
        where: { id: creditNoteId },
        data: {
          creditNoteDate: dateFromIso(draft.creditNoteDate),
          reason: draft.reason,
          notes: draft.notes,
          subtotalMinor: priced.totals.subtotalMinor,
          discountMinor: priced.totals.discountMinor,
          taxMinor: priced.totals.taxMinor,
          totalMinor: priced.totals.totalMinor,
          updatedBy: actor.id,
          lines: { create: priced.lines },
        },
      });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.ar_credit_note.updated",
          module: ERP_MODULE,
          entityType: "ar_credit_note",
          entityId: creditNoteId,
          summary: `Updated a draft credit note dated ${draft.creditNoteDate}`,
          changes: {
            creditNoteDate: draft.creditNoteDate,
            lineCount: priced.lines.length,
          },
        },
        tx,
      );
    });
  } catch (error) {
    throw asFinanceError(error);
  }
  return { id: creditNoteId };
}

export async function deleteCreditNote(
  actor: Actor,
  creditNoteId: string,
): Promise<void> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AR_CREDIT_NOTE_UPDATE);
  assertId(creditNoteId, "credit note");

  try {
    await prisma.$transaction(async (tx) => {
      const creditNote = await lockCreditNote(tx, creditNoteId);
      if (creditNote.status !== "DRAFT") {
        throw new BusinessRuleError(
          "Only a draft credit note can be deleted. Cancel it instead.",
        );
      }
      await tx.erpArCreditNote.delete({ where: { id: creditNoteId } });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.ar_credit_note.deleted",
          module: ERP_MODULE,
          entityType: "ar_credit_note",
          entityId: creditNoteId,
          summary: `Deleted a draft credit note dated ${creditNote.creditNoteDate}`,
        },
        tx,
      );
    });
  } catch (error) {
    throw asFinanceError(error);
  }
}

/* Approval ----------------------------------------------------------------------- */

export async function submitCreditNote(
  actor: Actor,
  creditNoteId: string,
): Promise<{ status: "PENDING_APPROVAL" | "APPROVED" }> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AR_CREDIT_NOTE_UPDATE);
  assertId(creditNoteId, "credit note");

  try {
    return await prisma.$transaction(async (tx) => {
      const creditNote = await lockCreditNote(tx, creditNoteId);
      if (creditNote.status !== "DRAFT") {
        throw new BusinessRuleError("Only a draft credit note can be submitted.");
      }
      if (creditNote.totalMinor <= 0n) {
        throw new BusinessRuleError(
          "Add lines with an amount before submitting the credit note.",
        );
      }
      const settings = await loadArSettings(tx);
      const needsApproval = approvalRequired(settings, creditNote.totalMinor);
      const now = new Date();

      if (needsApproval) {
        await tx.erpArCreditNote.update({
          where: { id: creditNoteId },
          data: {
            status: "PENDING_APPROVAL",
            submittedAt: now,
            submittedBy: actor.id,
            updatedBy: actor.id,
          },
        });
        await recordAudit(
          {
            ...auditFields(actor),
            action: "erp.ar_credit_note.submitted",
            module: ERP_MODULE,
            entityType: "ar_credit_note",
            entityId: creditNoteId,
            summary: "Submitted a credit note for approval",
          },
          tx,
        );
        return { status: "PENDING_APPROVAL" as const };
      }

      await tx.erpArCreditNote.update({
        where: { id: creditNoteId },
        data: {
          status: "APPROVED",
          submittedAt: now,
          submittedBy: actor.id,
          approvalSkipped: true,
          approvedAt: now,
          updatedBy: actor.id,
        },
      });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.ar_credit_note.approved",
          module: ERP_MODULE,
          entityType: "ar_credit_note",
          entityId: creditNoteId,
          summary: "Submitted a credit note that needs no approval under AR settings",
          changes: { approvalSkipped: true },
        },
        tx,
      );
      await publish(tx, {
        name: ERP_EVENTS.AR_CREDIT_NOTE_APPROVED,
        actorId: actor.id,
        correlationId: actor.correlationId ?? null,
        payload: {
          creditNoteId,
          invoiceId: creditNote.invoiceId,
          crmAccountId: creditNote.crmAccountId,
          approvalSkipped: true,
        } satisfies ArCreditNoteApprovedPayload,
      });
      return { status: "APPROVED" as const };
    });
  } catch (error) {
    throw asFinanceError(error);
  }
}

export async function approveCreditNote(
  actor: Actor,
  creditNoteId: string,
): Promise<void> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AR_CREDIT_NOTE_APPROVE);
  assertId(creditNoteId, "credit note");

  try {
    await prisma.$transaction(async (tx) => {
      const creditNote = await lockCreditNote(tx, creditNoteId);
      if (creditNote.status !== "PENDING_APPROVAL") {
        throw new BusinessRuleError(
          "Only a credit note waiting for approval can be approved.",
        );
      }
      const settings = await loadArSettings(tx);
      // §13.3, as for invoices: nobody approves what they raised themselves.
      if (
        !settings.allowSelfApproval &&
        (creditNote.createdBy === actor.id || creditNote.submittedBy === actor.id)
      ) {
        throw new BusinessRuleError(
          "You cannot approve a credit note you created or submitted.",
        );
      }

      await tx.erpArCreditNote.update({
        where: { id: creditNoteId },
        data: {
          status: "APPROVED",
          approvedAt: new Date(),
          approvedBy: actor.id,
          updatedBy: actor.id,
        },
      });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.ar_credit_note.approved",
          module: ERP_MODULE,
          entityType: "ar_credit_note",
          entityId: creditNoteId,
          summary: "Approved a credit note",
          severity: "NOTICE",
        },
        tx,
      );
      await publish(tx, {
        name: ERP_EVENTS.AR_CREDIT_NOTE_APPROVED,
        actorId: actor.id,
        correlationId: actor.correlationId ?? null,
        payload: {
          creditNoteId,
          invoiceId: creditNote.invoiceId,
          crmAccountId: creditNote.crmAccountId,
          approvalSkipped: false,
        } satisfies ArCreditNoteApprovedPayload,
      });
    });
  } catch (error) {
    throw asFinanceError(error);
  }
}

export async function rejectCreditNote(
  actor: Actor,
  creditNoteId: string,
  input: unknown,
): Promise<void> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AR_CREDIT_NOTE_APPROVE);
  assertId(creditNoteId, "credit note");
  const { reason } = parseInput(arReasonSchema, input);

  try {
    await prisma.$transaction(async (tx) => {
      const creditNote = await lockCreditNote(tx, creditNoteId);
      if (creditNote.status !== "PENDING_APPROVAL") {
        throw new BusinessRuleError(
          "Only a credit note waiting for approval can be rejected.",
        );
      }
      await tx.erpArCreditNote.update({
        where: { id: creditNoteId },
        data: {
          status: "DRAFT",
          submittedAt: null,
          submittedBy: null,
          rejectedAt: new Date(),
          rejectedBy: actor.id,
          rejectionReason: reason,
          updatedBy: actor.id,
        },
      });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.ar_credit_note.rejected",
          module: ERP_MODULE,
          entityType: "ar_credit_note",
          entityId: creditNoteId,
          summary: "Rejected a credit note back to draft",
          changes: { reason },
          severity: "NOTICE",
        },
        tx,
      );
    });
  } catch (error) {
    throw asFinanceError(error);
  }
}

/* Posting ------------------------------------------------------------------------ */

/**
 * Posts an approved credit note: numbers it, books Dr revenue / Dr tax / Cr receivable
 * — the mirror of the invoice — and lets the database reduce the invoice's outstanding
 * amount. One transaction: if anything fails, no number is used and no journal exists.
 */
export async function postCreditNote(
  actor: Actor,
  creditNoteId: string,
): Promise<{ creditNoteNumber: string; journalNumber: string }> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AR_CREDIT_NOTE_POST);
  assertId(creditNoteId, "credit note");

  try {
    return await prisma.$transaction(async (tx) => {
      const locked = await lockCreditNote(tx, creditNoteId);
      if (locked.status !== "APPROVED") {
        throw new BusinessRuleError(
          locked.status === "DRAFT" || locked.status === "PENDING_APPROVAL"
            ? "Submit and approve the credit note before posting it."
            : locked.status === "CANCELLED"
              ? "This credit note has been cancelled."
              : "This credit note is already posted.",
        );
      }
      // Lock the invoice in the same order the allocation trigger does.
      const invoice = await lockInvoice(tx, locked.invoiceId);
      if (!POSTED_INVOICE_STATUSES.some((status) => status === invoice.status)) {
        throw new BusinessRuleError("Only a posted invoice can be credited.");
      }

      const creditNote = await tx.erpArCreditNote.findUniqueOrThrow({
        where: { id: creditNoteId },
        select: {
          creditNoteDate: true,
          totalMinor: true,
          receivableAccountId: true,
          lines: {
            orderBy: { lineNo: "asc" },
            select: {
              netMinor: true,
              taxMinor: true,
              revenueAccountId: true,
              costCentreId: true,
              taxRate: { select: { taxAccountId: true } },
            },
          },
        },
      });
      const creditNoteDate = isoDateOf(creditNote.creditNoteDate);
      const creditNoteNumber = await nextDocumentNumber(
        tx,
        "AR_CREDIT_NOTE",
        creditNoteDate,
      );

      // Dr each revenue account (by cost centre) with its net, Dr each tax account with
      // its tax, Cr receivable with the total — the invoice posting, reversed.
      const revenue = new Map<string, LedgerLine>();
      const tax = new Map<string, LedgerLine>();
      for (const line of creditNote.lines) {
        if (line.netMinor > 0n) {
          const key = `${line.revenueAccountId}|${line.costCentreId ?? ""}`;
          const entry = revenue.get(key) ?? {
            accountId: line.revenueAccountId,
            costCentreId: line.costCentreId,
            description: `Credit note ${creditNoteNumber}`,
            debitMinor: 0n,
            creditMinor: 0n,
          };
          entry.debitMinor += line.netMinor;
          revenue.set(key, entry);
        }
        if (line.taxMinor > 0n && line.taxRate !== null) {
          const entry = tax.get(line.taxRate.taxAccountId) ?? {
            accountId: line.taxRate.taxAccountId,
            costCentreId: null,
            description: `Tax on credit note ${creditNoteNumber}`,
            debitMinor: 0n,
            creditMinor: 0n,
          };
          entry.debitMinor += line.taxMinor;
          tax.set(line.taxRate.taxAccountId, entry);
        }
      }
      const journal = await recordPostedJournal(tx, actor, {
        entryDate: creditNoteDate,
        description: `Credit note ${creditNoteNumber} against invoice ${invoice.invoiceNumber ?? ""}`,
        reference: creditNoteNumber,
        source: { module: ERP_MODULE, type: SOURCE_TYPE, id: creditNoteId },
        lines: [
          ...revenue.values(),
          ...tax.values(),
          {
            accountId: creditNote.receivableAccountId,
            costCentreId: null,
            description: `Credit note ${creditNoteNumber}`,
            debitMinor: 0n,
            creditMinor: creditNote.totalMinor,
          },
        ],
      });

      // The database applies the credit to the invoice and refuses to exceed it.
      await tx.erpArCreditNote.update({
        where: { id: creditNoteId },
        data: {
          status: "POSTED",
          creditNoteNumber,
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
          action: "erp.ar_credit_note.posted",
          module: ERP_MODULE,
          entityType: "ar_credit_note",
          entityId: creditNoteId,
          summary: `Posted credit note ${creditNoteNumber} as journal entry ${journal.journalNumber}`,
          changes: {
            creditNoteNumber,
            invoiceId: locked.invoiceId,
            journalEntryId: journal.id,
            journalNumber: journal.journalNumber,
          },
          severity: "NOTICE",
        },
        tx,
      );
      await publish(tx, {
        name: ERP_EVENTS.AR_CREDIT_NOTE_POSTED,
        actorId: actor.id,
        correlationId: actor.correlationId ?? null,
        payload: {
          creditNoteId,
          creditNoteNumber,
          invoiceId: locked.invoiceId,
          crmAccountId: locked.crmAccountId,
          creditNoteDate,
          journalEntryId: journal.id,
        } satisfies ArCreditNotePostedPayload,
      });
      return { creditNoteNumber, journalNumber: journal.journalNumber };
    }, AR_POSTING_TRANSACTION);
  } catch (error) {
    throw asFinanceError(error);
  }
}

/**
 * Cancels a credit note. Before posting it is simply cancelled; a posted one is voided
 * by reversing its journal entry, and the database restores the invoice's outstanding
 * amount.
 */
export async function cancelCreditNote(
  actor: Actor,
  creditNoteId: string,
  input: unknown,
): Promise<{ voidJournalNumber: string | null }> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AR_CREDIT_NOTE_CANCEL);
  assertId(creditNoteId, "credit note");
  const data = parseInput(arCancelSchema, input);

  try {
    return await prisma.$transaction(async (tx) => {
      const creditNote = await lockCreditNote(tx, creditNoteId);
      if (creditNote.status === "CANCELLED") {
        throw new BusinessRuleError("This credit note is already cancelled.");
      }
      // Lock the invoice too: the trigger restoring it runs in this transaction.
      await lockInvoice(tx, creditNote.invoiceId);

      const now = new Date();
      if (creditNote.status !== "POSTED") {
        await tx.erpArCreditNote.update({
          where: { id: creditNoteId },
          data: {
            status: "CANCELLED",
            cancelledAt: now,
            cancelledBy: actor.id,
            cancelReason: data.reason,
            updatedBy: actor.id,
          },
        });
        await announceCancellation(tx, actor, creditNote, data.reason, null);
        return { voidJournalNumber: null };
      }

      if (creditNote.journalEntryId === null) {
        throw new Error("A posted credit note has no journal entry.");
      }
      const reversal = await reverseJournalInTransaction(
        tx,
        actor,
        creditNote.journalEntryId,
        {
          reversalDate: data.voidDate ?? todayIso(),
          description: `Void of credit note ${creditNote.creditNoteNumber ?? ""}`,
        },
      );
      await tx.erpArCreditNote.update({
        where: { id: creditNoteId },
        data: {
          status: "CANCELLED",
          cancelledAt: now,
          cancelledBy: actor.id,
          cancelReason: data.reason,
          voidJournalEntryId: reversal.reversalId,
          updatedBy: actor.id,
        },
      });
      await announceCancellation(tx, actor, creditNote, data.reason, reversal.reversalId);
      return { voidJournalNumber: reversal.journalNumber };
    }, AR_POSTING_TRANSACTION);
  } catch (error) {
    throw asFinanceError(error);
  }
}

async function announceCancellation(
  tx: PrismaTransaction,
  actor: Actor,
  creditNote: LockedCreditNote,
  reason: string,
  voidJournalEntryId: string | null,
): Promise<void> {
  await recordAudit(
    {
      ...auditFields(actor),
      action: "erp.ar_credit_note.cancelled",
      module: ERP_MODULE,
      entityType: "ar_credit_note",
      entityId: creditNote.id,
      summary:
        voidJournalEntryId === null
          ? "Cancelled a credit note before posting"
          : `Voided credit note ${creditNote.creditNoteNumber ?? ""} by reversal`,
      changes: { reason, voidJournalEntryId },
      severity: "WARNING",
    },
    tx,
  );
  await publish(tx, {
    name: ERP_EVENTS.AR_CREDIT_NOTE_CANCELLED,
    actorId: actor.id,
    correlationId: actor.correlationId ?? null,
    payload: {
      creditNoteId: creditNote.id,
      creditNoteNumber: creditNote.creditNoteNumber,
      invoiceId: creditNote.invoiceId,
      crmAccountId: creditNote.crmAccountId,
      voidJournalEntryId,
    } satisfies ArCreditNoteCancelledPayload,
  });
}

/* Locks -------------------------------------------------------------------------- */

type LockedCreditNote = {
  id: string;
  status: string;
  creditNoteNumber: string | null;
  invoiceId: string;
  crmAccountId: string;
  creditNoteDate: string;
  totalMinor: bigint;
  journalEntryId: string | null;
  createdBy: string;
  submittedBy: string | null;
};

async function lockCreditNote(
  tx: PrismaTransaction,
  creditNoteId: string,
): Promise<LockedCreditNote> {
  const rows = await tx.$queryRaw<
    {
      id: string;
      status: string;
      credit_note_number: string | null;
      invoice_id: string;
      crm_account_id: string;
      credit_note_date: string;
      total_minor: bigint;
      journal_entry_id: string | null;
      created_by: string;
      submitted_by: string | null;
    }[]
  >`
    SELECT id, status::text AS status, credit_note_number, invoice_id, crm_account_id,
           credit_note_date::text AS credit_note_date, total_minor, journal_entry_id,
           created_by, submitted_by
      FROM erp.ar_credit_notes
     WHERE id = ${creditNoteId}::uuid
       FOR UPDATE`;
  const row = rows[0];
  if (row === undefined) throw new NotFoundError("credit note");
  return {
    id: row.id,
    status: row.status,
    creditNoteNumber: row.credit_note_number,
    invoiceId: row.invoice_id,
    crmAccountId: row.crm_account_id,
    creditNoteDate: row.credit_note_date,
    totalMinor: BigInt(row.total_minor),
    journalEntryId: row.journal_entry_id,
    createdBy: row.created_by,
    submittedBy: row.submitted_by,
  };
}
