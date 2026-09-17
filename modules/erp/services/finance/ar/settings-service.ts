import { ConflictError, NotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { diffForAudit, recordAudit } from "@/platform/audit/audit";
import { type Actor, canGlobally, requireGlobalPermission } from "@/platform/authz/authz";
import { ERP_PERMISSIONS } from "../../../contracts/permissions";
import {
  arSettingsSchema,
  numberSeriesSchema,
  paymentMethodSchema,
  taxRateSchema,
} from "../../../contracts/schemas";
import type {
  FinanceDocumentType,
  ArSettingsDto,
  PaymentMethodDto,
  TaxRateDto,
} from "../../../contracts/types";
import { paymentMethodSelect, taxRateSelect } from "../../../repositories/ar-selects";
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
import { loadArSettings, requireAccount } from "./support";

/**
 * AR configuration (ADR-023): approval rules, defaults, aging buckets, tax rates,
 * payment methods and document numbering — all data, changed here, never in code.
 */

export async function getArSettings(actor: Actor): Promise<ArSettingsDto> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AR_SETTINGS_ADMINISTER);
  const [settings, account, series] = await Promise.all([
    loadArSettings(),
    prisma.erpArSettings.findUnique({
      where: { id: 1 },
      select: { defaultReceivableAccount: { select: accountRefSelect } },
    }),
    prisma.erpNumberSeries.findMany({
      where: { documentType: { startsWith: "AR_" } },
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
    defaultReceivableAccount: account?.defaultReceivableAccount ?? null,
    invoiceApprovalRequired: settings.invoiceApprovalRequired,
    approvalThresholdMinor:
      settings.approvalThresholdMinor === null
        ? null
        : toAmount(settings.approvalThresholdMinor),
    allowSelfApproval: settings.allowSelfApproval,
    defaultPaymentTermsDays: settings.defaultPaymentTermsDays,
    agingBucketDays: settings.agingBucketDays,
    numberSeries: series.map((row) => ({
      ...row,
      documentType: row.documentType as FinanceDocumentType,
    })),
  };
}

export async function updateArSettings(actor: Actor, input: unknown): Promise<void> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AR_SETTINGS_ADMINISTER);
  const data = parseInput(arSettingsSchema, input);
  if (data.defaultReceivableAccountId !== null) {
    await requireAccount(
      data.defaultReceivableAccountId,
      ["ASSET"],
      "defaultReceivableAccountId",
    );
  }

  const before = await loadArSettings();
  const next = {
    defaultReceivableAccountId: data.defaultReceivableAccountId,
    invoiceApprovalRequired: data.invoiceApprovalRequired,
    approvalThresholdMinor: data.approvalThreshold,
    allowSelfApproval: data.allowSelfApproval,
    defaultPaymentTermsDays: data.defaultPaymentTermsDays,
    agingBucketDays: data.agingBucketDays,
  };
  const changes = diffForAudit(
    {
      ...before,
      approvalThresholdMinor: before.approvalThresholdMinor?.toString() ?? null,
      agingBucketDays: before.agingBucketDays.join(","),
    },
    {
      ...next,
      approvalThresholdMinor: next.approvalThresholdMinor?.toString() ?? null,
      agingBucketDays: next.agingBucketDays.join(","),
    },
  );
  if (Object.keys(changes).length === 0) return;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.erpArSettings.upsert({
        where: { id: 1 },
        create: { id: 1, ...next, updatedBy: actor.id },
        update: { ...next, updatedBy: actor.id },
      });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.ar_settings.updated",
          module: ERP_MODULE,
          entityType: "ar_settings",
          entityId: "1",
          summary: "Updated accounts receivable settings",
          changes,
          severity: "NOTICE",
        },
        tx,
      );
    });
  } catch (error) {
    throw asFinanceError(error);
  }
}

/* Tax rates ----------------------------------------------------------------------- */

