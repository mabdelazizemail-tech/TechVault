import type { Prisma } from "@prisma/client";
import type { z } from "zod";
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
  type ApBillApprovedPayload,
  type ApBillCancelledPayload,
  type ApBillPostedPayload,
} from "../../../contracts/events";
import { ERP_PERMISSIONS } from "../../../contracts/permissions";
import {
  apBillDraftSchema,
  arCancelSchema,
  arListParamsSchema,
  arReasonSchema,
} from "../../../contracts/schemas";
import {
  AP_BILL_STATUSES,
  type ApBillDetail,
  type ApBillListItem,
  type OpenBillOption,
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
import { apBillListSelect } from "../../../repositories/ap-selects";
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
  isUniqueViolation,
  isoDateOf,
  parseInput,
  toAmount,
  toPerson,
  todayIso,
} from "../support";
import {
  AP_POSTING_TRANSACTION,
  loadApSettings,
  lockBill,
  requireActiveVendor,
  selfApprovalRefused,
  toBillListItem,
} from "./support";

/**
 * Vendor bills (ADR-033), the mirror of customer invoices.
 *
 * DRAFT → PENDING_APPROVAL → APPROVED → POSTED → PARTIALLY_PAID → PAID, or CANCELLED.
 * The server prices every line. Approval follows AP settings. Posting books Dr expense
 * (or asset), Dr input tax, Cr payable through the ledger engine in the transaction that
 * numbers the bill. A posted bill is corrected only by voiding it while it is unpaid.
 * The same supplier invoice number cannot be entered twice for one vendor.
 */

const PAGE_SIZE = 25;
const SOURCE_TYPE = "ap_bill";
const DUPLICATE_MESSAGE =
  "A bill with this supplier invoice number is already recorded for this vendor.";

type Draft = z.output<typeof apBillDraftSchema>;

/* Pricing ------------------------------------------------------------------------ */

/**
 * Prices every line on the server and checks each account, input tax rate and cost
 * centre. A tax rate is usable on a bill only once it names an input tax account.
 */
