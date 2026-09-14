import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import { BusinessRuleError, NotFoundError, ValidationError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/platform/audit/audit";
import { type Actor, requirePermission } from "@/platform/authz/authz";
import { publish } from "@/platform/events/publish";
import {
  ERP_EVENTS,
  type ArInvoiceApprovedPayload,
  type ArInvoiceCancelledPayload,
  type ArInvoicePostedPayload,
} from "../../../contracts/events";
import { ERP_PERMISSIONS } from "../../../contracts/permissions";
import {
  arCancelSchema,
  arInvoiceDraftSchema,
  arListParamsSchema,
  arReasonSchema,
} from "../../../contracts/schemas";
import {
  AR_INVOICE_STATUSES,
  type ArInvoiceDetail,
  type ArInvoiceListItem,
  type OpenInvoiceOption,
  type Paginated,
} from "../../../contracts/types";
import {
  MAX_DOCUMENT_AMOUNT_MINOR,
  addDays,
  approvalRequired,
  calculateLine,
  formatQuantity,
  invoiceTotals,
  lineProblems,
  quantityToDecimal,
} from "../../../domain/ar";
import { arInvoiceListSelect } from "../../../repositories/ar-selects";
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
  todayIso,
  toAmount,
  toPerson,
} from "../support";
import {
  AR_POSTING_TRANSACTION,
  customerFrom,
  customerIdsMatching,
  customerRefs,
  loadArSettings,
  lockInvoice,
  resolveReceivableAccount,
  requireLiveCustomer,
  toInvoiceListItem,
} from "./support";

/**
 * Customer invoices (ADR-023).
 *
 * DRAFT → PENDING_APPROVAL → APPROVED → POSTED → PARTIALLY_PAID → PAID, or CANCELLED.
 * The server prices every line; the browser's totals are never read. Approval is a
 * status change guarded by its own permission until the platform workflow engine
 * exists. Posting books Dr receivable, Cr revenue, Cr tax through the ledger engine
 * in the same transaction that numbers and posts the invoice. A posted invoice is
 * corrected only by voiding it (a reversal) while it is unpaid.
 */

const PAGE_SIZE = 25;
const SOURCE_TYPE = "ar_invoice";

type Draft = z.output<typeof arInvoiceDraftSchema>;

/* Pricing ------------------------------------------------------------------------ */

/**
 * Prices every line on the server from quantity, unit price, discount and the tax
 * rate as it is now, and checks each account, rate and cost centre. Returns the rows
 * to store and the totals.
 */