/** Active rates for invoice lines, or every rate for the settings screen. */
export async function listTaxRates(
  actor: Actor,
  options: { activeOnly: boolean },
): Promise<TaxRateDto[]> {
  // Active rates are offered on invoice lines and, with an input tax account, on bill
  // lines, so a reader of either may list them (ADR-033).
  if (!options.activeOnly || !(await canGlobally(actor, ERP_PERMISSIONS.AP_BILL_READ))) {
    await requireGlobalPermission(
      actor,
      options.activeOnly
        ? ERP_PERMISSIONS.AR_INVOICE_READ
        : ERP_PERMISSIONS.AR_SETTINGS_ADMINISTER,
    );
  }
  return prisma.erpTaxRate.findMany({
    where: options.activeOnly ? { isActive: true } : {},
    orderBy: [{ isActive: "desc" }, { code: "asc" }],
    take: 200,
    select: taxRateSelect,
  });
}

export async function createTaxRate(
  actor: Actor,
  input: unknown,
): Promise<{ id: string }> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AR_SETTINGS_ADMINISTER);
  const data = parseInput(taxRateSchema, input);
  await requireAccount(data.taxAccountId, ["LIABILITY"], "taxAccountId");
  if (data.inputTaxAccountId !== null) {
    // Recoverable input VAT is an asset; VAT that cannot be reclaimed is a cost.
    await requireAccount(
      data.inputTaxAccountId,
      ["ASSET", "EXPENSE"],
      "inputTaxAccountId",
    );
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const rate = await tx.erpTaxRate.create({
        data: {
          code: data.code,
          name: data.name,
          nameAr: data.nameAr,
          rateBasisPoints: data.rate,
          taxAccountId: data.taxAccountId,
          inputTaxAccountId: data.inputTaxAccountId,
          isActive: data.isActive,
          createdBy: actor.id,
          updatedBy: actor.id,
        },
        select: { id: true },
      });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.tax_rate.created",
          module: ERP_MODULE,
          entityType: "tax_rate",
          entityId: rate.id,
          summary: `Created tax rate ${data.code}`,
          changes: {
            code: data.code,
            rateBasisPoints: data.rate,
            taxAccountId: data.taxAccountId,
            inputTaxAccountId: data.inputTaxAccountId,
          },
          severity: "NOTICE",
        },
        tx,
      );
      return rate;
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw new ConflictError("A tax rate with this code already exists.");
    throw asFinanceError(error);
  }
}

export async function updateTaxRate(
  actor: Actor,
  taxRateId: string,
  input: unknown,
): Promise<{ id: string }> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AR_SETTINGS_ADMINISTER);
  assertId(taxRateId, "tax rate");
  const data = parseInput(taxRateSchema, input);
  const before = await prisma.erpTaxRate.findUnique({
    where: { id: taxRateId },
    select: {
      code: true,
      name: true,
      nameAr: true,
      rateBasisPoints: true,
      taxAccountId: true,
      inputTaxAccountId: true,
      isActive: true,
    },
  });
  if (before === null) throw new NotFoundError("tax rate");
  await requireAccount(data.taxAccountId, ["LIABILITY"], "taxAccountId");
  if (data.inputTaxAccountId !== null) {
    await requireAccount(
      data.inputTaxAccountId,
      ["ASSET", "EXPENSE"],
      "inputTaxAccountId",
    );
  }

  const next = {
    code: data.code,
    name: data.name,
    nameAr: data.nameAr,
    rateBasisPoints: data.rate,
    taxAccountId: data.taxAccountId,
    inputTaxAccountId: data.inputTaxAccountId,
    isActive: data.isActive,
  };
  const changes = diffForAudit(before, next);
  if (Object.keys(changes).length === 0) return { id: taxRateId };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.erpTaxRate.update({
        where: { id: taxRateId },
        data: { ...next, updatedBy: actor.id },
      });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.tax_rate.updated",
          module: ERP_MODULE,
          entityType: "tax_rate",
          entityId: taxRateId,
          summary: `Updated tax rate ${data.code}`,
          changes,
          severity: "NOTICE",
        },
        tx,
      );
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw new ConflictError("A tax rate with this code already exists.");
    throw asFinanceError(error);
  }
  return { id: taxRateId };
}

/* Payment methods ---------------------------------------------------------------------- */

