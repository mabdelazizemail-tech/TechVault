import type { Prisma } from "@prisma/client";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { diffForAudit, recordAudit } from "@/platform/audit/audit";
import { type Actor, requireGlobalPermission } from "@/platform/authz/authz";
import { ERP_PERMISSIONS } from "../../../contracts/permissions";
import { arListParamsSchema, vendorSchema } from "../../../contracts/schemas";
import type {
  CustomerRef,
  Paginated,
  VendorDetail,
  VendorListItem,
  VendorRef,
} from "../../../contracts/types";
import { agingBucketLabels } from "../../../domain/ar";
import { apBillListSelect, apPaymentListSelect } from "../../../repositories/ap-selects";
import { accountRefSelect } from "../../../repositories/selects";
import {
  ERP_MODULE,
  asFinanceError,
  assertId,
  auditFields,
  isUniqueViolation,
  parseInput,
  toAmount,
  todayIso,
} from "../support";
import {
  customerFrom,
  customerRefs,
  requireAccount,
  requireLiveCustomer,
} from "../ar/support";
import { apAgingBuckets } from "./aging-service";
import { loadApSettings, toBillListItem, toPaymentListItem } from "./support";

/**
 * Vendors (ADR-033). ERP owns the supplier master (§26). A vendor may name the CRM
 * company that is the same business, by id only; the name shown for it comes from
 * CRM's reference contract. Balances are always derived from posted bills.
 */

const PAGE_SIZE = 25;

type OutstandingRow = {
  vendor_id: string;
  outstanding: bigint;
  overdue: bigint;
  open_bills: bigint;
};

/** Outstanding and overdue amounts for some vendors, from posted bills. */
async function outstandingFor(
  ids: readonly string[],
): Promise<Map<string, OutstandingRow>> {
  if (ids.length === 0) return new Map();
  const today = todayIso();
  const rows = await prisma.$queryRaw<OutstandingRow[]>`
    SELECT b.vendor_id,
           sum(b.outstanding_minor)::bigint AS outstanding,
           coalesce(sum(b.outstanding_minor) FILTER (WHERE b.due_date < ${today}::date), 0)::bigint AS overdue,
           count(*) FILTER (WHERE b.outstanding_minor > 0) AS open_bills
      FROM erp.ap_bills b
     WHERE b.vendor_id = ANY(${ids}::uuid[])
       AND b.status IN ('POSTED', 'PARTIALLY_PAID', 'PAID')
     GROUP BY b.vendor_id`;
  return new Map(rows.map((row) => [row.vendor_id, row]));
}

