import { NotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { diffForAudit, recordAudit } from "@/platform/audit/audit";
import { type Actor, requireGlobalPermission } from "@/platform/authz/authz";
import { ERP_PERMISSIONS } from "../../../contracts/permissions";
import { arCustomerProfileSchema, arListParamsSchema } from "../../../contracts/schemas";
import type {
  ArCustomerAccount,
  ArCustomerListItem,
  CustomerRef,
  Paginated,
} from "../../../contracts/types";
import { agingBucketLabels } from "../../../domain/ar";
import {
  arInvoiceListSelect,
  arReceiptListSelect,
} from "../../../repositories/ar-selects";
import { accountRefSelect } from "../../../repositories/selects";
import {
  ERP_MODULE,
  asFinanceError,
  assertId,
  auditFields,
  parseInput,
  todayIso,
  toAmount,
} from "../support";
import { agingBuckets } from "./aging-service";
import {
  customerFrom,
  customerIdsMatching,
  customerRefs,
  loadArSettings,
  requireAccount,
  requireLiveCustomer,
  searchCustomers,
  toInvoiceListItem,
  toReceiptListItem,
} from "./support";

/**
 * Customers as accounts receivable sees them: a CRM company id, its balance and its
 * billing profile. The balance is always derived — posted invoices minus posted
 * receipts — never a stored figure someone could edit (ADR-023).
 */

const PAGE_SIZE = 25;

/** CRM companies matching a name, for the customer pickers. */
export async function searchArCustomers(
  actor: Actor,
  query: string,
): Promise<CustomerRef[]> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AR_CUSTOMER_READ);
  return searchCustomers(query);
}

export async function listArCustomers(
  actor: Actor,
  rawParams: Record<string, unknown> = {},
): Promise<Paginated<ArCustomerListItem>> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AR_CUSTOMER_READ);
  const params = arListParamsSchema.parse(rawParams);
  const filterIds = await customerIdsMatching(params.q);
  const today = todayIso();

  const rows = await prisma.$queryRaw<
    {
      crm_account_id: string;
      invoiced: bigint;
      received: bigint;
      outstanding: bigint;
      overdue: bigint;
      unapplied: bigint;
      open_invoices: bigint;
      last_activity: string | null;
      total: bigint;
    }[]
  >`
    WITH invoices AS (
      SELECT crm_account_id,
             sum(total_minor - credited_minor)::bigint AS invoiced,
             sum(outstanding_minor)::bigint AS outstanding,
             coalesce(sum(outstanding_minor) FILTER (WHERE due_date < ${today}::date), 0)::bigint AS overdue,
             count(*) FILTER (WHERE outstanding_minor > 0) AS open_invoices,
             max(invoice_date) AS last_invoice
        FROM erp.ar_invoices
       WHERE status IN ('POSTED', 'PARTIALLY_PAID', 'PAID')
       GROUP BY crm_account_id
    ), receipts AS (
      SELECT crm_account_id,
             sum(amount_minor)::bigint AS received,
             sum(amount_minor - allocated_minor)::bigint AS unapplied,
             max(receipt_date) AS last_receipt
        FROM erp.ar_receipts
       WHERE status = 'POSTED'
       GROUP BY crm_account_id
    ), combined AS (
      SELECT coalesce(i.crm_account_id, r.crm_account_id) AS crm_account_id,
             coalesce(i.invoiced, 0)::bigint AS invoiced,
             coalesce(r.received, 0)::bigint AS received,
             coalesce(i.outstanding, 0)::bigint AS outstanding,
             coalesce(i.overdue, 0)::bigint AS overdue,
             coalesce(r.unapplied, 0)::bigint AS unapplied,
             coalesce(i.open_invoices, 0) AS open_invoices,
             greatest(i.last_invoice, r.last_receipt)::text AS last_activity
        FROM invoices i
        FULL OUTER JOIN receipts r ON r.crm_account_id = i.crm_account_id
    )
    SELECT c.*, count(*) OVER () AS total
      FROM combined c
     WHERE (${filterIds}::uuid[] IS NULL OR c.crm_account_id = ANY(${filterIds}::uuid[]))
     ORDER BY c.invoiced - c.received DESC, c.crm_account_id
     LIMIT ${PAGE_SIZE} OFFSET ${(params.page - 1) * PAGE_SIZE}`;

  const customers = await customerRefs(rows.map((row) => row.crm_account_id));
  return {
    rows: rows.map((row) => ({
      customer: customerFrom(customers, row.crm_account_id),
      invoicedMinor: toAmount(BigInt(row.invoiced)),
      receivedMinor: toAmount(BigInt(row.received)),
      balanceMinor: toAmount(BigInt(row.invoiced) - BigInt(row.received)),
      outstandingMinor: toAmount(BigInt(row.outstanding)),
      overdueMinor: toAmount(BigInt(row.overdue)),
      unappliedMinor: toAmount(BigInt(row.unapplied)),
      openInvoiceCount: Number(row.open_invoices),
      lastActivityDate: row.last_activity,
    })),
    total: Number(rows[0]?.total ?? 0),
    page: params.page,
    pageSize: PAGE_SIZE,
  };
}

