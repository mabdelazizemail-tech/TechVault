import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  ValidationError,
} from "@/lib/errors";
import {
  ERP_ACCOUNTANT_PERMISSIONS,
  ERP_FINANCE_ADMIN_PERMISSIONS,
  ERP_PERMISSIONS,
} from "@/modules/erp/contracts/permissions";
import {
  allocateReceipt,
  approveCreditNote,
  approveInvoice,
  cancelCreditNote,
  cancelInvoice,
  cancelReceipt,
  closePeriod,
  createAccount,
  createCreditNote,
  createInvoice,
  createPeriod,
  createReceipt,
  createTaxRate,
  getAccount,
  getAgingReport,
  getArCustomer,
  getCreditNote,
  getInvoice,
  getJournal,
  getReceipt,
  listArCustomers,
  listCreditNotes,
  listInvoices,
  postCreditNote,
  postInvoice,
  postReceipt,
  rejectInvoice,
  reverseJournal,
  submitCreditNote,
  submitInvoice,
  unallocateReceipt,
  updateArCustomerProfile,
  updateArSettings,
  updateInvoice,
} from "@/modules/erp/contracts/service";
import {
  DEFAULT_NUMBER_SERIES,
  DEFAULT_PAYMENT_METHODS,
} from "@/modules/erp/domain/ar-defaults";
import {
  createOrgUnit,
  createRole,
  createUser,
  grantRole,
  hasTestDatabase,
  resetDatabase,
  seedPermissions,
  teardownDatabase,
  testPrisma,
} from "./helpers/db";

/**
 * ERP accounts receivable against a real database (CLAUDE.md §20): server pricing,
 * the approval and posting lifecycle, the balanced journal behind every posting,
 * receipts and allocation (including over-allocation under concurrency), voiding,
 * balances, aging, the subledger-to-ledger tie-out, and allowed/refused for every
 * AR control. Customers are CRM companies created directly as fixtures.
 */

async function failure(operation: Promise<unknown>): Promise<Error> {
  try {
    await operation;
  } catch (error) {
    return error as Error;
  }
  throw new Error("Expected the operation to fail, but it succeeded.");
}