async function priceDraft(draft: Draft) {
  const revenueIds = [...new Set(draft.lines.map((line) => line.revenueAccountId))];
  const taxIds = [
    ...new Set(
      draft.lines.flatMap((line) => (line.taxRateId === null ? [] : [line.taxRateId])),
    ),
  ];
  const centreIds = [
    ...new Set(
      draft.lines.flatMap((line) =>
        line.costCentreId === null ? [] : [line.costCentreId],
      ),
    ),
  ];

  const [accounts, rates, centres] = await Promise.all([
    prisma.erpAccount.findMany({
      where: { id: { in: revenueIds } },
      select: { id: true, code: true, type: true, isActive: true, isPostable: true },
    }),
    taxIds.length === 0
      ? Promise.resolve([])
      : prisma.erpTaxRate.findMany({
          where: { id: { in: taxIds } },
          select: { id: true, code: true, isActive: true, rateBasisPoints: true },
        }),
    centreIds.length === 0
      ? Promise.resolve([])
      : prisma.erpCostCentre.findMany({
          where: { id: { in: centreIds } },
          select: { id: true, code: true, isActive: true },
        }),
  ]);
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const rateById = new Map(rates.map((rate) => [rate.id, rate]));
  const centreById = new Map(centres.map((centre) => [centre.id, centre]));

  const errors: Record<string, string[]> = {};
  const rows = draft.lines.map((line, index) => {
    const prefix = `lines.${index}`;
    const account = accountById.get(line.revenueAccountId);
    if (account === undefined) {
      errors[`${prefix}.revenueAccountId`] = ["Choose a valid revenue account."];
    } else if (!account.isActive) {
      errors[`${prefix}.revenueAccountId`] = [`Account ${account.code} is inactive.`];
    } else if (!account.isPostable) {
      errors[`${prefix}.revenueAccountId`] = [
        `${account.code} is a heading and cannot take postings.`,
      ];
    } else if (account.type !== "REVENUE") {
      errors[`${prefix}.revenueAccountId`] = [
        `${account.code} is not a revenue account.`,
      ];
    }

    const rate = line.taxRateId === null ? null : rateById.get(line.taxRateId);
    if (rate === undefined) {
      errors[`${prefix}.taxRateId`] = ["Choose a valid tax rate."];
    } else if (rate !== null && !rate.isActive) {
      errors[`${prefix}.taxRateId`] = [`Tax rate ${rate.code} is inactive.`];
    }

    if (line.costCentreId !== null) {
      const centre = centreById.get(line.costCentreId);
      if (centre === undefined) {
        errors[`${prefix}.costCentreId`] = ["Choose a valid cost centre."];
      } else if (!centre.isActive) {
        errors[`${prefix}.costCentreId`] = [`Cost centre ${centre.code} is inactive.`];
      }
    }

    const input = {
      quantityScaled: line.quantity,
      unitPriceMinor: line.unitPrice,
      discountMinor: line.discount,
      taxBasisPoints: rate?.rateBasisPoints ?? null,
    };
    for (const problem of lineProblems(input)) {
      errors[`${prefix}.${problem.field}`] = [problem.message];
    }
    const amounts = calculateLine(input);
    return {
      amounts,
      data: {
        lineNo: index + 1,
        description: line.description,
        quantity: quantityToDecimal(line.quantity),
        unitPriceMinor: line.unitPrice,
        grossMinor: amounts.grossMinor,
        discountMinor: amounts.discountMinor,
        netMinor: amounts.netMinor,
        taxRateId: rate?.id ?? null,
        taxRateBasisPoints: rate?.rateBasisPoints ?? null,
        taxMinor: amounts.taxMinor,
        totalMinor: amounts.totalMinor,
        revenueAccountId: line.revenueAccountId,
        costCentreId: line.costCentreId,
      },
    };
  });

  const totals = invoiceTotals(rows.map((row) => row.amounts));
  if (totals.totalMinor > MAX_DOCUMENT_AMOUNT_MINOR) {
    errors.lines = ["The invoice total is too large."];
  }
  if (Object.keys(errors).length > 0) {
    throw new ValidationError("Please correct the highlighted lines.", errors);
  }
  return { lines: rows.map((row) => row.data), totals };
}

/* Reads -------------------------------------------------------------------------- */