export async function getArCustomer(
  actor: Actor,
  crmAccountId: string,
  rawParams: Record<string, unknown> = {},
): Promise<ArCustomerAccount> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AR_CUSTOMER_READ);
  assertId(crmAccountId, "customer");
  const params = arListParamsSchema.parse(rawParams);
  const today = todayIso();
  const from = params.from ?? null;
  const to = params.to ?? null;

  const [customers, profile, settings, sums, invoices, receipts] = await Promise.all([
    customerRefs([crmAccountId]),
    prisma.erpArCustomerProfile.findUnique({
      where: { crmAccountId },
      select: {
        paymentTermsDays: true,
        creditLimitMinor: true,
        notes: true,
        updatedAt: true,
        receivableAccount: { select: accountRefSelect },
      },
    }),
    loadArSettings(),
    prisma.$queryRaw<
      {
        invoiced: bigint;
        received: bigint;
        outstanding: bigint;
        overdue: bigint;
        unapplied: bigint;
        opening_invoiced: bigint;
        opening_received: bigint;
        period_invoiced: bigint;
        period_received: bigint;
      }[]
    >`
      SELECT
        (SELECT coalesce(sum(total_minor - credited_minor), 0)::bigint FROM erp.ar_invoices
          WHERE crm_account_id = ${crmAccountId}::uuid AND status IN ('POSTED', 'PARTIALLY_PAID', 'PAID')) AS invoiced,
        (SELECT coalesce(sum(amount_minor), 0)::bigint FROM erp.ar_receipts
          WHERE crm_account_id = ${crmAccountId}::uuid AND status = 'POSTED') AS received,
        (SELECT coalesce(sum(outstanding_minor), 0)::bigint FROM erp.ar_invoices
          WHERE crm_account_id = ${crmAccountId}::uuid AND status IN ('POSTED', 'PARTIALLY_PAID', 'PAID')) AS outstanding,
        (SELECT coalesce(sum(outstanding_minor), 0)::bigint FROM erp.ar_invoices
          WHERE crm_account_id = ${crmAccountId}::uuid AND status IN ('POSTED', 'PARTIALLY_PAID', 'PAID')
            AND due_date < ${today}::date) AS overdue,
        (SELECT coalesce(sum(amount_minor - allocated_minor), 0)::bigint FROM erp.ar_receipts
          WHERE crm_account_id = ${crmAccountId}::uuid AND status = 'POSTED') AS unapplied,
        (SELECT coalesce(sum(total_minor - credited_minor), 0)::bigint FROM erp.ar_invoices
          WHERE crm_account_id = ${crmAccountId}::uuid AND status IN ('POSTED', 'PARTIALLY_PAID', 'PAID')
            AND ${from}::date IS NOT NULL AND invoice_date < ${from}::date) AS opening_invoiced,
        (SELECT coalesce(sum(amount_minor), 0)::bigint FROM erp.ar_receipts
          WHERE crm_account_id = ${crmAccountId}::uuid AND status = 'POSTED'
            AND ${from}::date IS NOT NULL AND receipt_date < ${from}::date) AS opening_received,
        (SELECT coalesce(sum(total_minor - credited_minor), 0)::bigint FROM erp.ar_invoices
          WHERE crm_account_id = ${crmAccountId}::uuid AND status IN ('POSTED', 'PARTIALLY_PAID', 'PAID')
            AND (${from}::date IS NULL OR invoice_date >= ${from}::date)
            AND (${to}::date IS NULL OR invoice_date <= ${to}::date)) AS period_invoiced,
        (SELECT coalesce(sum(amount_minor), 0)::bigint FROM erp.ar_receipts
          WHERE crm_account_id = ${crmAccountId}::uuid AND status = 'POSTED'
            AND (${from}::date IS NULL OR receipt_date >= ${from}::date)
            AND (${to}::date IS NULL OR receipt_date <= ${to}::date)) AS period_received`,
    prisma.erpArInvoice.findMany({
      where: { crmAccountId },
      orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
      take: 10,
      select: arInvoiceListSelect,
    }),
    prisma.erpArReceipt.findMany({
      where: { crmAccountId },
      orderBy: [{ receiptDate: "desc" }, { createdAt: "desc" }],
      take: 10,
      select: arReceiptListSelect,
    }),
  ]);

  const customer = customerFrom(customers, crmAccountId);
  if (
    !customer.existsInCrm &&
    invoices.length === 0 &&
    receipts.length === 0 &&
    profile === null
  ) {
    throw new NotFoundError("customer");
  }

  const totals = sums[0];
  const big = (value: bigint | undefined) => BigInt(value ?? 0n);
  const invoiced = big(totals?.invoiced);
  const received = big(totals?.received);
  const balance = invoiced - received;
  const opening = big(totals?.opening_invoiced) - big(totals?.opening_received);
  const periodInvoiced = big(totals?.period_invoiced);
  const periodReceived = big(totals?.period_received);

  const labels = agingBucketLabels(settings.agingBucketDays);
  const buckets = labels.map(() => 0n);
  for (const row of await agingBuckets(today, settings.agingBucketDays, [crmAccountId])) {
    buckets[row.bucket] = (buckets[row.bucket] ?? 0n) + row.amount;
  }

  return {
    customer,
    profile:
      profile === null
        ? null
        : {
            paymentTermsDays: profile.paymentTermsDays,
            creditLimitMinor:
              profile.creditLimitMinor === null
                ? null
                : toAmount(profile.creditLimitMinor),
            receivableAccount: profile.receivableAccount,
            notes: profile.notes,
            updatedAt: profile.updatedAt,
          },
    defaultPaymentTermsDays: settings.defaultPaymentTermsDays,
    invoicedMinor: toAmount(invoiced),
    receivedMinor: toAmount(received),
    balanceMinor: toAmount(balance),
    outstandingMinor: toAmount(big(totals?.outstanding)),
    overdueMinor: toAmount(big(totals?.overdue)),
    unappliedMinor: toAmount(big(totals?.unapplied)),
    creditLimitExceeded:
      profile?.creditLimitMinor !== null &&
      profile?.creditLimitMinor !== undefined &&
      balance > profile.creditLimitMinor,
    aging: { asOf: today, bucketLabels: labels, bucketsMinor: buckets.map(toAmount) },
    statement: {
      from,
      to,
      openingMinor: toAmount(opening),
      invoicedMinor: toAmount(periodInvoiced),
      receivedMinor: toAmount(periodReceived),
      closingMinor: toAmount(opening + periodInvoiced - periodReceived),
    },
    invoices: invoices.map((row) => toInvoiceListItem(row, customers)),
    receipts: receipts.map((row) => toReceiptListItem(row, customers)),
  };
}