export async function priceBillLines(lines: Draft["lines"]) {
  const accountIds = [...new Set(lines.map((line) => line.expenseAccountId))];
  const taxIds = [
    ...new Set(
      lines.flatMap((line) => (line.taxRateId === null ? [] : [line.taxRateId])),
    ),
  ];
  const centreIds = [
    ...new Set(
      lines.flatMap((line) => (line.costCentreId === null ? [] : [line.costCentreId])),
    ),
  ];

  const [accounts, rates, centres] = await Promise.all([
    prisma.erpAccount.findMany({
      where: { id: { in: accountIds } },
      select: { id: true, code: true, type: true, isActive: true, isPostable: true },
    }),
    taxIds.length === 0
      ? Promise.resolve([])
      : prisma.erpTaxRate.findMany({
          where: { id: { in: taxIds } },
          select: {
            id: true,
            code: true,
            isActive: true,
            rateBasisPoints: true,
            inputTaxAccountId: true,
          },
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
  const rows = lines.map((line, index) => {
    const prefix = `lines.${index}`;
    const account = accountById.get(line.expenseAccountId);
    if (account === undefined) {
      errors[`${prefix}.expenseAccountId`] = ["Choose a valid expense account."];
    } else if (!account.isActive) {
      errors[`${prefix}.expenseAccountId`] = [`Account ${account.code} is inactive.`];
    } else if (!account.isPostable) {
      errors[`${prefix}.expenseAccountId`] = [
        `${account.code} is a heading and cannot take postings.`,
      ];
    } else if (account.type !== "EXPENSE" && account.type !== "ASSET") {
      errors[`${prefix}.expenseAccountId`] = [
        `${account.code} is not an expense or asset account.`,
      ];
    }

    const rate = line.taxRateId === null ? null : rateById.get(line.taxRateId);
    if (rate === undefined) {
      errors[`${prefix}.taxRateId`] = ["Choose a valid tax rate."];
    } else if (rate !== null && !rate.isActive) {
      errors[`${prefix}.taxRateId`] = [`Tax rate ${rate.code} is inactive.`];
    } else if (rate !== null && rate.inputTaxAccountId === null) {
      errors[`${prefix}.taxRateId`] = [
        `Tax rate ${rate.code} has no input tax account, so it cannot be used on bills. Set one in AR settings.`,
      ];
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
        expenseAccountId: line.expenseAccountId,
        costCentreId: line.costCentreId,
      },
    };
  });

  const totals = invoiceTotals(rows.map((row) => row.amounts));
  if (totals.totalMinor > MAX_DOCUMENT_AMOUNT_MINOR) {
    errors.lines = ["The bill total is too large."];
  }
  if (Object.keys(errors).length > 0) {
    throw new ValidationError("Please correct the highlighted lines.", errors);
  }
  return { lines: rows.map((row) => row.data), totals };
}

/* Reads -------------------------------------------------------------------------- */

export async function listBills(
  actor: Actor,
  rawParams: Record<string, unknown> = {},
): Promise<Paginated<ApBillListItem>> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AP_BILL_READ);
  const params = arListParamsSchema.parse(rawParams);
  const status = AP_BILL_STATUSES.find((value) => value === params.status);
  const range = (from?: string, to?: string) =>
    from === undefined && to === undefined
      ? undefined
      : {
          ...(from !== undefined ? { gte: dateFromIso(from) } : {}),
          ...(to !== undefined ? { lte: dateFromIso(to) } : {}),
        };

  const where: Prisma.ErpApBillWhereInput = {
    ...(status !== undefined ? { status } : {}),
    ...(params.vendor !== undefined ? { vendorId: params.vendor } : {}),
    ...(range(params.from, params.to) !== undefined
      ? { billDate: range(params.from, params.to) }
      : {}),
    ...(params.overdue === "1"
      ? { outstandingMinor: { gt: 0 }, dueDate: { lt: dateFromIso(todayIso()) } }
      : {}),
    ...(params.q !== undefined && params.q !== ""
      ? {
          OR: [
            { billNumber: { contains: params.q, mode: "insensitive" } },
            { vendorInvoiceNumber: { contains: params.q, mode: "insensitive" } },
            { reference: { contains: params.q, mode: "insensitive" } },
            { vendor: { name: { contains: params.q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const direction = params.dir;
  const orderBy: Prisma.ErpApBillOrderByWithRelationInput[] =
    params.sort === "due"
      ? [{ dueDate: direction }, { createdAt: "desc" }]
      : params.sort === "number"
        ? [{ billNumber: direction }]
        : params.sort === "total"
          ? [{ totalMinor: direction }, { createdAt: "desc" }]
          : params.sort === "outstanding"
            ? [{ outstandingMinor: direction }, { dueDate: "asc" }]
            : [{ billDate: direction }, { createdAt: "desc" }];

  const [total, rows] = await Promise.all([
    prisma.erpApBill.count({ where }),
    prisma.erpApBill.findMany({
      where,
      orderBy,
      skip: (params.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: apBillListSelect,
    }),
  ]);
  return {
    rows: rows.map(toBillListItem),
    total,
    page: params.page,
    pageSize: PAGE_SIZE,
  };
}

export async function getBill(actor: Actor, billId: string): Promise<ApBillDetail> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AP_BILL_READ);
  assertId(billId, "bill");

  const row = await prisma.erpApBill.findUnique({
    where: { id: billId },
    select: {
      ...apBillListSelect,
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
      payableAccount: { select: accountRefSelect },
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
          expenseAccount: { select: accountRefSelect },
          costCentre: { select: costCentreRefSelect },
        },
      },
      paymentLines: {
        where: { payment: { status: "POSTED" } },
        orderBy: { createdAt: "asc" },
        take: 200,
        select: {
          amountMinor: true,
          withheldMinor: true,
          cashMinor: true,
          payment: { select: { id: true, paymentNumber: true, paymentDate: true } },
        },
      },
    },
  });
  if (row === null) throw new NotFoundError("bill");

  return {
    ...toBillListItem(row),
    currency: row.currency,
    subtotalMinor: toAmount(row.subtotalMinor),
    discountMinor: toAmount(row.discountMinor),
    taxMinor: toAmount(row.taxMinor),
    reference: row.reference,
    notes: row.notes,
    payableAccount: row.payableAccount,
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
      expenseAccount: line.expenseAccount,
      costCentre: line.costCentre,
    })),
    settlements: row.paymentLines.map((line) => ({
      paymentId: line.payment.id,
      paymentNumber: line.payment.paymentNumber,
      paymentDate: isoDateOf(line.payment.paymentDate),
      amountMinor: toAmount(line.amountMinor),
      withheldMinor: toAmount(line.withheldMinor),
      cashMinor: toAmount(line.cashMinor),
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

/** Posted bills of a vendor that still owe something, oldest due first. */
export async function listOpenBills(
  actor: Actor,
  vendorId: string,
): Promise<OpenBillOption[]> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AP_PAYMENT_CREATE);
  assertId(vendorId, "vendor");
  const rows = await prisma.erpApBill.findMany({
    where: {
      vendorId,
      status: { in: ["POSTED", "PARTIALLY_PAID"] },
      outstandingMinor: { gt: 0 },
    },
    orderBy: [{ dueDate: "asc" }, { billNumber: "asc" }],
    take: 100,
    select: {
      id: true,
      billNumber: true,
      vendorInvoiceNumber: true,
      billDate: true,
      dueDate: true,
      subtotalMinor: true,
      discountMinor: true,
      totalMinor: true,
      outstandingMinor: true,
    },
  });
  return rows.map((row) => ({
    id: row.id,
    billNumber: row.billNumber ?? "",
    vendorInvoiceNumber: row.vendorInvoiceNumber,
    billDate: isoDateOf(row.billDate),
    dueDate: isoDateOf(row.dueDate),
    totalMinor: toAmount(row.totalMinor),
    outstandingMinor: toAmount(row.outstandingMinor),
    netMinor: toAmount(row.subtotalMinor - row.discountMinor),
  }));
}

/* Drafts -------------------------------------------------------------------------- */

async function prepareDraft(input: unknown) {
  const draft = parseInput(apBillDraftSchema, input);
  const settings = await loadApSettings();
  const vendor = await requireActiveVendor(draft.vendorId, settings);
  const priced = await priceBillLines(draft.lines);
  const dueDate = draft.dueDate ?? addDays(draft.billDate, vendor.paymentTermsDays);
  return { draft, priced, dueDate, payableAccountId: vendor.payableAccountId };
}

/** Raises the friendly duplicate message before the database refuses at insert. */
async function assertNotDuplicate(
  vendorId: string,
  vendorInvoiceNumber: string,
  exceptBillId: string | null,
): Promise<void> {
  const existing = await prisma.erpApBill.findFirst({
    where: {
      vendorId,
      vendorInvoiceNumber: { equals: vendorInvoiceNumber.trim(), mode: "insensitive" },
      status: { not: "CANCELLED" },
      ...(exceptBillId !== null ? { id: { not: exceptBillId } } : {}),
    },
    select: { id: true },
  });
  if (existing !== null) {
    throw new ValidationError(DUPLICATE_MESSAGE, {
      vendorInvoiceNumber: [DUPLICATE_MESSAGE],
    });
  }
}

function duplicateOr(error: unknown): unknown {
  return isUniqueViolation(error)
    ? new ConflictError(DUPLICATE_MESSAGE)
    : asFinanceError(error);
}

export async function createBill(actor: Actor, input: unknown): Promise<{ id: string }> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AP_BILL_CREATE);
  const { draft, priced, dueDate, payableAccountId } = await prepareDraft(input);
  await assertNotDuplicate(draft.vendorId, draft.vendorInvoiceNumber, null);

  try {
    return await prisma.$transaction(async (tx) => {
      const bill = await tx.erpApBill.create({
        data: {
          vendorId: draft.vendorId,
          vendorInvoiceNumber: draft.vendorInvoiceNumber,
          billDate: dateFromIso(draft.billDate),
          dueDate: dateFromIso(dueDate),
          reference: draft.reference,
          notes: draft.notes,
          payableAccountId,
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
          action: "erp.ap_bill.created",
          module: ERP_MODULE,
          entityType: "ap_bill",
          entityId: bill.id,
          summary: `Entered a draft bill ${draft.vendorInvoiceNumber} dated ${draft.billDate}`,
          changes: {
            vendorId: draft.vendorId,
            vendorInvoiceNumber: draft.vendorInvoiceNumber,
            billDate: draft.billDate,
            dueDate,
            lineCount: priced.lines.length,
          },
        },
        tx,
      );
      return bill;
    });
  } catch (error) {
    throw duplicateOr(error);
  }
}

export async function updateBill(
  actor: Actor,
  billId: string,
  input: unknown,
): Promise<{ id: string }> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AP_BILL_UPDATE);
  assertId(billId, "bill");
  const { draft, priced, dueDate, payableAccountId } = await prepareDraft(input);
  await assertNotDuplicate(draft.vendorId, draft.vendorInvoiceNumber, billId);

  try {
    await prisma.$transaction(async (tx) => {
      const bill = await lockBill(tx, billId);
      if (bill.status !== "DRAFT") {
        throw new BusinessRuleError(
          "Only a draft bill can be edited. A rejected bill returns to draft.",
        );
      }
      await tx.erpApBillLine.deleteMany({ where: { billId } });
      await tx.erpApBill.update({
        where: { id: billId },
        data: {
          vendorId: draft.vendorId,
          vendorInvoiceNumber: draft.vendorInvoiceNumber,
          billDate: dateFromIso(draft.billDate),
          dueDate: dateFromIso(dueDate),
          reference: draft.reference,
          notes: draft.notes,
          payableAccountId,
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
          action: "erp.ap_bill.updated",
          module: ERP_MODULE,
          entityType: "ap_bill",
          entityId: billId,
          summary: `Updated a draft bill ${draft.vendorInvoiceNumber}`,
          changes: {
            vendorId: draft.vendorId,
            vendorInvoiceNumber: draft.vendorInvoiceNumber,
            billDate: draft.billDate,
            dueDate,
            lineCount: priced.lines.length,
          },
        },
        tx,
      );
    });
  } catch (error) {
    throw duplicateOr(error);
  }
  return { id: billId };
}

export async function deleteBill(actor: Actor, billId: string): Promise<void> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AP_BILL_UPDATE);
  assertId(billId, "bill");
  try {
    await prisma.$transaction(async (tx) => {
      const bill = await lockBill(tx, billId);
      if (bill.status !== "DRAFT") {
        throw new BusinessRuleError(
          "Only a draft bill can be deleted. Cancel it instead.",
        );
      }
      await tx.erpApBill.delete({ where: { id: billId } });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.ap_bill.deleted",
          module: ERP_MODULE,
          entityType: "ap_bill",
          entityId: billId,
          summary: `Deleted a draft bill dated ${bill.billDate}`,
        },
        tx,
      );
    });
  } catch (error) {
    throw asFinanceError(error);
  }
}

