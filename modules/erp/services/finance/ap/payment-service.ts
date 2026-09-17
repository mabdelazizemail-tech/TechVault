import type { Prisma } from "@prisma/client";
import { BusinessRuleError, NotFoundError, ValidationError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/platform/audit/audit";
import { type Actor, requireGlobalPermission } from "@/platform/authz/authz";
import { publish } from "@/platform/events/publish";
import {
  ERP_EVENTS,
  type ApPaymentApprovedPayload,
  type ApPaymentCancelledPayload,
  type ApPaymentPostedPayload,
} from "../../../contracts/events";
import { ERP_PERMISSIONS } from "../../../contracts/permissions";
import {
  apPaymentDraftSchema,
  arCancelSchema,
  arListParamsSchema,
  arReasonSchema,
} from "../../../contracts/schemas";
import {
  AP_PAYMENT_STATUSES,
  type ApPaymentDetail,
  type ApPaymentListItem,
  type Paginated,
} from "../../../contracts/types";
import { calculatePaymentLine, paymentTotals } from "../../../domain/ap";
import { MAX_DOCUMENT_AMOUNT_MINOR, approvalRequired } from "../../../domain/ar";
import { formatMinorAmount } from "../../../domain/journal";
import { apPaymentListSelect } from "../../../repositories/ap-selects";
import { accountRefSelect, personSelect } from "../../../repositories/selects";
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
import { requireAccount } from "../ar/support";
import {
  AP_POSTING_TRANSACTION,
  POSTED_BILL_STATUSES,
  loadApSettings,
  lockPayment,
  requireActiveVendor,
  selfApprovalRefused,
  toPaymentListItem,
} from "./support";

/**
 * Supplier payments (ADR-033).
 *
 * DRAFT → PENDING_APPROVAL → APPROVED → POSTED, or CANCELLED. A payment settles named
 * posted bills of one vendor. On each line the server calculates the tax to withhold —
 * the line's rate on the VAT-exclusive part of the amount — so the vendor receives
 * amount − withheld and the rest is owed to the tax authority. Money leaving the
 * company gets its own maker–checker under AP settings, separate from the bill's.
 *
 * Posting books Dr payable (amount settled), Cr bank (cash), Cr each withholding tax
 * payable account, numbers the payment, and — through the database's settlement
 * trigger — reduces what each bill owes. Voiding reverses the entry and the bills owe
 * again.
 */

const PAGE_SIZE = 25;
const SOURCE_TYPE = "ap_payment";

/* Reads -------------------------------------------------------------------------- */

export async function listPayments(
  actor: Actor,
  rawParams: Record<string, unknown> = {},
): Promise<Paginated<ApPaymentListItem>> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AP_PAYMENT_READ);
  const params = arListParamsSchema.parse(rawParams);
  const status = AP_PAYMENT_STATUSES.find((value) => value === params.status);

  const where: Prisma.ErpApPaymentWhereInput = {
    ...(status !== undefined ? { status } : {}),
    ...(params.vendor !== undefined ? { vendorId: params.vendor } : {}),
    ...(params.from !== undefined || params.to !== undefined
      ? {
          paymentDate: {
            ...(params.from !== undefined ? { gte: dateFromIso(params.from) } : {}),
            ...(params.to !== undefined ? { lte: dateFromIso(params.to) } : {}),
          },
        }
      : {}),
    ...(params.q !== undefined && params.q !== ""
      ? {
          OR: [
            { paymentNumber: { contains: params.q, mode: "insensitive" } },
            { reference: { contains: params.q, mode: "insensitive" } },
            { vendor: { name: { contains: params.q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const direction = params.dir;
  const orderBy: Prisma.ErpApPaymentOrderByWithRelationInput[] =
    params.sort === "number"
      ? [{ paymentNumber: direction }]
      : params.sort === "amount" || params.sort === "total"
        ? [{ amountMinor: direction }, { createdAt: "desc" }]
        : [{ paymentDate: direction }, { createdAt: "desc" }];

  const [total, rows] = await Promise.all([
    prisma.erpApPayment.count({ where }),
    prisma.erpApPayment.findMany({
      where,
      orderBy,
      skip: (params.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: apPaymentListSelect,
    }),
  ]);
  return {
    rows: rows.map(toPaymentListItem),
    total,
    page: params.page,
    pageSize: PAGE_SIZE,
  };
}

export async function getPayment(
  actor: Actor,
  paymentId: string,
): Promise<ApPaymentDetail> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AP_PAYMENT_READ);
  assertId(paymentId, "payment");

  const row = await prisma.erpApPayment.findUnique({
    where: { id: paymentId },
    select: {
      ...apPaymentListSelect,
      currency: true,
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
      bankAccount: { select: accountRefSelect },
      payableAccount: { select: accountRefSelect },
      period: { select: { id: true, name: true, status: true } },
      journalEntry: { select: { id: true, journalNumber: true } },
      voidJournalEntry: { select: { id: true, journalNumber: true } },
      lines: {
        orderBy: { lineNo: "asc" },
        select: {
          id: true,
          lineNo: true,
          amountMinor: true,
          withholdingBasisPoints: true,
          withholdingBaseMinor: true,
          withheldMinor: true,
          cashMinor: true,
          withholdingTaxRate: { select: { id: true, code: true, name: true } },
          bill: {
            select: {
              id: true,
              billNumber: true,
              vendorInvoiceNumber: true,
              dueDate: true,
              totalMinor: true,
              outstandingMinor: true,
            },
          },
        },
      },
    },
  });
  if (row === null) throw new NotFoundError("payment");

  return {
    ...toPaymentListItem(row),
    currency: row.currency,
    reference: row.reference,
    notes: row.notes,
    bankAccount: row.bankAccount,
    payableAccount: row.payableAccount,
    period: row.period,
    journal: row.journalEntry,
    voidJournal: row.voidJournalEntry,
    lines: row.lines.map((line) => ({
      id: line.id,
      lineNo: line.lineNo,
      bill: {
        id: line.bill.id,
        billNumber: line.bill.billNumber,
        vendorInvoiceNumber: line.bill.vendorInvoiceNumber,
        dueDate: isoDateOf(line.bill.dueDate),
        totalMinor: toAmount(line.bill.totalMinor),
        outstandingMinor: toAmount(line.bill.outstandingMinor),
      },
      amountMinor: toAmount(line.amountMinor),
      withholdingTaxRate: line.withholdingTaxRate,
      withholdingBasisPoints: line.withholdingBasisPoints,
      withholdingBaseMinor: toAmount(line.withholdingBaseMinor),
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

/* Drafts -------------------------------------------------------------------------- */

/**
 * Validates a draft against the vendor's open bills and calculates every line:
 * what it settles, the tax withheld and the cash paid. Amounts sent by the browser
 * for withholding or cash are never read — only the amount settled and the rate.
 */
async function prepareDraft(input: unknown, excludePaymentId: string | null) {
  const draft = parseInput(apPaymentDraftSchema, input);
  const settings = await loadApSettings();
  const vendor = await requireActiveVendor(draft.vendorId, settings);
  await requireAccount(draft.bankAccountId, ["ASSET"], "bankAccountId");

  const billIds = draft.lines.map((line) => line.billId);
  const rateIds = [
    ...new Set(
      draft.lines.flatMap((line) =>
        line.withholdingTaxRateId === null ? [] : [line.withholdingTaxRateId],
      ),
    ),
  ];
  const [method, bills, rates, committed] = await Promise.all([
    prisma.erpPaymentMethod.findUnique({
      where: { id: draft.paymentMethodId },
      select: { isActive: true },
    }),
    prisma.erpApBill.findMany({
      where: { id: { in: billIds } },
      select: {
        id: true,
        billNumber: true,
        vendorId: true,
        status: true,
        payableAccountId: true,
        subtotalMinor: true,
        discountMinor: true,
        totalMinor: true,
        outstandingMinor: true,
      },
    }),
    rateIds.length === 0
      ? Promise.resolve([])
      : prisma.erpWithholdingTaxRate.findMany({
          where: { id: { in: rateIds } },
          select: { id: true, code: true, isActive: true, rateBasisPoints: true },
        }),
    // Other payments already on their way for these bills: counted against what the
    // bill owes, so two drafts cannot together promise more than it is due.
    prisma.erpApPaymentLine.groupBy({
      by: ["billId"],
      where: {
        billId: { in: billIds },
        payment: {
          status: { in: ["DRAFT", "PENDING_APPROVAL", "APPROVED"] },
          ...(excludePaymentId !== null ? { id: { not: excludePaymentId } } : {}),
        },
      },
      _sum: { amountMinor: true },
    }),
  ]);

  if (method === null || !method.isActive) {
    throw new ValidationError("Please correct the highlighted fields.", {
      paymentMethodId: ["Choose an active payment method."],
    });
  }

  const billById = new Map(bills.map((bill) => [bill.id, bill]));
  const rateById = new Map(rates.map((rate) => [rate.id, rate]));
  const pendingByBill = new Map(
    committed.map((group) => [group.billId, group._sum.amountMinor ?? 0n]),
  );
  const errors: Record<string, string[]> = {};

  const lines = draft.lines.map((line, index) => {
    const prefix = `lines.${index}`;
    const bill = billById.get(line.billId);
    const rate =
      line.withholdingTaxRateId === null ? null : rateById.get(line.withholdingTaxRateId);

    if (bill === undefined) {
      errors[`${prefix}.billId`] = ["Choose a valid bill."];
    } else if (bill.vendorId !== draft.vendorId) {
      errors[`${prefix}.billId`] = ["This bill belongs to another vendor."];
    } else if (!(POSTED_BILL_STATUSES as readonly string[]).includes(bill.status)) {
      errors[`${prefix}.billId`] = ["Only a posted bill can be paid."];
    } else if (bill.payableAccountId !== vendor.payableAccountId) {
      errors[`${prefix}.billId`] = [
        "This bill uses a different payable account from the vendor's; pay it separately after correcting the vendor.",
      ];
    } else {
      const available = bill.outstandingMinor - (pendingByBill.get(bill.id) ?? 0n);
      if (line.amount > available) {
        errors[`${prefix}.amount`] = [
          available <= 0n
            ? `Bill ${bill.billNumber ?? ""} is already fully paid or covered by another payment in progress.`
            : `Bill ${bill.billNumber ?? ""} has ${formatMinorAmount(available)} EGP left to pay, counting payments in progress.`,
        ];
      }
    }
    if (rate === undefined) {
      errors[`${prefix}.withholdingTaxRateId`] = ["Choose a valid withholding rate."];
    } else if (rate !== null && !rate.isActive) {
      errors[`${prefix}.withholdingTaxRateId`] = [
        `Withholding rate ${rate.code} is inactive.`,
      ];
    }

    const amounts = calculatePaymentLine({
      amountMinor: line.amount,
      billNetMinor: bill === undefined ? 0n : bill.subtotalMinor - bill.discountMinor,
      billTotalMinor: bill?.totalMinor ?? 0n,
      withholdingBasisPoints: rate?.rateBasisPoints ?? null,
    });
    return {
      amounts,
      data: {
        lineNo: index + 1,
        billId: line.billId,
        amountMinor: amounts.amountMinor,
        withholdingTaxRateId: rate?.id ?? null,
        withholdingBasisPoints: rate?.rateBasisPoints ?? null,
        withholdingBaseMinor: amounts.withholdingBaseMinor,
        withheldMinor: amounts.withheldMinor,
        cashMinor: amounts.cashMinor,
      },
    };
  });

  const totals = paymentTotals(lines.map((line) => line.amounts));
  if (totals.amountMinor > MAX_DOCUMENT_AMOUNT_MINOR) {
    errors.lines = ["The payment total is too large."];
  }
  if (Object.keys(errors).length > 0) {
    throw new ValidationError("Please correct the highlighted lines.", errors);
  }
  return {
    draft,
    payableAccountId: vendor.payableAccountId,
    lines: lines.map((line) => line.data),
    totals,
  };
}

export async function createPayment(
  actor: Actor,
  input: unknown,
): Promise<{ id: string }> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AP_PAYMENT_CREATE);
  const prepared = await prepareDraft(input, null);
  const { draft } = prepared;

  try {
    return await prisma.$transaction(async (tx) => {
      const payment = await tx.erpApPayment.create({
        data: {
          vendorId: draft.vendorId,
          paymentDate: dateFromIso(draft.paymentDate),
          paymentMethodId: draft.paymentMethodId,
          bankAccountId: draft.bankAccountId,
          payableAccountId: prepared.payableAccountId,
          reference: draft.reference,
          notes: draft.notes,
          amountMinor: prepared.totals.amountMinor,
          withheldMinor: prepared.totals.withheldMinor,
          cashMinor: prepared.totals.cashMinor,
          createdBy: actor.id,
          updatedBy: actor.id,
          lines: { create: prepared.lines },
        },
        select: { id: true },
      });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.ap_payment.created",
          module: ERP_MODULE,
          entityType: "ap_payment",
          entityId: payment.id,
          summary: `Prepared a draft payment dated ${draft.paymentDate}`,
          changes: {
            vendorId: draft.vendorId,
            paymentDate: draft.paymentDate,
            billCount: prepared.lines.length,
            amountMinor: prepared.totals.amountMinor.toString(),
            withheldMinor: prepared.totals.withheldMinor.toString(),
          },
        },
        tx,
      );
      return payment;
    });
  } catch (error) {
    throw asFinanceError(error);
  }
}

export async function updatePayment(
  actor: Actor,
  paymentId: string,
  input: unknown,
): Promise<{ id: string }> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AP_PAYMENT_UPDATE);
  assertId(paymentId, "payment");
  const prepared = await prepareDraft(input, paymentId);
  const { draft } = prepared;

  try {
    await prisma.$transaction(async (tx) => {
      const payment = await lockPayment(tx, paymentId);
      if (payment.status !== "DRAFT") {
        throw new BusinessRuleError(
          "Only a draft payment can be edited. A rejected payment returns to draft.",
        );
      }
      await tx.erpApPaymentLine.deleteMany({ where: { paymentId } });
      await tx.erpApPayment.update({
        where: { id: paymentId },
        data: {
          vendorId: draft.vendorId,
          paymentDate: dateFromIso(draft.paymentDate),
          paymentMethodId: draft.paymentMethodId,
          bankAccountId: draft.bankAccountId,
          payableAccountId: prepared.payableAccountId,
          reference: draft.reference,
          notes: draft.notes,
          amountMinor: prepared.totals.amountMinor,
          withheldMinor: prepared.totals.withheldMinor,
          cashMinor: prepared.totals.cashMinor,
          updatedBy: actor.id,
          lines: { create: prepared.lines },
        },
      });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.ap_payment.updated",
          module: ERP_MODULE,
          entityType: "ap_payment",
          entityId: paymentId,
          summary: `Updated a draft payment dated ${draft.paymentDate}`,
          changes: {
            vendorId: draft.vendorId,
            billCount: prepared.lines.length,
            amountMinor: prepared.totals.amountMinor.toString(),
            withheldMinor: prepared.totals.withheldMinor.toString(),
          },
        },
        tx,
      );
    });
  } catch (error) {
    throw asFinanceError(error);
  }
  return { id: paymentId };
}

export async function deletePayment(actor: Actor, paymentId: string): Promise<void> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AP_PAYMENT_UPDATE);
  assertId(paymentId, "payment");
  try {
    await prisma.$transaction(async (tx) => {
      const payment = await lockPayment(tx, paymentId);
      if (payment.status !== "DRAFT") {
        throw new BusinessRuleError(
          "Only a draft payment can be deleted. Cancel it instead.",
        );
      }
      await tx.erpApPayment.delete({ where: { id: paymentId } });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.ap_payment.deleted",
          module: ERP_MODULE,
          entityType: "ap_payment",
          entityId: paymentId,
          summary: `Deleted a draft payment dated ${payment.paymentDate}`,
        },
        tx,
      );
    });
  } catch (error) {
    throw asFinanceError(error);
  }
}