export async function listInvoices(
  actor: Actor,
  rawParams: Record<string, unknown> = {},
): Promise<Paginated<ArInvoiceListItem>> {
  await requirePermission(actor, ERP_PERMISSIONS.AR_INVOICE_READ);
  const params = arListParamsSchema.parse(rawParams);
  const status = AR_INVOICE_STATUSES.find((value) => value === params.status);
  const matchingCustomers = await customerIdsMatching(params.q);
  const range = (from?: string, to?: string) =>
    from === undefined && to === undefined
      ? undefined
      : {
          ...(from !== undefined ? { gte: dateFromIso(from) } : {}),
          ...(to !== undefined ? { lte: dateFromIso(to) } : {}),
        };

  const where: Prisma.ErpArInvoiceWhereInput = {
    ...(status !== undefined ? { status } : {}),
    ...(params.customer !== undefined ? { crmAccountId: params.customer } : {}),
    ...(range(params.from, params.to) !== undefined
      ? { invoiceDate: range(params.from, params.to) }
      : {}),
    ...(range(params.dueFrom, params.dueTo) !== undefined
      ? { dueDate: range(params.dueFrom, params.dueTo) }
      : {}),
    ...(params.overdue === "1"
      ? { outstandingMinor: { gt: 0 }, dueDate: { lt: dateFromIso(todayIso()) } }
      : {}),
    ...(params.q !== undefined && params.q !== ""
      ? {
          OR: [
            { invoiceNumber: { contains: params.q, mode: "insensitive" } },
            { reference: { contains: params.q, mode: "insensitive" } },
            ...(matchingCustomers !== null && matchingCustomers.length > 0
              ? [{ crmAccountId: { in: matchingCustomers } }]
              : []),
          ],
        }
      : {}),
  };

  const direction = params.dir;
  const orderBy: Prisma.ErpArInvoiceOrderByWithRelationInput[] =
    params.sort === "due"
      ? [{ dueDate: direction }, { createdAt: "desc" }]
      : params.sort === "number"
        ? [{ invoiceNumber: direction }]
        : params.sort === "total"
          ? [{ totalMinor: direction }, { createdAt: "desc" }]
          : params.sort === "outstanding"
            ? [{ outstandingMinor: direction }, { dueDate: "asc" }]
            : [{ invoiceDate: direction }, { createdAt: "desc" }];

  const [total, rows] = await Promise.all([
    prisma.erpArInvoice.count({ where }),
    prisma.erpArInvoice.findMany({
      where,
      orderBy,
      skip: (params.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: arInvoiceListSelect,
    }),
  ]);
  const customers = await customerRefs(rows.map((row) => row.crmAccountId));

  return {
    rows: rows.map((row) => toInvoiceListItem(row, customers)),
    total,
    page: params.page,
    pageSize: PAGE_SIZE,
  };
}

export async function getInvoice(
  actor: Actor,
  invoiceId: string,
): Promise<ArInvoiceDetail> {
  await requirePermission(actor, ERP_PERMISSIONS.AR_INVOICE_READ);
  assertId(invoiceId, "invoice");

  const row = await prisma.erpArInvoice.findUnique({
    where: { id: invoiceId },
    select: {
      ...arInvoiceListSelect,
      currency: true,
      subtotalMinor: true,
      discountMinor: true,
      taxMinor: true,
      reference: true,
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
      allocations: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          amountMinor: true,
          createdAt: true,
          receipt: { select: { id: true, receiptNumber: true, receiptDate: true } },
        },
      },
    },
  });
  if (row === null) throw new NotFoundError("invoice");
  const customers = await customerRefs([row.crmAccountId]);

  return {
    ...toInvoiceListItem(row, customers),
    currency: row.currency,
    subtotalMinor: toAmount(row.subtotalMinor),
    discountMinor: toAmount(row.discountMinor),
    taxMinor: toAmount(row.taxMinor),
    reference: row.reference,
    notes: row.notes,
    receivableAccount: row.receivableAccount,
    period: row.period,
    journal: row.journalEntry,
    voidJournal: row.voidJournalEntry,
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
    allocations: row.allocations.map((allocation) => ({
      id: allocation.id,
      receiptId: allocation.receipt.id,
      receiptNumber: allocation.receipt.receiptNumber,
      receiptDate: isoDateOf(allocation.receipt.receiptDate),
      invoiceId: row.id,
      invoiceNumber: row.invoiceNumber,
      invoiceDate: isoDateOf(row.invoiceDate),
      dueDate: isoDateOf(row.dueDate),
      amountMinor: toAmount(allocation.amountMinor),
      allocatedAt: allocation.createdAt,
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

/** Posted invoices of a customer that still have something outstanding, oldest due first. */
export async function listOpenInvoices(
  actor: Actor,
  crmAccountId: string,
): Promise<OpenInvoiceOption[]> {
  await requirePermission(actor, ERP_PERMISSIONS.AR_RECEIPT_ALLOCATE);
  assertId(crmAccountId, "customer");
  const rows = await prisma.erpArInvoice.findMany({
    where: {
      crmAccountId,
      status: { in: ["POSTED", "PARTIALLY_PAID"] },
      outstandingMinor: { gt: 0 },
    },
    orderBy: [{ dueDate: "asc" }, { invoiceNumber: "asc" }],
    take: 100,
    select: {
      id: true,
      invoiceNumber: true,
      invoiceDate: true,
      dueDate: true,
      totalMinor: true,
      outstandingMinor: true,
    },
  });
  return rows.map((row) => ({
    id: row.id,
    invoiceNumber: row.invoiceNumber ?? "",
    invoiceDate: isoDateOf(row.invoiceDate),
    dueDate: isoDateOf(row.dueDate),
    totalMinor: toAmount(row.totalMinor),
    outstandingMinor: toAmount(row.outstandingMinor),
  }));
}

/* Drafts -------------------------------------------------------------------------- */

async function prepareDraft(input: unknown) {
  const draft = parseInput(arInvoiceDraftSchema, input);
  await requireLiveCustomer(draft.crmAccountId);
  const settings = await loadArSettings();
  const customer = await resolveReceivableAccount(draft.crmAccountId, settings);
  const priced = await priceDraft(draft);
  const dueDate = draft.dueDate ?? addDays(draft.invoiceDate, customer.paymentTermsDays);
  return { draft, priced, dueDate, receivableAccountId: customer.receivableAccountId };
}

export async function createInvoice(
  actor: Actor,
  input: unknown,
): Promise<{ id: string }> {
  await requirePermission(actor, ERP_PERMISSIONS.AR_INVOICE_CREATE);
  const { draft, priced, dueDate, receivableAccountId } = await prepareDraft(input);

  try {
    return await prisma.$transaction(async (tx) => {
      const invoice = await tx.erpArInvoice.create({
        data: {
          crmAccountId: draft.crmAccountId,
          invoiceDate: dateFromIso(draft.invoiceDate),
          dueDate: dateFromIso(dueDate),
          reference: draft.reference,
          notes: draft.notes,
          receivableAccountId,
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
          action: "erp.ar_invoice.created",
          module: ERP_MODULE,
          entityType: "ar_invoice",
          entityId: invoice.id,
          summary: `Created a draft invoice dated ${draft.invoiceDate}`,
          changes: {
            crmAccountId: draft.crmAccountId,
            invoiceDate: draft.invoiceDate,
            dueDate,
            lineCount: priced.lines.length,
          },
        },
        tx,
      );
      return invoice;
    });
  } catch (error) {
    throw asFinanceError(error);
  }
}

export async function updateInvoice(
  actor: Actor,
  invoiceId: string,
  input: unknown,
): Promise<{ id: string }> {
  await requirePermission(actor, ERP_PERMISSIONS.AR_INVOICE_UPDATE);
  assertId(invoiceId, "invoice");
  const { draft, priced, dueDate, receivableAccountId } = await prepareDraft(input);

  try {
    await prisma.$transaction(async (tx) => {
      const invoice = await lockInvoice(tx, invoiceId);
      if (invoice.status !== "DRAFT") {
        throw new BusinessRuleError(
          "Only a draft invoice can be edited. A rejected invoice returns to draft.",
        );
      }
      await tx.erpArInvoiceLine.deleteMany({ where: { invoiceId } });
      await tx.erpArInvoice.update({
        where: { id: invoiceId },
        data: {
          crmAccountId: draft.crmAccountId,
          invoiceDate: dateFromIso(draft.invoiceDate),
          dueDate: dateFromIso(dueDate),
          reference: draft.reference,
          notes: draft.notes,
          receivableAccountId,
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
          action: "erp.ar_invoice.updated",
          module: ERP_MODULE,
          entityType: "ar_invoice",
          entityId: invoiceId,
          summary: `Updated a draft invoice dated ${draft.invoiceDate}`,
          changes: {
            crmAccountId: draft.crmAccountId,
            invoiceDate: draft.invoiceDate,
            dueDate,
            lineCount: priced.lines.length,
          },
        },
        tx,
      );
    });
  } catch (error) {
    throw asFinanceError(error);
  }
  return { id: invoiceId };
}

export async function deleteInvoice(actor: Actor, invoiceId: string): Promise<void> {
  await requirePermission(actor, ERP_PERMISSIONS.AR_INVOICE_UPDATE);
  assertId(invoiceId, "invoice");
  try {
    await prisma.$transaction(async (tx) => {
      const invoice = await lockInvoice(tx, invoiceId);
      if (invoice.status !== "DRAFT") {
        throw new BusinessRuleError(
          "Only a draft invoice can be deleted. Cancel it instead.",
        );
      }
      await tx.erpArInvoice.delete({ where: { id: invoiceId } });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.ar_invoice.deleted",
          module: ERP_MODULE,
          entityType: "ar_invoice",
          entityId: invoiceId,
          summary: `Deleted a draft invoice dated ${invoice.invoiceDate}`,
        },
        tx,
      );
    });
  } catch (error) {
    throw asFinanceError(error);
  }
}

/* Approval ------------------------------------------------------------------------- */

/**
 * Sends a draft for approval — or approves it straight away when AR settings say
 * this invoice needs none. Totals are the server's, so the rule sees the real amount.
 */
export async function submitInvoice(
  actor: Actor,
  invoiceId: string,
): Promise<{ status: "PENDING_APPROVAL" | "APPROVED" }> {
  await requirePermission(actor, ERP_PERMISSIONS.AR_INVOICE_UPDATE);
  assertId(invoiceId, "invoice");

  try {
    return await prisma.$transaction(async (tx) => {
      const invoice = await lockInvoice(tx, invoiceId);
      if (invoice.status !== "DRAFT") {
        throw new BusinessRuleError("Only a draft invoice can be submitted.");
      }
      if (invoice.totalMinor <= 0n) {
        throw new BusinessRuleError(
          "Add lines with an amount before submitting the invoice.",
        );
      }
      const settings = await loadArSettings(tx);
      const needsApproval = approvalRequired(settings, invoice.totalMinor);
      const now = new Date();

      if (needsApproval) {
        await tx.erpArInvoice.update({
          where: { id: invoiceId },
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
            action: "erp.ar_invoice.submitted",
            module: ERP_MODULE,
            entityType: "ar_invoice",
            entityId: invoiceId,
            summary: "Submitted an invoice for approval",
          },
          tx,
        );
        return { status: "PENDING_APPROVAL" as const };
      }

      await tx.erpArInvoice.update({
        where: { id: invoiceId },
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
          action: "erp.ar_invoice.approved",
          module: ERP_MODULE,
          entityType: "ar_invoice",
          entityId: invoiceId,
          summary: "Submitted an invoice that needs no approval under AR settings",
          changes: { approvalSkipped: true },
        },
        tx,
      );
      await publish(tx, {
        name: ERP_EVENTS.AR_INVOICE_APPROVED,
        actorId: actor.id,
        correlationId: actor.correlationId ?? null,
        payload: {
          invoiceId,
          crmAccountId: invoice.crmAccountId,
          approvalSkipped: true,
        } satisfies ArInvoiceApprovedPayload,
      });
      return { status: "APPROVED" as const };
    });
  } catch (error) {
    throw asFinanceError(error);
  }
}

export async function approveInvoice(actor: Actor, invoiceId: string): Promise<void> {
  await requirePermission(actor, ERP_PERMISSIONS.AR_INVOICE_APPROVE);
  assertId(invoiceId, "invoice");

  try {
    await prisma.$transaction(async (tx) => {
      const invoice = await lockInvoice(tx, invoiceId);
      if (invoice.status !== "PENDING_APPROVAL") {
        throw new BusinessRuleError(
          "Only an invoice waiting for approval can be approved.",
        );
      }
      const settings = await loadArSettings(tx);
      // §13.3: self-approval is refused unless configuration explicitly allows it.
      if (
        !settings.allowSelfApproval &&
        (invoice.createdBy === actor.id || invoice.submittedBy === actor.id)
      ) {
        throw new BusinessRuleError(
          "You cannot approve an invoice you created or submitted.",
        );
      }

      await tx.erpArInvoice.update({
        where: { id: invoiceId },
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
          action: "erp.ar_invoice.approved",
          module: ERP_MODULE,
          entityType: "ar_invoice",
          entityId: invoiceId,
          summary: "Approved an invoice",
          severity: "NOTICE",
        },
        tx,
      );
      await publish(tx, {
        name: ERP_EVENTS.AR_INVOICE_APPROVED,
        actorId: actor.id,
        correlationId: actor.correlationId ?? null,
        payload: {
          invoiceId,
          crmAccountId: invoice.crmAccountId,
          approvalSkipped: false,
        } satisfies ArInvoiceApprovedPayload,
      });
    });
  } catch (error) {
    throw asFinanceError(error);
  }
}

export async function rejectInvoice(
  actor: Actor,
  invoiceId: string,
  input: unknown,
): Promise<void> {
  await requirePermission(actor, ERP_PERMISSIONS.AR_INVOICE_APPROVE);
  assertId(invoiceId, "invoice");
  const { reason } = parseInput(arReasonSchema, input);

  try {
    await prisma.$transaction(async (tx) => {
      const invoice = await lockInvoice(tx, invoiceId);
      if (invoice.status !== "PENDING_APPROVAL") {
        throw new BusinessRuleError(
          "Only an invoice waiting for approval can be rejected.",
        );
      }
      await tx.erpArInvoice.update({
        where: { id: invoiceId },
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
          action: "erp.ar_invoice.rejected",
          module: ERP_MODULE,
          entityType: "ar_invoice",
          entityId: invoiceId,
          summary: "Rejected an invoice and returned it to draft",
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

/* Posting ------------------------------------------------------------------------------ */

/**
 * Posts an approved invoice: numbers it, books Dr receivable / Cr revenue / Cr tax
 * through the ledger engine, marks it posted, audits and publishes — one transaction.
 * If any step fails, nothing happens: no number is used, no journal exists.
 */
export async function postInvoice(
  actor: Actor,
  invoiceId: string,
): Promise<{ invoiceNumber: string; journalNumber: string }> {
  await requirePermission(actor, ERP_PERMISSIONS.AR_INVOICE_POST);
  assertId(invoiceId, "invoice");

  try {
    return await prisma.$transaction(async (tx) => {
      const locked = await lockInvoice(tx, invoiceId);
      if (locked.status !== "APPROVED") {
        throw new BusinessRuleError(
          locked.status === "DRAFT" || locked.status === "PENDING_APPROVAL"
            ? "Submit and approve the invoice before posting it."
            : locked.status === "CANCELLED"
              ? "This invoice has been cancelled."
              : "This invoice is already posted.",
        );
      }
      const customer = customerFrom(
        await customerRefs([locked.crmAccountId]),
        locked.crmAccountId,
      );
      if (!customer.existsInCrm) {
        throw new BusinessRuleError("The customer no longer exists in CRM.");
      }

      const invoice = await tx.erpArInvoice.findUniqueOrThrow({
        where: { id: invoiceId },
        select: {
          invoiceDate: true,
          dueDate: true,
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
      const invoiceDate = isoDateOf(invoice.invoiceDate);
      const invoiceNumber = await nextDocumentNumber(tx, "AR_INVOICE", invoiceDate);

      // Dr receivable for the total; Cr each revenue account (by cost centre) with the
      // net amount; Cr each tax account with its tax.
      const revenue = new Map<string, LedgerLine>();
      const tax = new Map<string, LedgerLine>();
      for (const line of invoice.lines) {
        if (line.netMinor > 0n) {
          const key = `${line.revenueAccountId}|${line.costCentreId ?? ""}`;
          const entry = revenue.get(key) ?? {
            accountId: line.revenueAccountId,
            costCentreId: line.costCentreId,
            description: `Invoice ${invoiceNumber}`,
            debitMinor: 0n,
            creditMinor: 0n,
          };
          entry.creditMinor += line.netMinor;
          revenue.set(key, entry);
        }
        if (line.taxMinor > 0n && line.taxRate !== null) {
          const entry = tax.get(line.taxRate.taxAccountId) ?? {
            accountId: line.taxRate.taxAccountId,
            costCentreId: null,
            description: `Tax on invoice ${invoiceNumber}`,
            debitMinor: 0n,
            creditMinor: 0n,
          };
          entry.creditMinor += line.taxMinor;
          tax.set(line.taxRate.taxAccountId, entry);
        }
      }
      const journal = await recordPostedJournal(tx, actor, {
        entryDate: invoiceDate,
        description: `Customer invoice ${invoiceNumber}`,
        reference: invoiceNumber,
        source: { module: ERP_MODULE, type: SOURCE_TYPE, id: invoiceId },
        lines: [
          {
            accountId: invoice.receivableAccountId,
            costCentreId: null,
            description: `Invoice ${invoiceNumber}`,
            debitMinor: invoice.totalMinor,
            creditMinor: 0n,
          },
          ...revenue.values(),
          ...tax.values(),
        ],
      });

      await tx.erpArInvoice.update({
        where: { id: invoiceId },
        data: {
          status: "POSTED",
          invoiceNumber,
          journalEntryId: journal.id,
          fiscalPeriodId: journal.fiscalPeriodId,
          outstandingMinor: invoice.totalMinor,
          postedAt: new Date(),
          postedBy: actor.id,
          updatedBy: actor.id,
        },
      });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.ar_invoice.posted",
          module: ERP_MODULE,
          entityType: "ar_invoice",
          entityId: invoiceId,
          summary: `Posted invoice ${invoiceNumber} as journal entry ${journal.journalNumber}`,
          changes: {
            invoiceNumber,
            journalEntryId: journal.id,
            journalNumber: journal.journalNumber,
            fiscalPeriodId: journal.fiscalPeriodId,
          },
          severity: "NOTICE",
        },
        tx,
      );
      await publish(tx, {
        name: ERP_EVENTS.AR_INVOICE_POSTED,
        actorId: actor.id,
        correlationId: actor.correlationId ?? null,
        payload: {
          invoiceId,
          invoiceNumber,
          crmAccountId: locked.crmAccountId,
          invoiceDate,
          dueDate: isoDateOf(invoice.dueDate),
          journalEntryId: journal.id,
        } satisfies ArInvoicePostedPayload,
      });
      return { invoiceNumber, journalNumber: journal.journalNumber };
    }, AR_POSTING_TRANSACTION);
  } catch (error) {
    throw asFinanceError(error);
  }
}

/**
 * Cancels an invoice. Before posting it is simply cancelled; a posted, unpaid invoice
 * is voided by reversing its journal entry. A paid or part-paid invoice is refused.
 */
export async function cancelInvoice(
  actor: Actor,
  invoiceId: string,
  input: unknown,
): Promise<{ voidJournalNumber: string | null }> {
  await requirePermission(actor, ERP_PERMISSIONS.AR_INVOICE_CANCEL);
  assertId(invoiceId, "invoice");
  const data = parseInput(arCancelSchema, input);

  try {
    return await prisma.$transaction(async (tx) => {
      const invoice = await lockInvoice(tx, invoiceId);
      if (invoice.status === "CANCELLED") {
        throw new BusinessRuleError("This invoice is already cancelled.");
      }
      if (invoice.status === "PARTIALLY_PAID" || invoice.status === "PAID") {
        throw new BusinessRuleError(
          "Remove the receipt allocations from this invoice before voiding it.",
        );
      }

      let voidJournal: { id: string; journalNumber: string } | null = null;
      if (invoice.status === "POSTED" && invoice.journalEntryId !== null) {
        const reversal = await reverseJournalInTransaction(
          tx,
          actor,
          invoice.journalEntryId,
          {
            reversalDate: data.voidDate ?? todayIso(),
            description: `Void of invoice ${invoice.invoiceNumber ?? ""}: ${data.reason}`,
          },
        );
        voidJournal = { id: reversal.reversalId, journalNumber: reversal.journalNumber };
      }

      await tx.erpArInvoice.update({
        where: { id: invoiceId },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancelledBy: actor.id,
          cancelReason: data.reason,
          outstandingMinor: 0n,
          ...(voidJournal !== null ? { voidJournalEntryId: voidJournal.id } : {}),
          updatedBy: actor.id,
        },
      });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.ar_invoice.cancelled",
          module: ERP_MODULE,
          entityType: "ar_invoice",
          entityId: invoiceId,
          summary:
            voidJournal === null
              ? "Cancelled an unposted invoice"
              : `Voided invoice ${invoice.invoiceNumber ?? ""} with journal entry ${voidJournal.journalNumber}`,
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
        name: ERP_EVENTS.AR_INVOICE_CANCELLED,
        actorId: actor.id,
        correlationId: actor.correlationId ?? null,
        payload: {
          invoiceId,
          invoiceNumber: invoice.invoiceNumber,
          crmAccountId: invoice.crmAccountId,
          voidJournalEntryId: voidJournal?.id ?? null,
        } satisfies ArInvoiceCancelledPayload,
      });
      return { voidJournalNumber: voidJournal?.journalNumber ?? null };
    }, AR_POSTING_TRANSACTION);
  } catch (error) {
    throw asFinanceError(error);
  }
}