/* Approval ------------------------------------------------------------------------- */

/** Sends a draft for approval — or approves it at once when AP settings need none. */
export async function submitBill(
  actor: Actor,
  billId: string,
): Promise<{ status: "PENDING_APPROVAL" | "APPROVED" }> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AP_BILL_UPDATE);
  assertId(billId, "bill");

  try {
    return await prisma.$transaction(async (tx) => {
      const bill = await lockBill(tx, billId);
      if (bill.status !== "DRAFT") {
        throw new BusinessRuleError("Only a draft bill can be submitted.");
      }
      if (bill.totalMinor <= 0n) {
        throw new BusinessRuleError(
          "Add lines with an amount before submitting the bill.",
        );
      }
      const settings = await loadApSettings(tx);
      const needsApproval = approvalRequired(
        {
          invoiceApprovalRequired: settings.billApprovalRequired,
          approvalThresholdMinor: settings.billApprovalThresholdMinor,
        },
        bill.totalMinor,
      );
      const now = new Date();

      if (needsApproval) {
        await tx.erpApBill.update({
          where: { id: billId },
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
            action: "erp.ap_bill.submitted",
            module: ERP_MODULE,
            entityType: "ap_bill",
            entityId: billId,
            summary: "Submitted a bill for approval",
          },
          tx,
        );
        return { status: "PENDING_APPROVAL" as const };
      }

      await tx.erpApBill.update({
        where: { id: billId },
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
          action: "erp.ap_bill.approved",
          module: ERP_MODULE,
          entityType: "ap_bill",
          entityId: billId,
          summary: "Submitted a bill that needs no approval under AP settings",
          changes: { approvalSkipped: true },
        },
        tx,
      );
      await publish(tx, {
        name: ERP_EVENTS.AP_BILL_APPROVED,
        actorId: actor.id,
        correlationId: actor.correlationId ?? null,
        payload: {
          billId,
          vendorId: bill.vendorId,
          approvalSkipped: true,
        } satisfies ApBillApprovedPayload,
      });
      return { status: "APPROVED" as const };
    });
  } catch (error) {
    throw asFinanceError(error);
  }
}