/* Approval ------------------------------------------------------------------------- */

export async function submitPayment(
  actor: Actor,
  paymentId: string,
): Promise<{ status: "PENDING_APPROVAL" | "APPROVED" }> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AP_PAYMENT_UPDATE);
  assertId(paymentId, "payment");

  try {
    return await prisma.$transaction(async (tx) => {
      const payment = await lockPayment(tx, paymentId);
      if (payment.status !== "DRAFT") {
        throw new BusinessRuleError("Only a draft payment can be submitted.");
      }
      if (payment.amountMinor <= 0n) {
        throw new BusinessRuleError(
          "Choose the bills to pay before submitting the payment.",
        );
      }
      const settings = await loadApSettings(tx);
      const needsApproval = approvalRequired(
        {
          invoiceApprovalRequired: settings.paymentApprovalRequired,
          approvalThresholdMinor: settings.paymentApprovalThresholdMinor,
        },
        payment.amountMinor,
      );
      const now = new Date();

      if (needsApproval) {
        await tx.erpApPayment.update({
          where: { id: paymentId },
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
            action: "erp.ap_payment.submitted",
            module: ERP_MODULE,
            entityType: "ap_payment",
            entityId: paymentId,
            summary: "Submitted a payment for approval",
          },
          tx,
        );
        return { status: "PENDING_APPROVAL" as const };
      }

      await tx.erpApPayment.update({
        where: { id: paymentId },
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
          action: "erp.ap_payment.approved",
          module: ERP_MODULE,
          entityType: "ap_payment",
          entityId: paymentId,
          summary: "Submitted a payment that needs no approval under AP settings",
          changes: { approvalSkipped: true },
        },
        tx,
      );
      await publish(tx, {
        name: ERP_EVENTS.AP_PAYMENT_APPROVED,
        actorId: actor.id,
        correlationId: actor.correlationId ?? null,
        payload: {
          paymentId,
          vendorId: payment.vendorId,
          approvalSkipped: true,
        } satisfies ApPaymentApprovedPayload,
      });
      return { status: "APPROVED" as const };
    });
  } catch (error) {
    throw asFinanceError(error);
  }
}