/** Sets a customer's payment terms, credit limit and receivable account. */
export async function updateArCustomerProfile(
  actor: Actor,
  crmAccountId: string,
  input: unknown,
): Promise<void> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.AR_CUSTOMER_UPDATE);
  assertId(crmAccountId, "customer");
  const data = parseInput(arCustomerProfileSchema, input);
  await requireLiveCustomer(crmAccountId, "_");
  if (data.receivableAccountId !== null) {
    await requireAccount(data.receivableAccountId, ["ASSET"], "receivableAccountId");
  }

  const before = await prisma.erpArCustomerProfile.findUnique({
    where: { crmAccountId },
    select: {
      paymentTermsDays: true,
      creditLimitMinor: true,
      receivableAccountId: true,
      notes: true,
    },
  });
  const next = {
    paymentTermsDays: data.paymentTermsDays,
    creditLimitMinor: data.creditLimit,
    receivableAccountId: data.receivableAccountId,
    notes: data.notes,
  };
  const changes = diffForAudit(
    {
      ...(before ?? { paymentTermsDays: null, receivableAccountId: null, notes: null }),
      creditLimitMinor: before?.creditLimitMinor?.toString() ?? null,
    },
    { ...next, creditLimitMinor: next.creditLimitMinor?.toString() ?? null },
  );
  if (before !== null && Object.keys(changes).length === 0) return;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.erpArCustomerProfile.upsert({
        where: { crmAccountId },
        create: { crmAccountId, ...next, createdBy: actor.id, updatedBy: actor.id },
        update: { ...next, updatedBy: actor.id },
      });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.ar_customer.profile_updated",
          module: ERP_MODULE,
          entityType: "ar_customer_profile",
          entityId: crmAccountId,
          summary: "Updated a customer's billing profile",
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
