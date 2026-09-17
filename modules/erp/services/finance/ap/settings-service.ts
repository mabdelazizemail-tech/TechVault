import { ConflictError, NotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { diffForAudit, recordAudit } from "@/platform/audit/audit";
import { type Actor, requireGlobalPermission } from "@/platform/authz/authz";
import { ERP_PERMISSIONS } from "../../../contracts/permissions";
import { apSettingsSchema, withholdingTaxRateSchema } from "../../../contracts/schemas";
import type {
  ApSettingsDto,
  FinanceDocumentType,
  WithholdingTaxRateDto,
} from "../../../contracts/types";
import { accountRefSelect } from "../../../repositories/selects";
import {
  ERP_MODULE,
  asFinanceError,
  assertId,
  auditFields,
  isUniqueViolation,
  parseInput,
  toAmount,
} from "../support";
import { requireAccount } from "../ar/support";
import { loadApSettings } from "./support";

/**
 * Accounts payable configuration (ADR-033): the default payable account, approval
 * rules for bills and for payments, aging buckets, numbering, and the withholding tax
 * rates deducted when suppliers are paid. All data, never code.
 */

const withholdingRateSelect = {
  id: true,
  code: true,
  name: true,
  nameAr: true,
  rateBasisPoints: true,
  isActive: true,
  payableAccount: { select: accountRefSelect },
} as const;

export async function getApSettings(actor: Actor): Promise<ApSettingsDto> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AP_SETTINGS_ADMINISTER);
  const [settings, row, series] = await Promise.all([
    loadApSettings(),
    prisma.erpApSettings.findUnique({
      where: { id: 1 },
      select: { defaultPayableAccount: { select: accountRefSelect } },
    }),
    prisma.erpNumberSeries.findMany({
      where: { documentType: { startsWith: "AP_" } },
      orderBy: { documentType: "asc" },
      select: {
        id: true,
        documentType: true,
        prefix: true,
        padding: true,
        resetsYearly: true,
      },
    }),
  ]);
  return {
    defaultPayableAccount: row?.defaultPayableAccount ?? null,
    billApprovalRequired: settings.billApprovalRequired,
    billApprovalThresholdMinor:
      settings.billApprovalThresholdMinor === null
        ? null
        : toAmount(settings.billApprovalThresholdMinor),
    paymentApprovalRequired: settings.paymentApprovalRequired,
    paymentApprovalThresholdMinor:
      settings.paymentApprovalThresholdMinor === null
        ? null
        : toAmount(settings.paymentApprovalThresholdMinor),
    allowSelfApproval: settings.allowSelfApproval,
    defaultPaymentTermsDays: settings.defaultPaymentTermsDays,
    agingBucketDays: settings.agingBucketDays,
    numberSeries: series.map((item) => ({
      ...item,
      documentType: item.documentType as FinanceDocumentType,
    })),
  };
}

export async function updateApSettings(actor: Actor, input: unknown): Promise<void> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AP_SETTINGS_ADMINISTER);
  const data = parseInput(apSettingsSchema, input);
  if (data.defaultPayableAccountId !== null) {
    await requireAccount(
      data.defaultPayableAccountId,
      ["LIABILITY"],
      "defaultPayableAccountId",
    );
  }

  const before = await loadApSettings();
  const next = {
    defaultPayableAccountId: data.defaultPayableAccountId,
    billApprovalRequired: data.billApprovalRequired,
    billApprovalThresholdMinor: data.billApprovalThreshold,
    paymentApprovalRequired: data.paymentApprovalRequired,
    paymentApprovalThresholdMinor: data.paymentApprovalThreshold,
    allowSelfApproval: data.allowSelfApproval,
    defaultPaymentTermsDays: data.defaultPaymentTermsDays,
    agingBucketDays: data.agingBucketDays,
  };
  const printable = (values: typeof next) => ({
    ...values,
    billApprovalThresholdMinor: values.billApprovalThresholdMinor?.toString() ?? null,
    paymentApprovalThresholdMinor:
      values.paymentApprovalThresholdMinor?.toString() ?? null,
    agingBucketDays: values.agingBucketDays.join(","),
  });
  const changes = diffForAudit(printable(before), printable(next));
  if (Object.keys(changes).length === 0) return;

  // Loosening a control over money leaving the company is worth flagging.
  const loosened =
    (before.paymentApprovalRequired && !next.paymentApprovalRequired) ||
    (before.billApprovalRequired && !next.billApprovalRequired) ||
    (!before.allowSelfApproval && next.allowSelfApproval);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.erpApSettings.upsert({
        where: { id: 1 },
        create: { id: 1, ...next, updatedBy: actor.id },
        update: { ...next, updatedBy: actor.id },
      });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.ap_settings.updated",
          module: ERP_MODULE,
          entityType: "ap_settings",
          entityId: "1",
          summary: "Updated accounts payable settings",
          changes,
          severity: loosened ? "WARNING" : "NOTICE",
        },
        tx,
      );
    });
  } catch (error) {
    throw asFinanceError(error);
  }
}