describe.skipIf(!hasTestDatabase)("ERP accounts receivable (integration)", () => {
  let prisma: PrismaClient;
  let admin: { id: string };
  let admin2: { id: string };
  let accountant: { id: string };
  let viewer: { id: string };
  let outsider: { id: string };

  let cash: string;
  let receivables: string;
  let vat: string;
  let sales: string;
  let services: string;
  let vat14: string;
  let bankTransfer: string;
  let acme: string;
  let nile: string;
  let gone: string;

  const as = (user: { id: string }) => ({ id: user.id });

  afterAll(async () => {
    await teardownDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedPermissions();
    prisma = testPrisma();

    const adminRole = await createRole("finance-admin", ERP_FINANCE_ADMIN_PERMISSIONS);
    const accountantRole = await createRole("accountant", ERP_ACCOUNTANT_PERMISSIONS);
    const viewerRole = await createRole("ar-viewer", [
      ERP_PERMISSIONS.ACCESS,
      ERP_PERMISSIONS.AR_INVOICE_READ,
      ERP_PERMISSIONS.AR_RECEIPT_READ,
      ERP_PERMISSIONS.AR_CUSTOMER_READ,
      ERP_PERMISSIONS.AR_AGING_READ,
    ]);
    admin = await createUser({ email: "finance.admin@example.com" });
    admin2 = await createUser({ email: "second.admin@example.com" });
    accountant = await createUser({ email: "accountant@example.com" });
    viewer = await createUser({ email: "viewer@example.com" });
    outsider = await createUser({ email: "outsider@example.com" });
    await grantRole(admin.id, adminRole.id);
    await grantRole(admin2.id, adminRole.id);
    await grantRole(accountant.id, accountantRole.id);
    await grantRole(viewer.id, viewerRole.id);

    const account = async (
      code: string,
      name: string,
      type: "ASSET" | "LIABILITY" | "REVENUE",
    ) => (await createAccount(as(admin), { code, name, type })).id;
    cash = await account("1110", "Cash", "ASSET");
    receivables = await account("1200", "Receivables", "ASSET");
    vat = await account("2200", "VAT payable", "LIABILITY");
    sales = await account("4100", "Sales", "REVENUE");
    services = await account("4200", "Services", "REVENUE");

    await createPeriod(as(admin), {
      name: "Summer 2026",
      startDate: "2026-06-01",
      endDate: "2026-08-31",
    });
    await createPeriod(as(admin), {
      name: "September 2026",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
    });

    await prisma.erpArSettings.create({
      data: { id: 1, defaultReceivableAccountId: receivables },
    });
    await prisma.erpNumberSeries.createMany({
      data: DEFAULT_NUMBER_SERIES.map((series) => ({ ...series })),
    });
    await prisma.erpPaymentMethod.createMany({
      data: DEFAULT_PAYMENT_METHODS.map((method) => ({ ...method })),
    });
    bankTransfer = (
      await prisma.erpPaymentMethod.findUniqueOrThrow({
        where: { code: "BANK-TRANSFER" },
      })
    ).id;
    vat14 = (
      await createTaxRate(as(admin), {
        code: "VAT14",
        name: "VAT 14%",
        rate: "14",
        taxAccountId: vat,
      })
    ).id;

    acme = (await prisma.crmAccount.create({ data: { name: "Acme Trading" } })).id;
    nile = (await prisma.crmAccount.create({ data: { name: "Nile Foods" } })).id;
    gone = (
      await prisma.crmAccount.create({
        data: { name: "Gone Ltd", deletedAt: new Date() },
      })
    ).id;
  });

  const mixedInvoice = (overrides: Record<string, unknown> = {}) => ({
    crmAccountId: acme,
    invoiceDate: "2026-09-10",
    dueDate: "2026-10-10",
    lines: [
      {
        description: "Consulting",
        quantity: "2",
        unitPrice: "40,000",
        discount: "",
        taxRateId: vat14,
        revenueAccountId: sales,
      },
      {
        description: "Setup",
        quantity: "1",
        unitPrice: "20,000",
        discount: "5,000",
        taxRateId: "",
        revenueAccountId: services,
      },
    ],
    ...overrides,
  });

  const simpleInvoice = (amount: string, overrides: Record<string, unknown> = {}) => ({
    crmAccountId: acme,
    invoiceDate: "2026-09-10",
    dueDate: "2026-10-10",
    lines: [
      {
        description: "Goods",
        quantity: "1",
        unitPrice: amount,
        discount: "",
        taxRateId: "",
        revenueAccountId: sales,
      },
    ],
    ...overrides,
  });

  /** Create → submit (accountant) → approve (admin) → post (accountant). */
  const postedInvoice = async (input = mixedInvoice()) => {
    const { id } = await createInvoice(as(accountant), input);
    await submitInvoice(as(accountant), id);
    await approveInvoice(as(admin), id);
    const posted = await postInvoice(as(accountant), id);
    return { id, ...posted };
  };

  const postedReceipt = async (
    amount: string,
    overrides: Record<string, unknown> = {},
  ) => {
    const { id } = await createReceipt(as(accountant), {
      crmAccountId: acme,
      receiptDate: "2026-09-20",
      amount,
      paymentMethodId: bankTransfer,
      depositAccountId: cash,
      ...overrides,
    });
    const posted = await postReceipt(as(accountant), id);
    return { id, ...posted };
  };

  const outbox = (name: string) => prisma.eventOutbox.findMany({ where: { name } });

  /* ========================================================================== */

  describe("invoices", () => {
    it("prices a draft on the server and ignores totals, status and number sent by the browser", async () => {
      const { id } = await createInvoice(as(accountant), {
        ...mixedInvoice(),
        totalMinor: 1,
        subtotalMinor: 1,
        status: "PAID",
        invoiceNumber: "HACKED-1",
        paidMinor: 99,
      });
      const invoice = await getInvoice(as(viewer), id);
      expect(invoice.status).toBe("DRAFT");
      expect(invoice.invoiceNumber).toBeNull();
      expect([
        invoice.subtotalMinor,
        invoice.discountMinor,
        invoice.taxMinor,
        invoice.totalMinor,
        invoice.paidMinor,
      ]).toEqual([10_000_000, 500_000, 1_120_000, 10_620_000, 0]);
      expect(
        invoice.lines.map((line) => [
          line.quantity,
          line.netMinor,
          line.taxMinor,
          line.totalMinor,
        ]),
      ).toEqual([
        ["2", 8_000_000, 1_120_000, 9_120_000],
        ["1", 1_500_000, 0, 1_500_000],
      ]);
      expect(invoice.customer).toEqual({
        id: acme,
        name: "Acme Trading",
        existsInCrm: true,
      });
      expect(
        await prisma.auditLog.count({ where: { action: "erp.ar_invoice.created" } }),
      ).toBe(1);
    });

    it("rejects invalid invoices with field-level errors", async () => {
      const invalid = async (input: Record<string, unknown>, field: string) => {
        const error = await failure(createInvoice(as(accountant), input));
        expect(error, field).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).fieldErrors[field], field).toBeDefined();
      };
      await invalid(mixedInvoice({ lines: [] }), "lines");
      await invalid(
        simpleInvoice("100", {
          lines: [
            { description: "X", quantity: "0", unitPrice: "1", revenueAccountId: sales },
          ],
        }),
        "lines.0.quantity",
      );
      await invalid(
        simpleInvoice("100", {
          lines: [
            { description: "X", quantity: "1", unitPrice: "-1", revenueAccountId: sales },
          ],
        }),
        "lines.0.unitPrice",
      );
      await invalid(
        simpleInvoice("100", {
          lines: [
            {
              description: "X",
              quantity: "1",
              unitPrice: "10",
              discount: "20",
              revenueAccountId: sales,
            },
          ],
        }),
        "lines.0.discount",
      );
      await invalid(
        simpleInvoice("100", {
          lines: [
            {
              description: "X",
              quantity: "1",
              unitPrice: "10",
              revenueAccountId: receivables,
            },
          ],
        }),
        "lines.0.revenueAccountId",
      );
      await invalid(
        simpleInvoice("100", { crmAccountId: crypto.randomUUID() }),
        "crmAccountId",
      );
      await invalid(simpleInvoice("100", { crmAccountId: gone }), "crmAccountId");
      await invalid(simpleInvoice("100", { dueDate: "2026-09-01" }), "dueDate");
      expect(await prisma.erpArInvoice.count()).toBe(0);
    });

    it("approves, numbers and posts an invoice into a balanced journal linked back to it", async () => {
      const { id } = await createInvoice(as(accountant), mixedInvoice());
      expect((await submitInvoice(as(accountant), id)).status).toBe("PENDING_APPROVAL");
      await approveInvoice(as(admin), id);
      const posted = await postInvoice(as(accountant), id);
      expect(posted.invoiceNumber).toBe("INV-2026-000001");

      const invoice = await getInvoice(as(viewer), id);
      expect(invoice.status).toBe("POSTED");
      expect(invoice.outstandingMinor).toBe(10_620_000);
      expect(invoice.period?.name).toBe("September 2026");
      expect(invoice.approvedBy?.id).toBe(admin.id);

      const journal = await getJournal(as(admin), invoice.journal?.id ?? "");
      expect(journal.status).toBe("POSTED");
      expect(journal.source).toEqual({ module: "erp", type: "ar_invoice", id });
      expect(journal.debitTotalMinor).toBe(journal.creditTotalMinor);
      expect(
        journal.lines.map((line) => [
          line.account.code,
          line.debitMinor,
          line.creditMinor,
        ]),
      ).toEqual([
        ["1200", 10_620_000, 0],
        ["4100", 0, 8_000_000],
        ["4200", 0, 1_500_000],
        ["2200", 0, 1_120_000],
      ]);
      expect(await outbox("erp.ARInvoicePosted")).toHaveLength(1);
      expect(await outbox("erp.ARInvoiceApproved")).toHaveLength(1);
      expect(await outbox("erp.JournalEntryPosted")).toHaveLength(1);
      expect(
        await prisma.auditLog.count({ where: { action: "erp.ar_invoice.posted" } }),
      ).toBe(1);
    });

    it("refuses self-approval unless configured, and skips approval below the threshold", async () => {
      const own = await createInvoice(as(admin), mixedInvoice());
      await submitInvoice(as(admin), own.id);
      expect((await failure(approveInvoice(as(admin), own.id))).message).toMatch(
        /cannot approve an invoice you created/,
      );
      await approveInvoice(as(admin2), own.id);

      const settings = {
        defaultReceivableAccountId: receivables,
        invoiceApprovalRequired: true,
        approvalThreshold: "200,000",
        allowSelfApproval: false,
        defaultPaymentTermsDays: "30",
        agingBucketDays: "30, 60, 90, 120",
      };
      await updateArSettings(as(admin), settings);
      const small = await createInvoice(as(accountant), mixedInvoice());
      expect((await submitInvoice(as(accountant), small.id)).status).toBe("APPROVED");
      expect((await getInvoice(as(viewer), small.id)).approvalSkipped).toBe(true);
      expect(await failure(updateArSettings(as(accountant), settings))).toBeInstanceOf(
        ForbiddenError,
      );
    });

    it("rejects back to draft with a reason, then allows editing", async () => {
      const { id } = await createInvoice(as(accountant), mixedInvoice());
      await submitInvoice(as(accountant), id);
      expect(
        await failure(updateInvoice(as(accountant), id, mixedInvoice())),
      ).toBeInstanceOf(BusinessRuleError);
      await rejectInvoice(as(admin), id, { reason: "Wrong customer reference" });
      const rejected = await getInvoice(as(viewer), id);
      expect(rejected.status).toBe("DRAFT");
      expect(rejected.rejectionReason).toBe("Wrong customer reference");
      await updateInvoice(as(accountant), id, simpleInvoice("1,000"));
      expect((await getInvoice(as(viewer), id)).totalMinor).toBe(100_000);
    });

    it("erp.ar_invoice.approve and erp.ar_invoice.post: allowed for holders, refused otherwise", async () => {
      const { id } = await createInvoice(as(accountant), mixedInvoice());
      await submitInvoice(as(accountant), id);
      expect(await failure(approveInvoice(as(accountant), id))).toBeInstanceOf(
        ForbiddenError,
      );
      expect(await failure(approveInvoice(as(viewer), id))).toBeInstanceOf(
        ForbiddenError,
      );
      await approveInvoice(as(admin), id);
      expect(await failure(postInvoice(as(viewer), id))).toBeInstanceOf(ForbiddenError);
      expect(await failure(postInvoice(as(outsider), id))).toBeInstanceOf(ForbiddenError);
      await postInvoice(as(accountant), id);
      expect(await failure(createInvoice(as(viewer), mixedInvoice()))).toBeInstanceOf(
        ForbiddenError,
      );
    });

    it("refuses posting into a closed period and posting twice, leaving nothing behind", async () => {
      await closePeriod(
        as(admin),
        (
          await prisma.erpFiscalPeriod.findUniqueOrThrow({
            where: { name: "Summer 2026" },
          })
        ).id,
      );
      const { id } = await createInvoice(
        as(accountant),
        mixedInvoice({ invoiceDate: "2026-08-20", dueDate: "2026-09-20" }),
      );
      await submitInvoice(as(accountant), id);
      await approveInvoice(as(admin), id);
      const error = await failure(postInvoice(as(accountant), id));
      expect(error).toBeInstanceOf(BusinessRuleError);
      expect(error.message).toMatch(/Summer 2026 is closed/);
      expect((await getInvoice(as(viewer), id)).status).toBe("APPROVED");
      expect(await prisma.erpNumberSeriesCounter.count()).toBe(0);
      expect(await prisma.erpJournalEntry.count()).toBe(0);
      expect(await outbox("erp.ARInvoicePosted")).toHaveLength(0);

      const posted = await postedInvoice();
      expect(await failure(postInvoice(as(accountant), posted.id))).toBeInstanceOf(
        BusinessRuleError,
      );
    });

    it("protects a posted invoice from mutation, in the services and in the database", async () => {
      const { id } = await postedInvoice();
      expect(
        await failure(updateInvoice(as(accountant), id, mixedInvoice())),
      ).toBeInstanceOf(BusinessRuleError);
      await expect(
        prisma.erpArInvoice.update({ where: { id }, data: { notes: "Rewritten" } }),
      ).rejects.toThrow();
      await expect(prisma.erpArInvoice.delete({ where: { id } })).rejects.toThrow();
      await expect(
        prisma.erpArInvoiceLine.updateMany({
          where: { invoiceId: id },
          data: { description: "Changed" },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.erpArInvoice.update({
          where: { id },
          data: { status: "PAID", paidMinor: 10_620_000n, outstandingMinor: 0n },
        }),
      ).rejects.toThrow();

      const journalId = (await getInvoice(as(viewer), id)).journal?.id ?? "";
      expect(
        (
          await failure(
            reverseJournal(as(admin), journalId, { reversalDate: "2026-09-25" }),
          )
        ).message,
      ).toMatch(/posted from an invoice or receipt/);
    });

    it("cancels an unposted invoice and voids an unpaid posted one by reversal", async () => {
      const draft = await createInvoice(as(accountant), mixedInvoice());
      expect(
        await failure(cancelInvoice(as(accountant), draft.id, { reason: "Duplicate" })),
      ).toBeInstanceOf(ForbiddenError);
      await cancelInvoice(as(admin), draft.id, { reason: "Duplicate" });
      expect((await getInvoice(as(viewer), draft.id)).status).toBe("CANCELLED");

      const posted = await postedInvoice();
      const result = await cancelInvoice(as(admin), posted.id, {
        reason: "Billed in error",
        voidDate: "2026-09-25",
      });
      const voided = await getInvoice(as(viewer), posted.id);
      expect(voided.status).toBe("CANCELLED");
      expect(voided.voidJournal?.journalNumber).toBe(result.voidJournalNumber);
      expect((await getJournal(as(admin), voided.journal?.id ?? "")).status).toBe(
        "REVERSED",
      );
      expect((await getAccount(as(admin), receivables)).totals.balanceMinor).toBe(0);
      expect(await outbox("erp.ARInvoiceCancelled")).toHaveLength(2);
    });
  });

  /* ========================================================================== */

  describe("receipts and allocation", () => {
    it("posts a receipt as Dr bank, Cr receivables", async () => {
      const receipt = await postedReceipt("40,000");
      expect(receipt.receiptNumber).toBe("RCT-2026-000001");
      const detail = await getReceipt(as(viewer), receipt.id);
      expect(detail.status).toBe("POSTED");
      const journal = await getJournal(as(admin), detail.journal?.id ?? "");
      expect(journal.source).toEqual({
        module: "erp",
        type: "ar_receipt",
        id: receipt.id,
      });
      expect(
        journal.lines.map((line) => [
          line.account.code,
          line.debitMinor,
          line.creditMinor,
        ]),
      ).toEqual([
        ["1110", 4_000_000, 0],
        ["1200", 0, 4_000_000],
      ]);
      expect(await outbox("erp.ARReceiptPosted")).toHaveLength(1);
    });

    it("rejects an invalid receipt", async () => {
      const base = {
        crmAccountId: acme,
        receiptDate: "2026-09-20",
        amount: "100",
        paymentMethodId: bankTransfer,
        depositAccountId: cash,
      };
      for (const [input, field] of [
        [{ ...base, amount: "0" }, "amount"],
        [{ ...base, amount: "-5" }, "amount"],
        [{ ...base, depositAccountId: sales }, "depositAccountId"],
        [{ ...base, depositAccountId: receivables }, "depositAccountId"],
        [{ ...base, crmAccountId: gone }, "crmAccountId"],
      ] as const) {
        const error = await failure(createReceipt(as(accountant), input));
        expect(error, field).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).fieldErrors[field], field).toBeDefined();
      }
    });

    it("allocates partially, fully and across several invoices, deriving status and outstanding", async () => {
      const a = await postedInvoice(simpleInvoice("100,000"));
      const b = await postedInvoice(simpleInvoice("50,000"));

      const first = await postedReceipt("40,000");
      await allocateReceipt(as(accountant), first.id, {
        allocations: [{ invoiceId: a.id, amount: "40,000" }],
      });
      let invoice = await getInvoice(as(viewer), a.id);
      expect([invoice.status, invoice.paidMinor, invoice.outstandingMinor]).toEqual([
        "PARTIALLY_PAID",
        4_000_000,
        6_000_000,
      ]);

      const second = await postedReceipt("110,000");
      await allocateReceipt(as(accountant), second.id, {
        allocations: [
          { invoiceId: a.id, amount: "60,000" },
          { invoiceId: b.id, amount: "50,000" },
        ],
      });
      invoice = await getInvoice(as(viewer), a.id);
      expect([invoice.status, invoice.outstandingMinor]).toEqual(["PAID", 0]);
      expect((await getInvoice(as(viewer), b.id)).status).toBe("PAID");
      const receipt = await getReceipt(as(viewer), second.id);
      expect([receipt.allocatedMinor, receipt.unallocatedMinor]).toEqual([11_000_000, 0]);
      expect(receipt.allocations).toHaveLength(2);

      const customer = await getArCustomer(as(viewer), acme);
      expect([
        customer.invoicedMinor,
        customer.receivedMinor,
        customer.balanceMinor,
      ]).toEqual([15_000_000, 15_000_000, 0]);
      expect(await outbox("erp.ARReceiptAllocated")).toHaveLength(2);
    });

    it("computes Invoice 100,000 − Receipt 40,000 = outstanding 60,000", async () => {
      const invoice = await postedInvoice(simpleInvoice("100,000"));
      const receipt = await postedReceipt("40,000");
      await allocateReceipt(as(accountant), receipt.id, {
        allocations: [{ invoiceId: invoice.id, amount: "40,000" }],
      });
      expect((await getInvoice(as(viewer), invoice.id)).outstandingMinor).toBe(6_000_000);
      expect((await getArCustomer(as(viewer), acme)).balanceMinor).toBe(6_000_000);
    });

    it("refuses over-allocation, duplicate allocation and allocation to another customer", async () => {
      const invoice = await postedInvoice(simpleInvoice("20,000"));
      const other = await postedInvoice(simpleInvoice("5,000", { crmAccountId: nile }));
      const receipt = await postedReceipt("30,000");

      expect(
        (
          await failure(
            allocateReceipt(as(accountant), receipt.id, {
              allocations: [{ invoiceId: invoice.id, amount: "25,000" }],
            }),
          )
        ).message,
      ).toMatch(/more than the 20,000.00 outstanding/);
      expect(
        (
          await failure(
            allocateReceipt(as(accountant), receipt.id, {
              allocations: [{ invoiceId: invoice.id, amount: "35,000" }],
            }),
          )
        ).message,
      ).toMatch(/more than the 30,000.00 left/);
      expect(
        (
          await failure(
            allocateReceipt(as(accountant), receipt.id, {
              allocations: [{ invoiceId: other.id, amount: "1,000" }],
            }),
          )
        ).message,
      ).toMatch(/another customer/);

      await allocateReceipt(as(accountant), receipt.id, {
        allocations: [{ invoiceId: invoice.id, amount: "10,000" }],
      });
      expect(
        await failure(
          allocateReceipt(as(accountant), receipt.id, {
            allocations: [{ invoiceId: invoice.id, amount: "5,000" }],
          }),
        ),
      ).toBeInstanceOf(ConflictError);

      // Straight at the table: the trigger refuses to exceed the invoice.
      const extra = await postedReceipt("50,000");
      await expect(
        prisma.erpArReceiptAllocation.create({
          data: {
            receiptId: extra.id,
            invoiceId: invoice.id,
            amountMinor: 1_500_000n,
            createdBy: admin.id,
          },
        }),
      ).rejects.toThrow();
      const stored = await getInvoice(as(viewer), invoice.id);
      expect([stored.paidMinor, stored.outstandingMinor]).toEqual([1_000_000, 1_000_000]);
    });

    it("never over-allocates an invoice when two receipts are allocated at the same moment", async () => {
      const invoice = await postedInvoice(simpleInvoice("100,000"));
      const one = await postedReceipt("60,000");
      const two = await postedReceipt("60,000");
      const results = await Promise.allSettled([
        allocateReceipt(as(accountant), one.id, {
          allocations: [{ invoiceId: invoice.id, amount: "60,000" }],
        }),
        allocateReceipt(as(admin), two.id, {
          allocations: [{ invoiceId: invoice.id, amount: "60,000" }],
        }),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const stored = await getInvoice(as(viewer), invoice.id);
      expect([stored.paidMinor, stored.outstandingMinor, stored.status]).toEqual([
        6_000_000,
        4_000_000,
        "PARTIALLY_PAID",
      ]);
    });

    it("unallocates, then voids receipts and invoices only when nothing is allocated", async () => {
      const invoice = await postedInvoice(simpleInvoice("10,000"));
      const receipt = await postedReceipt("10,000");
      await allocateReceipt(as(accountant), receipt.id, {
        allocations: [{ invoiceId: invoice.id, amount: "10,000" }],
      });

      expect(
        (
          await failure(
            cancelReceipt(as(admin), receipt.id, {
              reason: "Bounced",
              voidDate: "2026-09-25",
            }),
          )
        ).message,
      ).toMatch(/Remove this receipt's allocations/);
      expect(
        (
          await failure(
            cancelInvoice(as(admin), invoice.id, {
              reason: "Error",
              voidDate: "2026-09-25",
            }),
          )
        ).message,
      ).toMatch(/Remove the receipt allocations/);
      expect(
        await failure(cancelReceipt(as(accountant), receipt.id, { reason: "Bounced" })),
      ).toBeInstanceOf(ForbiddenError);

      await unallocateReceipt(as(accountant), receipt.id, { invoiceId: invoice.id });
      expect((await getInvoice(as(viewer), invoice.id)).status).toBe("POSTED");
      await cancelReceipt(as(admin), receipt.id, {
        reason: "Bounced cheque",
        voidDate: "2026-09-25",
      });
      const voided = await getReceipt(as(viewer), receipt.id);
      expect(voided.status).toBe("CANCELLED");
      expect(voided.voidJournal).not.toBeNull();
      expect(await outbox("erp.ARReceiptUnallocated")).toHaveLength(1);
    });

    it("erp.ar_receipt.post and erp.ar_receipt.allocate: allowed for holders, refused otherwise", async () => {
      const invoice = await postedInvoice(simpleInvoice("1,000"));
      const { id } = await createReceipt(as(accountant), {
        crmAccountId: acme,
        receiptDate: "2026-09-20",
        amount: "1,000",
        paymentMethodId: bankTransfer,
        depositAccountId: cash,
      });
      expect(await failure(postReceipt(as(viewer), id))).toBeInstanceOf(ForbiddenError);
      await postReceipt(as(accountant), id);
      expect(
        await failure(
          allocateReceipt(as(viewer), id, {
            allocations: [{ invoiceId: invoice.id, amount: "1,000" }],
          }),
        ),
      ).toBeInstanceOf(ForbiddenError);
      expect(
        await failure(
          allocateReceipt(as(outsider), id, {
            allocations: [{ invoiceId: invoice.id, amount: "1,000" }],
          }),
        ),
      ).toBeInstanceOf(ForbiddenError);
      await allocateReceipt(as(accountant), id, {
        allocations: [{ invoiceId: invoice.id, amount: "1,000" }],
      });
      expect(
        await failure(createReceipt(as(viewer), { crmAccountId: acme })),
      ).toBeInstanceOf(ForbiddenError);
    });

    it("a finance administrator scoped to a unit approves nothing, and customer terms need erp.ar_customer.update", async () => {
      const unit = await createOrgUnit("finance-branch", "/root/finance-branch", 1);
      const adminRole = await prisma.role.findUniqueOrThrow({
        where: { key: "finance-admin" },
      });
      const scoped = await createUser({
        email: "branch.admin@example.com",
        orgUnitId: unit.id,
      });
      await grantRole(scoped.id, adminRole.id, { scopeType: "OWN_ORG_UNIT" });

      const { id } = await createInvoice(as(accountant), simpleInvoice("1,000"));
      await submitInvoice(as(accountant), id);
      expect(await failure(approveInvoice(as(scoped), id))).toBeInstanceOf(
        ForbiddenError,
      );
      expect(await failure(listInvoices(as(scoped)))).toBeInstanceOf(ForbiddenError);
      expect((await getInvoice(as(viewer), id)).status).toBe("PENDING_APPROVAL");

      const terms = {
        paymentTermsDays: "45",
        creditLimit: "250,000",
        receivableAccountId: "",
        notes: "",
      };
      for (const user of [accountant, viewer, outsider, scoped]) {
        expect(
          await failure(updateArCustomerProfile(as(user), acme, terms)),
        ).toBeInstanceOf(ForbiddenError);
      }
      expect(
        await prisma.erpArCustomerProfile.findUnique({ where: { crmAccountId: acme } }),
      ).toBeNull();
      await updateArCustomerProfile(as(admin), acme, terms);
      const profile = await prisma.erpArCustomerProfile.findUniqueOrThrow({
        where: { crmAccountId: acme },
      });
      expect([profile.paymentTermsDays, profile.creditLimitMinor]).toEqual([
        45,
        25_000_000n,
      ]);
    });
  });

  /* ========================================================================== */

  describe("credit notes (ADR-029)", () => {
    /** Create → submit (accountant) → approve (admin) → post (accountant). */
    const postedCreditNote = async (
      invoiceId: string,
      amount: string,
      overrides: Record<string, unknown> = {},
    ) => {
      const { id } = await createCreditNote(as(accountant), {
        invoiceId,
        creditNoteDate: "2026-09-15",
        reason: "Goods returned",
        lines: [
          {
            description: "Goods returned",
            quantity: "1",
            unitPrice: amount,
            discount: "",
            taxRateId: "",
            revenueAccountId: sales,
          },
        ],
        ...overrides,
      });
      await submitCreditNote(as(accountant), id);
      await approveCreditNote(as(admin), id);
      return { id, ...(await postCreditNote(as(accountant), id)) };
    };

    it("credits a posted invoice: revenue comes back out, and the invoice owes less", async () => {
      const invoice = await postedInvoice(simpleInvoice("100,000"));
      const credit = await postedCreditNote(invoice.id, "20,000");
      expect(credit.creditNoteNumber).toBe("CRN-2026-000001");

      const detail = await getCreditNote(as(admin), credit.id);
      expect([detail.status, detail.totalMinor, detail.invoice.id]).toEqual([
        "POSTED",
        2_000_000,
        invoice.id,
      ]);
      const journal = await getJournal(as(admin), detail.journal?.id ?? "");
      expect(journal.source).toEqual({
        module: "erp",
        type: "ar_credit_note",
        id: credit.id,
      });
      expect(
        journal.lines.map((line) => [
          line.account.code,
          line.debitMinor,
          line.creditMinor,
        ]),
      ).toEqual([
        ["4100", 2_000_000, 0],
        ["1200", 0, 2_000_000],
      ]);

      const credited = await getInvoice(as(viewer), invoice.id);
      expect([
        credited.creditedMinor,
        credited.outstandingMinor,
        credited.status,
      ]).toEqual([2_000_000, 8_000_000, "POSTED"]);
      const customer = await getArCustomer(as(viewer), acme);
      expect([customer.invoicedMinor, customer.balanceMinor]).toEqual([
        8_000_000, 8_000_000,
      ]);
      // The subledger still equals the receivables account in the ledger.
      expect((await getAccount(as(admin), receivables)).totals.balanceMinor).toBe(
        8_000_000,
      );
      expect(await outbox("erp.ARCreditNotePosted")).toHaveLength(1);
    });

    it("never credits more than the invoice still owes — in the service and in the database", async () => {
      const invoice = await postedInvoice(simpleInvoice("10,000"));
      const tooBig = await failure(
        createCreditNote(as(accountant), {
          invoiceId: invoice.id,
          creditNoteDate: "2026-09-15",
          reason: "Too much",
          lines: [
            {
              description: "Goods",
              quantity: "1",
              unitPrice: "12,000",
              discount: "",
              taxRateId: "",
              revenueAccountId: sales,
            },
          ],
        }),
      );
      expect(tooBig).toBeInstanceOf(BusinessRuleError);
      expect(tooBig.message).toMatch(/still outstanding/);

      await postedCreditNote(invoice.id, "6,000");
      expect((await getInvoice(as(viewer), invoice.id)).outstandingMinor).toBe(400_000);

      // A second credit note is measured against what is left.
      expect(
        (
          await failure(
            createCreditNote(as(accountant), {
              invoiceId: invoice.id,
              creditNoteDate: "2026-09-15",
              reason: "Again",
              lines: [
                {
                  description: "Goods",
                  quantity: "1",
                  unitPrice: "6,000",
                  discount: "",
                  taxRateId: "",
                  revenueAccountId: sales,
                },
              ],
            }),
          )
        ).message,
      ).toMatch(/still outstanding/);

      // Approved for the remaining 4,000 — then a receipt takes that 4,000 first, so
      // the database refuses the posting even though the service had allowed the draft.
      const { id } = await createCreditNote(as(accountant), {
        invoiceId: invoice.id,
        creditNoteDate: "2026-09-15",
        reason: "Remaining",
        lines: [
          {
            description: "Goods",
            quantity: "1",
            unitPrice: "4,000",
            discount: "",
            taxRateId: "",
            revenueAccountId: sales,
          },
        ],
      });
      await submitCreditNote(as(accountant), id);
      await approveCreditNote(as(admin), id);
      const receipt = await postedReceipt("4,000");
      await allocateReceipt(as(accountant), receipt.id, {
        allocations: [{ invoiceId: invoice.id, amount: "4,000" }],
      });
      expect((await failure(postCreditNote(as(accountant), id))).message).toMatch(
        /more than the outstanding amount of the invoice/,
      );
      const stored = await getInvoice(as(viewer), invoice.id);
      expect([stored.paidMinor, stored.creditedMinor, stored.outstandingMinor]).toEqual([
        400_000, 600_000, 0,
      ]);
    });

    it("voids a posted credit note, and refuses to void an invoice that was credited", async () => {
      const invoice = await postedInvoice(simpleInvoice("10,000"));
      const credit = await postedCreditNote(invoice.id, "4,000");
      expect((await getInvoice(as(viewer), invoice.id)).outstandingMinor).toBe(600_000);

      expect(
        (
          await failure(
            cancelInvoice(as(admin), invoice.id, {
              reason: "Billed in error",
              voidDate: "2026-09-25",
            }),
          )
        ).message,
      ).toMatch(/uncredited/);

      const voided = await cancelCreditNote(as(admin), credit.id, {
        reason: "Raised in error",
        voidDate: "2026-09-25",
      });
      expect(voided.voidJournalNumber).not.toBeNull();
      const detail = await getCreditNote(as(admin), credit.id);
      expect([detail.status, detail.voidJournal === null]).toEqual(["CANCELLED", false]);
      const restored = await getInvoice(as(viewer), invoice.id);
      expect([restored.creditedMinor, restored.outstandingMinor]).toEqual([0, 1_000_000]);
      expect(
        (await failure(cancelCreditNote(as(admin), credit.id, { reason: "Again" })))
          .message,
      ).toMatch(/already cancelled/);
      expect(await outbox("erp.ARCreditNoteCancelled")).toHaveLength(1);
    });

    it("erp.ar_credit_note.*: allowed for holders, refused otherwise, and never self-approved", async () => {
      const invoice = await postedInvoice(simpleInvoice("10,000"));
      const draft = {
        invoiceId: invoice.id,
        creditNoteDate: "2026-09-15",
        reason: "Goods returned",
        lines: [
          {
            description: "Goods",
            quantity: "1",
            unitPrice: "1,000",
            discount: "",
            taxRateId: "",
            revenueAccountId: sales,
          },
        ],
      };
      for (const user of [viewer, outsider]) {
        expect(await failure(listCreditNotes(as(user)))).toBeInstanceOf(ForbiddenError);
        expect(await failure(createCreditNote(as(user), draft))).toBeInstanceOf(
          ForbiddenError,
        );
      }

      const { id } = await createCreditNote(as(accountant), draft);
      expect(await failure(getCreditNote(as(viewer), id))).toBeInstanceOf(ForbiddenError);
      await submitCreditNote(as(accountant), id);
      // An accountant raises and posts credit notes, but never approves or voids one.
      expect(await failure(approveCreditNote(as(accountant), id))).toBeInstanceOf(
        ForbiddenError,
      );
      await approveCreditNote(as(admin), id);
      expect(
        await failure(cancelCreditNote(as(accountant), id, { reason: "No" })),
      ).toBeInstanceOf(ForbiddenError);
      await postCreditNote(as(accountant), id);

      // Nobody approves a credit note they raised themselves (§13.3).
      const own = await createCreditNote(as(admin), { ...draft, reason: "My own" });
      await submitCreditNote(as(admin), own.id);
      expect((await failure(approveCreditNote(as(admin), own.id))).message).toMatch(
        /created or submitted/,
      );
      await approveCreditNote(as(admin2), own.id);
      expect((await getCreditNote(as(admin), own.id)).status).toBe("APPROVED");
    });
  });

  describe("balances, aging and the ledger", () => {
    it("reports balance, statement and aging from posted documents", async () => {
      const old = await postedInvoice(
        simpleInvoice("10,000", { invoiceDate: "2026-06-15", dueDate: "2026-07-15" }),
      );
      await postedInvoice(
        simpleInvoice("20,000", { invoiceDate: "2026-09-01", dueDate: "2026-10-01" }),
      );
      await postedReceipt("5,000");
      expect(old.invoiceNumber).toBe("INV-2026-000001");

      const report = await getAgingReport(as(viewer), { asOf: "2026-09-30" });
      expect(report.bucketLabels).toEqual([
        "Current",
        "1–30",
        "31–60",
        "61–90",
        "91–120",
        "120+",
      ]);
      const row = report.rows.find((candidate) => candidate.customer.id === acme);
      expect(row?.bucketsMinor).toEqual([2_000_000, 0, 0, 1_000_000, 0, 0]);
      expect([row?.outstandingMinor, row?.unappliedMinor, row?.balanceMinor]).toEqual([
        3_000_000, 500_000, 2_500_000,
      ]);
      expect(report.totals.balanceMinor).toBe(2_500_000);

      const customer = await getArCustomer(as(viewer), acme, {
        from: "2026-09-01",
        to: "2026-09-30",
      });
      expect(customer.statement).toMatchObject({
        openingMinor: 1_000_000,
        invoicedMinor: 2_000_000,
        receivedMinor: 500_000,
        closingMinor: 2_500_000,
      });
      expect(customer.balanceMinor).toBe(2_500_000);

      const list = await listArCustomers(as(viewer), { q: "acme" });
      expect(list.rows.map((entry) => [entry.customer.name, entry.balanceMinor])).toEqual(
        [["Acme Trading", 2_500_000]],
      );
      expect((await listInvoices(as(viewer), { q: "acme" })).total).toBe(2);
      expect(await failure(getAgingReport(as(outsider)))).toBeInstanceOf(ForbiddenError);
    });

    it("keeps the receivables subledger equal to the general ledger", async () => {
      const a = await postedInvoice(simpleInvoice("70,000"));
      await postedInvoice(mixedInvoice({ crmAccountId: nile }));
      const receipt = await postedReceipt("50,000");
      await allocateReceipt(as(accountant), receipt.id, {
        allocations: [{ invoiceId: a.id, amount: "30,000" }],
      });

      const report = await getAgingReport(as(viewer), { asOf: "2026-09-30" });
      const ledger = await getAccount(as(admin), receivables);
      expect(ledger.totals.balanceMinor).toBe(report.totals.balanceMinor);
      expect(ledger.totals.balanceMinor).toBe(7_000_000 + 10_620_000 - 5_000_000);
    });

    it("refuses to close a period holding unposted invoices", async () => {
      await createInvoice(as(accountant), mixedInvoice());
      const september = await prisma.erpFiscalPeriod.findUniqueOrThrow({
        where: { name: "September 2026" },
      });
      expect((await failure(closePeriod(as(admin), september.id))).message).toMatch(
        /1 unposted invoice/,
      );
    });
  });
});