export async function approvePayment(actor: Actor, paymentId: string): Promise<void> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AP_PAYMENT_APPROVE);
  assertId(paymentId, "payment");

  try {
    await prisma.$transaction(async (tx) => {
      const payment = await lockPayment(tx, paymentId);
      if (payment.status !== "PENDING_APPROVAL") {
        throw new BusinessRuleError(
          "Only a payment waiting for approval can be approved.",
        );
      }
      if (selfApprovalRefused(await loadApSettings(tx), payment, actor.id)) {
        throw new BusinessRuleError(
          "You cannot approve a payment you prepared or submitted.",
        );
      }
      await tx.erpApPayment.update({
        where: { id: paymentId },
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
          action: "erp.ap_payment.approved",
          module: ERP_MODULE,
          entityType: "ap_payment",
          entityId: paymentId,
          summary: "Approved a payment",
          severity: "NOTICE",
        },
        tx,
      );
      await publish(tx, {
        name: ERP_EVENTS.AP_PAYMENT_APPROVED,
        actorId: actor.id,
        correlationId: actor.correlationId ?? null,
        payload: {
          paymentId,
          vendorId: payment.vendorId,
          approvalSkipped: false,
        } satisfies ApPaymentApprovedPayload,
      });
    });
  } catch (error) {
    throw asFinanceError(error);
  }
}