/* Withholding tax rates ----------------------------------------------------------------- */

/** Active rates for payment lines, or every rate for the settings screen. */
export async function listWithholdingTaxRates(
  actor: Actor,
  options: { activeOnly: boolean },
): Promise<WithholdingTaxRateDto[]> {
  await requireGlobalPermission(
    actor,
    options.activeOnly
      ? ERP_PERMISSIONS.AP_PAYMENT_READ
      : ERP_PERMISSIONS.AP_SETTINGS_ADMINISTER,
  );
  return prisma.erpWithholdingTaxRate.findMany({
    where: options.activeOnly ? { isActive: true } : {},
    orderBy: [{ isActive: "desc" }, { code: "asc" }],
    take: 200,
    select: withholdingRateSelect,
  });
}

export async function createWithholdingTaxRate(
  actor: Actor,
  input: unknown,
): Promise<{ id: string }> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AP_SETTINGS_ADMINISTER);
  const data = parseInput(withholdingTaxRateSchema, input);
  await requireAccount(data.payableAccountId, ["LIABILITY"], "payableAccountId");
  try {
    return await prisma.$transaction(async (tx) => {
      const rate = await tx.erpWithholdingTaxRate.create({
        data: {
          code: data.code,
          name: data.name,
          nameAr: data.nameAr,
          rateBasisPoints: data.rate,
          payableAccountId: data.payableAccountId,
          isActive: data.isActive,
          createdBy: actor.id,
          updatedBy: actor.id,
        },
        select: { id: true },
      });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.withholding_tax_rate.created",
          module: ERP_MODULE,
          entityType: "withholding_tax_rate",
          entityId: rate.id,
          summary: `Created withholding tax rate ${data.code}`,
          changes: {
            code: data.code,
            rateBasisPoints: data.rate,
            payableAccountId: data.payableAccountId,
          },
          severity: "NOTICE",
        },
        tx,
      );
      return rate;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError("A withholding tax rate with this code already exists.");
    }
    throw asFinanceError(error);
  }
}

export async function updateWithholdingTaxRate(
  actor: Actor,
  rateId: string,
  input: unknown,
): Promise<{ id: string }> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AP_SETTINGS_ADMINISTER);
  assertId(rateId, "withholding tax rate");
  const data = parseInput(withholdingTaxRateSchema, input);
  const before = await prisma.erpWithholdingTaxRate.findUnique({
    where: { id: rateId },
    select: {
      code: true,
      name: true,
      nameAr: true,
      rateBasisPoints: true,
      payableAccountId: true,
      isActive: true,
    },
  });
  if (before === null) throw new NotFoundError("withholding tax rate");
  await requireAccount(data.payableAccountId, ["LIABILITY"], "payableAccountId");

  const next = {
    code: data.code,
    name: data.name,
    nameAr: data.nameAr,
    rateBasisPoints: data.rate,
    payableAccountId: data.payableAccountId,
    isActive: data.isActive,
  };
  const changes = diffForAudit(before, next);
  if (Object.keys(changes).length === 0) return { id: rateId };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.erpWithholdingTaxRate.update({
        where: { id: rateId },
        data: { ...next, updatedBy: actor.id },
      });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.withholding_tax_rate.updated",
          module: ERP_MODULE,
          entityType: "withholding_tax_rate",
          entityId: rateId,
          summary: `Updated withholding tax rate ${data.code}`,
          changes,
          severity: "NOTICE",
        },
        tx,
      );
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError("A withholding tax rate with this code already exists.");
    }
    throw asFinanceError(error);
  }
  return { id: rateId };
}