export async function listVendors(
  actor: Actor,
  rawParams: Record<string, unknown> = {},
): Promise<Paginated<VendorListItem>> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AP_VENDOR_READ);
  const params = arListParamsSchema.parse(rawParams);
  const where: Prisma.ErpVendorWhereInput = {
    ...(params.status === "active"
      ? { isActive: true }
      : params.status === "inactive"
        ? { isActive: false }
        : {}),
    ...(params.q !== undefined && params.q !== ""
      ? {
          OR: [
            { name: { contains: params.q, mode: "insensitive" } },
            { nameAr: { contains: params.q, mode: "insensitive" } },
            { taxRegistrationNumber: { contains: params.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.erpVendor.count({ where }),
    prisma.erpVendor.findMany({
      where,
      orderBy: [{ isActive: "desc" }, { name: params.dir === "desc" ? "desc" : "asc" }],
      skip: (params.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        name: true,
        nameAr: true,
        taxRegistrationNumber: true,
        isActive: true,
      },
    }),
  ]);
  const balances = await outstandingFor(rows.map((row) => row.id));
  return {
    rows: rows.map((row) => {
      const balance = balances.get(row.id);
      return {
        ...row,
        outstandingMinor: toAmount(BigInt(balance?.outstanding ?? 0n)),
        overdueMinor: toAmount(BigInt(balance?.overdue ?? 0n)),
        openBillCount: Number(balance?.open_bills ?? 0),
      };
    }),
    total,
    page: params.page,
    pageSize: PAGE_SIZE,
  };
}

/** Active vendors matching a name, for the bill and payment forms. */
export async function searchVendors(actor: Actor, query: string): Promise<VendorRef[]> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AP_VENDOR_READ);
  const term = query.trim().slice(0, 100);
  return prisma.erpVendor.findMany({
    where: {
      isActive: true,
      ...(term === ""
        ? {}
        : {
            OR: [
              { name: { contains: term, mode: "insensitive" } },
              { nameAr: { contains: term, mode: "insensitive" } },
              { taxRegistrationNumber: { contains: term, mode: "insensitive" } },
            ],
          }),
    },
    orderBy: { name: "asc" },
    take: 20,
    select: { id: true, name: true, isActive: true },
  });
}

export async function getVendor(actor: Actor, vendorId: string): Promise<VendorDetail> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AP_VENDOR_READ);
  assertId(vendorId, "vendor");

  const vendor = await prisma.erpVendor.findUnique({
    where: { id: vendorId },
    select: {
      id: true,
      name: true,
      nameAr: true,
      taxRegistrationNumber: true,
      isActive: true,
      crmAccountId: true,
      email: true,
      phone: true,
      address: true,
      paymentTermsDays: true,
      notes: true,
      createdAt: true,
      updatedAt: true,
      payableAccount: { select: accountRefSelect },
      defaultExpenseAccount: { select: accountRefSelect },
      defaultWithholdingTaxRate: { select: { id: true, code: true, name: true } },
    },
  });
  if (vendor === null) throw new NotFoundError("vendor");

  const settings = await loadApSettings();
  const asOf = todayIso();
  const [balances, totals, buckets, bills, payments, crm] = await Promise.all([
    outstandingFor([vendorId]),
    prisma.$queryRaw<{ billed: bigint; paid: bigint }[]>`
      SELECT coalesce(sum(b.total_minor), 0)::bigint AS billed,
             coalesce(sum(b.paid_minor), 0)::bigint AS paid
        FROM erp.ap_bills b
       WHERE b.vendor_id = ${vendorId}::uuid
         AND b.status IN ('POSTED', 'PARTIALLY_PAID', 'PAID')`,
    apAgingBuckets(asOf, settings.agingBucketDays, [vendorId]),
    prisma.erpApBill.findMany({
      where: { vendorId },
      orderBy: [{ billDate: "desc" }, { createdAt: "desc" }],
      take: 10,
      select: apBillListSelect,
    }),
    prisma.erpApPayment.findMany({
      where: { vendorId },
      orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
      take: 10,
      select: apPaymentListSelect,
    }),
    vendor.crmAccountId === null
      ? Promise.resolve(null)
      : customerRefs([vendor.crmAccountId]),
  ]);

  const labels = agingBucketLabels(settings.agingBucketDays);
  const bucketsMinor = labels.map(() => 0n);
  for (const row of buckets) {
    bucketsMinor[row.bucket] = (bucketsMinor[row.bucket] ?? 0n) + row.amount;
  }
  const balance = balances.get(vendorId);
  const sums = totals[0];
  const crmAccount: CustomerRef | null =
    vendor.crmAccountId === null || crm === null
      ? null
      : customerFrom(crm, vendor.crmAccountId);

  return {
    id: vendor.id,
    name: vendor.name,
    nameAr: vendor.nameAr,
    taxRegistrationNumber: vendor.taxRegistrationNumber,
    isActive: vendor.isActive,
    outstandingMinor: toAmount(BigInt(balance?.outstanding ?? 0n)),
    overdueMinor: toAmount(BigInt(balance?.overdue ?? 0n)),
    openBillCount: Number(balance?.open_bills ?? 0),
    crmAccount,
    email: vendor.email,
    phone: vendor.phone,
    address: vendor.address,
    paymentTermsDays: vendor.paymentTermsDays,
    payableAccount: vendor.payableAccount,
    defaultExpenseAccount: vendor.defaultExpenseAccount,
    defaultWithholdingTaxRate: vendor.defaultWithholdingTaxRate,
    notes: vendor.notes,
    defaultPaymentTermsDays: settings.defaultPaymentTermsDays,
    billedMinor: toAmount(BigInt(sums?.billed ?? 0n)),
    paidMinor: toAmount(BigInt(sums?.paid ?? 0n)),
    aging: { asOf, bucketLabels: labels, bucketsMinor: bucketsMinor.map(toAmount) },
    bills: bills.map(toBillListItem),
    payments: payments.map(toPaymentListItem),
    createdAt: vendor.createdAt,
    updatedAt: vendor.updatedAt,
  };
}

/* Writes -------------------------------------------------------------------------- */