export async function listPaymentMethods(
  actor: Actor,
  options: { activeOnly: boolean },
): Promise<PaymentMethodDto[]> {
  // Active methods are used by customer receipts and supplier payments alike (ADR-033).
  if (
    !options.activeOnly ||
    !(await canGlobally(actor, ERP_PERMISSIONS.AP_PAYMENT_READ))
  ) {
    await requireGlobalPermission(
      actor,
      options.activeOnly
        ? ERP_PERMISSIONS.AR_RECEIPT_READ
        : ERP_PERMISSIONS.AR_SETTINGS_ADMINISTER,
    );
  }
  return prisma.erpPaymentMethod.findMany({
    where: options.activeOnly ? { isActive: true } : {},
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    take: 100,
    select: paymentMethodSelect,
  });
}

export async function createPaymentMethod(
  actor: Actor,
  input: unknown,
): Promise<{ id: string }> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AR_SETTINGS_ADMINISTER);
  const data = parseInput(paymentMethodSchema, input);
  if (data.defaultDepositAccountId !== null) {
    await requireAccount(
      data.defaultDepositAccountId,
      ["ASSET"],
      "defaultDepositAccountId",
    );
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const method = await tx.erpPaymentMethod.create({
        data: { ...data, createdBy: actor.id, updatedBy: actor.id },
        select: { id: true },
      });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.payment_method.created",
          module: ERP_MODULE,
          entityType: "payment_method",
          entityId: method.id,
          summary: `Created payment method ${data.code}`,
          changes: { code: data.code, name: data.name },
        },
        tx,
      );
      return method;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError("A payment method with this code already exists.");
    }
    throw asFinanceError(error);
  }
}

export async function updatePaymentMethod(
  actor: Actor,
  paymentMethodId: string,
  input: unknown,
): Promise<{ id: string }> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AR_SETTINGS_ADMINISTER);
  assertId(paymentMethodId, "payment method");
  const data = parseInput(paymentMethodSchema, input);
  const before = await prisma.erpPaymentMethod.findUnique({
    where: { id: paymentMethodId },
    select: {
      code: true,
      name: true,
      nameAr: true,
      defaultDepositAccountId: true,
      isActive: true,
      sortOrder: true,
    },
  });
  if (before === null) throw new NotFoundError("payment method");
  if (data.defaultDepositAccountId !== null) {
    await requireAccount(
      data.defaultDepositAccountId,
      ["ASSET"],
      "defaultDepositAccountId",
    );
  }
  const changes = diffForAudit(before, data);
  if (Object.keys(changes).length === 0) return { id: paymentMethodId };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.erpPaymentMethod.update({
        where: { id: paymentMethodId },
        data: { ...data, updatedBy: actor.id },
      });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.payment_method.updated",
          module: ERP_MODULE,
          entityType: "payment_method",
          entityId: paymentMethodId,
          summary: `Updated payment method ${data.code}`,
          changes,
        },
        tx,
      );
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError("A payment method with this code already exists.");
    }
    throw asFinanceError(error);
  }
  return { id: paymentMethodId };
}

/* Number series ---------------------------------------------------------------------- */

export async function updateNumberSeries(
  actor: Actor,
  seriesId: string,
  input: unknown,
): Promise<{ id: string }> {
  assertId(seriesId, "number series");
  const before = await prisma.erpNumberSeries.findUnique({
    where: { id: seriesId },
    select: { documentType: true, prefix: true, padding: true, resetsYearly: true },
  });
  // Checked before anything about the series is revealed.
  await requireGlobalPermission(
    actor,
    before?.documentType.startsWith("AP_") === true
      ? ERP_PERMISSIONS.AP_SETTINGS_ADMINISTER
      : ERP_PERMISSIONS.AR_SETTINGS_ADMINISTER,
  );
  if (before === null) throw new NotFoundError("number series");
  const data = parseInput(numberSeriesSchema, input);
  const { documentType, ...current } = before;
  const changes = diffForAudit(current, data);
  if (Object.keys(changes).length === 0) return { id: seriesId };

  await prisma.$transaction(async (tx) => {
    await tx.erpNumberSeries.update({
      where: { id: seriesId },
      data: { ...data, updatedBy: actor.id },
    });
    await recordAudit(
      {
        ...auditFields(actor),
        action: "erp.number_series.updated",
        module: ERP_MODULE,
        entityType: "number_series",
        entityId: seriesId,
        summary: `Updated numbering for ${documentType}`,
        changes,
        severity: "NOTICE",
      },
      tx,
    );
  });
  return { id: seriesId };
}