export async function rejectPayment(
  actor: Actor,
  paymentId: string,
  input: unknown,
): Promise<void> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AP_PAYMENT_APPROVE);
  assertId(paymentId, "payment");
  const { reason } = parseInput(arReasonSchema, input);

  try {
    await prisma.$transaction(async (tx) => {
      const payment = await lockPayment(tx, paymentId);
      if (payment.status !== "PENDING_APPROVAL") {
        throw new BusinessRuleError(
          "Only a payment waiting for approval can be rejected.",
        );
      }
      await tx.erpApPayment.update({
        where: { id: paymentId },
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
          action: "erp.ap_payment.rejected",
          module: ERP_MODULE,
          entityType: "ap_payment",
          entityId: paymentId,
          summary: "Rejected a payment and returned it to draft",
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

export async function postPayment(
  actor: Actor,
  paymentId: string,
): Promise<{ paymentNumber: string; journalNumber: string }> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AP_PAYMENT_POST);
  assertId(paymentId, "payment");

  try {
    return await prisma.$transaction(async (tx) => {
      const locked = await lockPayment(tx, paymentId);
      if (locked.status !== "APPROVED") {
        throw new BusinessRuleError(
          locked.status === "DRAFT" || locked.status === "PENDING_APPROVAL"
            ? "Submit and approve the payment before posting it."
            : locked.status === "CANCELLED"
              ? "This payment has been cancelled."
              : "This payment is already posted.",
        );
      }

      const payment = await tx.erpApPayment.findUniqueOrThrow({
        where: { id: paymentId },
        select: {
          paymentDate: true,
          amountMinor: true,
          cashMinor: true,
          bankAccountId: true,
          payableAccountId: true,
          vendor: { select: { name: true } },
          lines: {
            orderBy: { lineNo: "asc" },
            select: {
              billId: true,
              withheldMinor: true,
              withholdingTaxRate: { select: { payableAccountId: true } },
            },
          },
        },
      });
      const paymentDate = isoDateOf(payment.paymentDate);
      const paymentNumber = await nextDocumentNumber(tx, "AP_PAYMENT", paymentDate);
      const label = `Payment ${paymentNumber} to ${payment.vendor.name}`;

      const withholding = new Map<string, LedgerLine>();
      for (const line of payment.lines) {
        if (line.withheldMinor > 0n && line.withholdingTaxRate !== null) {
          const accountId = line.withholdingTaxRate.payableAccountId;
          const entry = withholding.get(accountId) ?? {
            accountId,
            costCentreId: null,
            description: `Tax withheld on payment ${paymentNumber}`,
            debitMinor: 0n,
            creditMinor: 0n,
          };
          entry.creditMinor += line.withheldMinor;
          withholding.set(accountId, entry);
        }
      }
      const journal = await recordPostedJournal(tx, actor, {
        entryDate: paymentDate,
        description: `Supplier payment ${paymentNumber}`,
        reference: paymentNumber,
        source: { module: ERP_MODULE, type: SOURCE_TYPE, id: paymentId },
        lines: [
          {
            accountId: payment.payableAccountId,
            costCentreId: null,
            description: label,
            debitMinor: payment.amountMinor,
            creditMinor: 0n,
          },
          ...(payment.cashMinor > 0n
            ? [
                {
                  accountId: payment.bankAccountId,
                  costCentreId: null,
                  description: label,
                  debitMinor: 0n,
                  creditMinor: payment.cashMinor,
                },
              ]
            : []),
          ...withholding.values(),
        ],
      });

      // The settlement trigger applies each line to its bill when the status changes.
      await tx.erpApPayment.update({
        where: { id: paymentId },
        data: {
          status: "POSTED",
          paymentNumber,
          journalEntryId: journal.id,
          fiscalPeriodId: journal.fiscalPeriodId,
          postedAt: new Date(),
          postedBy: actor.id,
          updatedBy: actor.id,
        },
      });
      const billIds = payment.lines.map((line) => line.billId);
      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.ap_payment.posted",
          module: ERP_MODULE,
          entityType: "ap_payment",
          entityId: paymentId,
          summary: `Posted payment ${paymentNumber} as journal entry ${journal.journalNumber}`,
          changes: {
            paymentNumber,
            journalEntryId: journal.id,
            journalNumber: journal.journalNumber,
            billIds,
          },
          severity: "NOTICE",
        },
        tx,
      );
      await publish(tx, {
        name: ERP_EVENTS.AP_PAYMENT_POSTED,
        actorId: actor.id,
        correlationId: actor.correlationId ?? null,
        payload: {
          paymentId,
          paymentNumber,
          vendorId: locked.vendorId,
          paymentDate,
          billIds,
          journalEntryId: journal.id,
        } satisfies ApPaymentPostedPayload,
      });
      return { paymentNumber, journalNumber: journal.journalNumber };
    }, AP_POSTING_TRANSACTION);
  } catch (error) {
    throw asFinanceError(error);
  }
}

/**
 * Cancels a payment. Before posting it is simply cancelled; a posted payment is voided
 * by reversing its journal entry, and its bills owe the amount again.
 */
export async function cancelPayment(
  actor: Actor,
  paymentId: string,
  input: unknown,
): Promise<{ voidJournalNumber: string | null }> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AP_PAYMENT_CANCEL);
  assertId(paymentId, "payment");
  const data = parseInput(arCancelSchema, input);

  try {
    return await prisma.$transaction(async (tx) => {
      const payment = await lockPayment(tx, paymentId);
      if (payment.status === "CANCELLED") {
        throw new BusinessRuleError("This payment is already cancelled.");
      }

      let voidJournal: { id: string; journalNumber: string } | null = null;
      if (payment.status === "POSTED" && payment.journalEntryId !== null) {
        const reversal = await reverseJournalInTransaction(
          tx,
          actor,
          payment.journalEntryId,
          {
            reversalDate: data.voidDate ?? todayIso(),
            description: `Void of payment ${payment.paymentNumber ?? ""}: ${data.reason}`,
          },
        );
        voidJournal = { id: reversal.reversalId, journalNumber: reversal.journalNumber };
      }

      await tx.erpApPayment.update({
        where: { id: paymentId },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancelledBy: actor.id,
          cancelReason: data.reason,
          ...(voidJournal !== null ? { voidJournalEntryId: voidJournal.id } : {}),
          updatedBy: actor.id,
        },
      });
      const billIds = (
        await tx.erpApPaymentLine.findMany({
          where: { paymentId },
          select: { billId: true },
        })
      ).map((line) => line.billId);
      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.ap_payment.cancelled",
          module: ERP_MODULE,
          entityType: "ap_payment",
          entityId: paymentId,
          summary:
            voidJournal === null
              ? "Cancelled an unposted payment"
              : `Voided payment ${payment.paymentNumber ?? ""} with journal entry ${voidJournal.journalNumber}`,
          changes: {
            reason: data.reason,
            voided: voidJournal !== null,
            billIds,
            ...(voidJournal !== null
              ? { voidJournalNumber: voidJournal.journalNumber }
              : {}),
          },
          severity: voidJournal === null ? "NOTICE" : "WARNING",
        },
        tx,
      );
      await publish(tx, {
        name: ERP_EVENTS.AP_PAYMENT_CANCELLED,
        actorId: actor.id,
        correlationId: actor.correlationId ?? null,
        payload: {
          paymentId,
          paymentNumber: payment.paymentNumber,
          vendorId: payment.vendorId,
          billIds,
          voidJournalEntryId: voidJournal?.id ?? null,
        } satisfies ApPaymentCancelledPayload,
      });
      return { voidJournalNumber: voidJournal?.journalNumber ?? null };
    }, AP_POSTING_TRANSACTION);
  } catch (error) {
    throw asFinanceError(error);
  }
}