export async function approveBill(actor: Actor, billId: string): Promise<void> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AP_BILL_APPROVE);
  assertId(billId, "bill");

  try {
    await prisma.$transaction(async (tx) => {
      const bill = await lockBill(tx, billId);
      if (bill.status !== "PENDING_APPROVAL") {
        throw new BusinessRuleError("Only a bill waiting for approval can be approved.");
      }
      if (selfApprovalRefused(await loadApSettings(tx), bill, actor.id)) {
        throw new BusinessRuleError(
          "You cannot approve a bill you entered or submitted.",
        );
      }
      await tx.erpApBill.update({
        where: { id: billId },
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
          action: "erp.ap_bill.approved",
          module: ERP_MODULE,
          entityType: "ap_bill",
          entityId: billId,
          summary: "Approved a bill",
          severity: "NOTICE",
        },
        tx,
      );
      await publish(tx, {
        name: ERP_EVENTS.AP_BILL_APPROVED,
        actorId: actor.id,
        correlationId: actor.correlationId ?? null,
        payload: {
          billId,
          vendorId: bill.vendorId,
          approvalSkipped: false,
        } satisfies ApBillApprovedPayload,
      });
    });
  } catch (error) {
    throw asFinanceError(error);
  }
}

export async function rejectBill(
  actor: Actor,
  billId: string,
  input: unknown,
): Promise<void> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AP_BILL_APPROVE);
  assertId(billId, "bill");
  const { reason } = parseInput(arReasonSchema, input);

  try {
    await prisma.$transaction(async (tx) => {
      const bill = await lockBill(tx, billId);
      if (bill.status !== "PENDING_APPROVAL") {
        throw new BusinessRuleError("Only a bill waiting for approval can be rejected.");
      }
      await tx.erpApBill.update({
        where: { id: billId },
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
          action: "erp.ap_bill.rejected",
          module: ERP_MODULE,
          entityType: "ap_bill",
          entityId: billId,
          summary: "Rejected a bill and returned it to draft",
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
 * Posts an approved bill: numbers it, books Dr expense by account and cost centre,
 * Dr input tax, Cr payable, marks it posted, audits and publishes — one transaction.
 */
export async function postBill(
  actor: Actor,
  billId: string,
): Promise<{ billNumber: string; journalNumber: string }> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AP_BILL_POST);
  assertId(billId, "bill");

  try {
    return await prisma.$transaction(async (tx) => {
      const locked = await lockBill(tx, billId);
      if (locked.status !== "APPROVED") {
        throw new BusinessRuleError(
          locked.status === "DRAFT" || locked.status === "PENDING_APPROVAL"
            ? "Submit and approve the bill before posting it."
            : locked.status === "CANCELLED"
              ? "This bill has been cancelled."
              : "This bill is already posted.",
        );
      }

      const bill = await tx.erpApBill.findUniqueOrThrow({
        where: { id: billId },
        select: {
          billDate: true,
          dueDate: true,
          totalMinor: true,
          payableAccountId: true,
          vendorInvoiceNumber: true,
          vendor: { select: { name: true } },
          lines: {
            orderBy: { lineNo: "asc" },
            select: {
              netMinor: true,
              taxMinor: true,
              expenseAccountId: true,
              costCentreId: true,
              taxRate: { select: { code: true, inputTaxAccountId: true } },
            },
          },
        },
      });
      const billDate = isoDateOf(bill.billDate);
      const billNumber = await nextDocumentNumber(tx, "AP_BILL", billDate);
      const label = `Bill ${billNumber} (${bill.vendor.name} ${bill.vendorInvoiceNumber})`;

      const expense = new Map<string, LedgerLine>();
      const tax = new Map<string, LedgerLine>();
      for (const line of bill.lines) {
        if (line.netMinor > 0n) {
          const key = `${line.expenseAccountId}|${line.costCentreId ?? ""}`;
          const entry = expense.get(key) ?? {
            accountId: line.expenseAccountId,
            costCentreId: line.costCentreId,
            description: label,
            debitMinor: 0n,
            creditMinor: 0n,
          };
          entry.debitMinor += line.netMinor;
          expense.set(key, entry);
        }
        if (line.taxMinor > 0n && line.taxRate !== null) {
          const accountId = line.taxRate.inputTaxAccountId;
          if (accountId === null) {
            throw new BusinessRuleError(
              `Tax rate ${line.taxRate.code} no longer has an input tax account. Set one in AR settings before posting.`,
            );
          }
          const entry = tax.get(accountId) ?? {
            accountId,
            costCentreId: null,
            description: `Input tax on bill ${billNumber}`,
            debitMinor: 0n,
            creditMinor: 0n,
          };
          entry.debitMinor += line.taxMinor;
          tax.set(accountId, entry);
        }
      }
      const journal = await recordPostedJournal(tx, actor, {
        entryDate: billDate,
        description: `Vendor bill ${billNumber}`,
        reference: billNumber,
        source: { module: ERP_MODULE, type: SOURCE_TYPE, id: billId },
        lines: [
          ...expense.values(),
          ...tax.values(),
          {
            accountId: bill.payableAccountId,
            costCentreId: null,
            description: label,
            debitMinor: 0n,
            creditMinor: bill.totalMinor,
          },
        ],
      });

      await tx.erpApBill.update({
        where: { id: billId },
        data: {
          status: "POSTED",
          billNumber,
          journalEntryId: journal.id,
          fiscalPeriodId: journal.fiscalPeriodId,
          outstandingMinor: bill.totalMinor,
          postedAt: new Date(),
          postedBy: actor.id,
          updatedBy: actor.id,
        },
      });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.ap_bill.posted",
          module: ERP_MODULE,
          entityType: "ap_bill",
          entityId: billId,
          summary: `Posted bill ${billNumber} as journal entry ${journal.journalNumber}`,
          changes: {
            billNumber,
            journalEntryId: journal.id,
            journalNumber: journal.journalNumber,
            fiscalPeriodId: journal.fiscalPeriodId,
          },
          severity: "NOTICE",
        },
        tx,
      );
      await publish(tx, {
        name: ERP_EVENTS.AP_BILL_POSTED,
        actorId: actor.id,
        correlationId: actor.correlationId ?? null,
        payload: {
          billId,
          billNumber,
          vendorId: locked.vendorId,
          billDate,
          dueDate: isoDateOf(bill.dueDate),
          journalEntryId: journal.id,
        } satisfies ApBillPostedPayload,
      });
      return { billNumber, journalNumber: journal.journalNumber };
    }, AP_POSTING_TRANSACTION);
  } catch (error) {
    throw asFinanceError(error);
  }
}

/**
 * Cancels a bill. Before posting it is simply cancelled; a posted, unpaid bill is
 * voided by reversing its journal entry. A paid or part-paid bill is refused.
 */
export async function cancelBill(
  actor: Actor,
  billId: string,
  input: unknown,
): Promise<{ voidJournalNumber: string | null }> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AP_BILL_CANCEL);
  assertId(billId, "bill");
  const data = parseInput(arCancelSchema, input);

  try {
    return await prisma.$transaction(async (tx) => {
      const bill = await lockBill(tx, billId);
      if (bill.status === "CANCELLED") {
        throw new BusinessRuleError("This bill is already cancelled.");
      }
      if (bill.status === "PARTIALLY_PAID" || bill.status === "PAID") {
        throw new BusinessRuleError(
          "Void the payments against this bill before voiding it.",
        );
      }

      let voidJournal: { id: string; journalNumber: string } | null = null;
      if (bill.status === "POSTED" && bill.journalEntryId !== null) {
        const reversal = await reverseJournalInTransaction(
          tx,
          actor,
          bill.journalEntryId,
          {
            reversalDate: data.voidDate ?? todayIso(),
            description: `Void of bill ${bill.billNumber ?? ""}: ${data.reason}`,
          },
        );
        voidJournal = { id: reversal.reversalId, journalNumber: reversal.journalNumber };
      }

      await tx.erpApBill.update({
        where: { id: billId },
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
          action: "erp.ap_bill.cancelled",
          module: ERP_MODULE,
          entityType: "ap_bill",
          entityId: billId,
          summary:
            voidJournal === null
              ? "Cancelled an unposted bill"
              : `Voided bill ${bill.billNumber ?? ""} with journal entry ${voidJournal.journalNumber}`,
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
        name: ERP_EVENTS.AP_BILL_CANCELLED,
        actorId: actor.id,
        correlationId: actor.correlationId ?? null,
        payload: {
          billId,
          billNumber: bill.billNumber,
          vendorId: bill.vendorId,
          voidJournalEntryId: voidJournal?.id ?? null,
        } satisfies ApBillCancelledPayload,
      });
      return { voidJournalNumber: voidJournal?.journalNumber ?? null };
    }, AP_POSTING_TRANSACTION);
  } catch (error) {
    throw asFinanceError(error);
  }
}