async function validateReferences(data: ReturnType<typeof vendorSchema.parse>) {
  if (data.payableAccountId !== null) {
    await requireAccount(data.payableAccountId, ["LIABILITY"], "payableAccountId");
  }
  if (data.defaultExpenseAccountId !== null) {
    await requireAccount(
      data.defaultExpenseAccountId,
      ["EXPENSE", "ASSET"],
      "defaultExpenseAccountId",
    );
  }
  if (data.defaultWithholdingTaxRateId !== null) {
    const rate = await prisma.erpWithholdingTaxRate.findUnique({
      where: { id: data.defaultWithholdingTaxRateId },
      select: { isActive: true },
    });
    if (rate === null || !rate.isActive) {
      throw new ValidationError("Please correct the highlighted fields.", {
        defaultWithholdingTaxRateId: ["Choose an active withholding rate."],
      });
    }
  }
  if (data.crmAccountId !== null) {
    // Linking to a CRM company only needs it to exist; nothing is copied from it.
    await requireLiveCustomer(data.crmAccountId);
  }
}

function vendorConflict(error: unknown): unknown {
  if (!isUniqueViolation(error)) return asFinanceError(error);
  const text = String((error as { message?: unknown }).message ?? "");
  return new ConflictError(
    text.includes("tax_registration")
      ? "Another vendor already has this tax registration number."
      : "A vendor with this name already exists.",
  );
}

function toRow(data: ReturnType<typeof vendorSchema.parse>) {
  return {
    name: data.name,
    nameAr: data.nameAr,
    taxRegistrationNumber: data.taxRegistrationNumber,
    crmAccountId: data.crmAccountId,
    email: data.email,
    phone: data.phone,
    address: data.address,
    paymentTermsDays: data.paymentTermsDays,
    payableAccountId: data.payableAccountId,
    defaultExpenseAccountId: data.defaultExpenseAccountId,
    defaultWithholdingTaxRateId: data.defaultWithholdingTaxRateId,
    notes: data.notes,
    isActive: data.isActive,
  };
}

export async function createVendor(
  actor: Actor,
  input: unknown,
): Promise<{ id: string }> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AP_VENDOR_CREATE);
  const data = parseInput(vendorSchema, input);
  await validateReferences(data);
  try {
    return await prisma.$transaction(async (tx) => {
      const vendor = await tx.erpVendor.create({
        data: { ...toRow(data), createdBy: actor.id, updatedBy: actor.id },
        select: { id: true },
      });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.ap_vendor.created",
          module: ERP_MODULE,
          entityType: "vendor",
          entityId: vendor.id,
          summary: `Added vendor ${data.name}`,
          changes: {
            name: data.name,
            taxRegistrationNumber: data.taxRegistrationNumber,
            crmAccountId: data.crmAccountId,
          },
        },
        tx,
      );
      return vendor;
    });
  } catch (error) {
    throw vendorConflict(error);
  }
}

export async function updateVendor(
  actor: Actor,
  vendorId: string,
  input: unknown,
): Promise<{ id: string }> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AP_VENDOR_UPDATE);
  assertId(vendorId, "vendor");
  const data = parseInput(vendorSchema, input);
  const before = await prisma.erpVendor.findUnique({
    where: { id: vendorId },
    select: {
      name: true,
      nameAr: true,
      taxRegistrationNumber: true,
      crmAccountId: true,
      email: true,
      phone: true,
      address: true,
      paymentTermsDays: true,
      payableAccountId: true,
      defaultExpenseAccountId: true,
      defaultWithholdingTaxRateId: true,
      notes: true,
      isActive: true,
    },
  });
  if (before === null) throw new NotFoundError("vendor");
  await validateReferences(data);

  const next = toRow(data);
  const changes = diffForAudit(before, next, ["notes", "address"]);
  if (Object.keys(changes).length === 0) return { id: vendorId };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.erpVendor.update({
        where: { id: vendorId },
        data: { ...next, updatedBy: actor.id },
      });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.ap_vendor.updated",
          module: ERP_MODULE,
          entityType: "vendor",
          entityId: vendorId,
          summary: `Updated vendor ${data.name}`,
          changes,
          // A changed payable account or deactivation affects where money is booked.
          severity:
            "payableAccountId" in changes || "isActive" in changes ? "NOTICE" : "INFO",
        },
        tx,
      );
    });
  } catch (error) {
    throw vendorConflict(error);
  }
  return { id: vendorId };
}
