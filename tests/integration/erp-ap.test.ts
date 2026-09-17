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
  ERP_VIEWER_PERMISSIONS,
} from "@/modules/erp/contracts/permissions";
import {
  approveBill,
  approvePayment,
  cancelBill,
  cancelPayment,
  closePeriod,
  createAccount,
  createBill,
  createPayment,
  createPeriod,
  createTaxRate,
  createVendor,
  createWithholdingTaxRate,
  getAccount,
  getApAgingReport,
  getBill,
  getJournal,
  getPayment,
  getVendor,
  listBills,
  listOpenBills,
  listPaymentMethods,
  listTaxRates,
  postBill,
  postPayment,
  rejectBill,
  reverseJournal,
  submitBill,
  submitPayment,
  updateApSettings,
  updateBill,
} from "@/modules/erp/contracts/service";
import {
  DEFAULT_NUMBER_SERIES,
  DEFAULT_PAYMENT_METHODS,
} from "@/modules/erp/domain/ar-defaults";
import {
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
 * ERP accounts payable against a real database (CLAUDE.md §20, ADR-033): vendors,
 * server-priced bills with input VAT, the approval and posting lifecycle for bills
 * and for payments, withholding tax on payment, settlement (including overpayment
 * under concurrency), voids, aging, the subledger-to-ledger tie-out, invariants
 * written straight at the tables, and allowed/refused for every AP control.
 */

async function failure(operation: Promise<unknown>): Promise<Error> {
  try {
    await operation;
  } catch (error) {
    return error as Error;
  }
  throw new Error("Expected the operation to fail, but it succeeded.");
}

describe.skipIf(!hasTestDatabase)("ERP accounts payable (integration)", () => {
  let prisma: PrismaClient;
  let admin: { id: string };
  let admin2: { id: string };
  let accountant: { id: string };
  let viewer: { id: string };
  let outsider: { id: string };

  let bank: string;
  let inputVat: string;
  let payables: string;
  let withholdingPayable: string;
  let outputVat: string;
  let rent: string;
  let equipment: string;
  let revenue: string;
  let vat14: string;
  let salesOnlyRate: string;
  let wht1: string;
  let wht5: string;
  let bankTransfer: string;
  let supplier: string;
  let otherSupplier: string;

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
    const viewerRole = await createRole("erp-user", ERP_VIEWER_PERMISSIONS);
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
      type: "ASSET" | "LIABILITY" | "REVENUE" | "EXPENSE",
    ) => (await createAccount(as(admin), { code, name, type })).id;
    bank = await account("1120", "Bank", "ASSET");
    inputVat = await account("1300", "Input VAT", "ASSET");
    equipment = await account("1500", "Equipment", "ASSET");
    payables = await account("2100", "Accounts payable", "LIABILITY");
    outputVat = await account("2150", "Output VAT", "LIABILITY");
    withholdingPayable = await account("2200", "Withholding tax payable", "LIABILITY");
    revenue = await account("4100", "Sales", "REVENUE");
    rent = await account("5200", "Rent", "EXPENSE");

    await createPeriod(as(admin), {
      name: "September 2026",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
    });
    await createPeriod(as(admin), {
      name: "October 2026",
      startDate: "2026-10-01",
      endDate: "2026-10-31",
    });

    await prisma.erpApSettings.create({
      data: { id: 1, defaultPayableAccountId: payables },
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
        taxAccountId: outputVat,
        inputTaxAccountId: inputVat,
      })
    ).id;
    salesOnlyRate = (
      await createTaxRate(as(admin), {
        code: "SALES5",
        name: "Sales tax 5%",
        rate: "5",
        taxAccountId: outputVat,
      })
    ).id;
    wht1 = (
      await createWithholdingTaxRate(as(admin), {
        code: "WHT1",
        name: "Withholding 1% (supplies)",
        rate: "1",
        payableAccountId: withholdingPayable,
      })
    ).id;
    wht5 = (
      await createWithholdingTaxRate(as(admin), {
        code: "WHT5",
        name: "Withholding 5% (professional services)",
        rate: "5",
        payableAccountId: withholdingPayable,
      })
    ).id;

    supplier = (
      await createVendor(as(accountant), {
        name: "Delta Office Supplies",
        taxRegistrationNumber: "123-456-789",
        paymentTermsDays: "30",
      })
    ).id;
    otherSupplier = (await createVendor(as(accountant), { name: "Cairo Rentals" })).id;
  });

  /** Net 100,000.00 of rent with 14% VAT: a total of 114,000.00. */
  const rentBill = (overrides: Record<string, unknown> = {}) => ({
    vendorId: supplier,
    vendorInvoiceNumber: "DOS-2026-0042",
    billDate: "2026-09-05",
    lines: [
      {
        description: "Office rent, September",
        quantity: "1",
        unitPrice: "100,000",
        discount: "",
        taxRateId: vat14,
        expenseAccountId: rent,
      },
    ],
    ...overrides,
  });

  /** Enter (accountant) → submit (accountant) → approve (admin) → post (accountant). */
  const postedBill = async (input = rentBill()) => {
    const { id } = await createBill(as(accountant), input);
    await submitBill(as(accountant), id);
    await approveBill(as(admin), id);
    const posted = await postBill(as(accountant), id);
    return { id, ...posted };
  };

  const paymentDraft = (
    lines: { billId: string; amount: string; withholdingTaxRateId?: string }[],
    overrides: Record<string, unknown> = {},
  ) => ({
    vendorId: supplier,
    paymentDate: "2026-09-25",
    paymentMethodId: bankTransfer,
    bankAccountId: bank,
    lines: lines.map((line) => ({ withholdingTaxRateId: "", ...line })),
    ...overrides,
  });

  /** Prepare (accountant) → submit (accountant) → approve (admin) → post (accountant). */
  const postedPayment = async (draft: ReturnType<typeof paymentDraft>) => {
    const { id } = await createPayment(as(accountant), draft);
    await submitPayment(as(accountant), id);
    await approvePayment(as(admin), id);
    const posted = await postPayment(as(accountant), id);
    return { id, ...posted };
  };

  const outbox = (name: string) => prisma.eventOutbox.findMany({ where: { name } });

  /* ========================================================================== */

  describe("vendors", () => {
    it("refuses a second vendor with the same name or tax registration, whatever the case", async () => {
      expect(
        await failure(createVendor(as(accountant), { name: "  delta office SUPPLIES " })),
      ).toBeInstanceOf(ConflictError);
      expect(
        await failure(
          createVendor(as(accountant), {
            name: "Someone else",
            taxRegistrationNumber: "123-456-789",
          }),
        ),
      ).toBeInstanceOf(ConflictError);
    });

    it("links a vendor to a live CRM company by id only, and refuses a deleted one", async () => {
      const company = await prisma.crmAccount.create({ data: { name: "Delta Group" } });
      const gone = await prisma.crmAccount.create({
        data: { name: "Gone Ltd", deletedAt: new Date() },
      });
      const { id } = await createVendor(as(accountant), {
        name: "Delta Group Purchasing",
        crmAccountId: company.id,
      });
      const vendor = await getVendor(as(viewer), id);
      expect(vendor.crmAccount).toEqual({
        id: company.id,
        name: "Delta Group",
        existsInCrm: true,
      });
      expect(
        await failure(
          createVendor(as(accountant), { name: "Ghost Vendor", crmAccountId: gone.id }),
        ),
      ).toBeInstanceOf(Error);
    });

    it("refuses new bills for an inactive vendor", async () => {
      await prisma.erpVendor.update({
        where: { id: otherSupplier },
        data: { isActive: false },
      });
      const error = await failure(
        createBill(as(accountant), rentBill({ vendorId: otherSupplier })),
      );
      expect(error).toBeInstanceOf(BusinessRuleError);
      expect(error.message).toMatch(/inactive/);
    });
  });

  describe("bills", () => {
    it("prices a draft on the server, with due date from the vendor's terms", async () => {
      const { id } = await createBill(as(accountant), {
        ...rentBill(),
        totalMinor: 1,
        status: "POSTED",
        billNumber: "HACKED",
      });
      const bill = await getBill(as(viewer), id);
      expect(bill.status).toBe("DRAFT");
      expect(bill.billNumber).toBeNull();
      expect(bill.subtotalMinor).toBe(10_000_000);
      expect(bill.taxMinor).toBe(1_400_000);
      expect(bill.totalMinor).toBe(11_400_000);
      expect(bill.dueDate).toBe("2026-10-05");
      expect(bill.payableAccount.id).toBe(payables);
    });

    it("refuses the same supplier invoice twice for a vendor, until the first is cancelled", async () => {
      const first = await createBill(as(accountant), rentBill());
      const duplicate = await failure(
        createBill(as(accountant), rentBill({ vendorInvoiceNumber: " dos-2026-0042 " })),
      );
      expect(duplicate).toBeInstanceOf(ValidationError);
      // Another vendor may use the same number.
      await createBill(as(accountant), rentBill({ vendorId: otherSupplier }));

      await cancelBill(as(admin), first.id, { reason: "Entered twice" });
      await createBill(as(accountant), rentBill());
    });

    it("refuses a tax rate that has no input tax account", async () => {
      const error = await failure(
        createBill(
          as(accountant),
          rentBill({
            lines: [
              {
                description: "Printing",
                quantity: "1",
                unitPrice: "1,000",
                discount: "",
                taxRateId: salesOnlyRate,
                expenseAccountId: rent,
              },
            ],
          }),
        ),
      );
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).fieldErrors["lines.0.taxRateId"]?.[0]).toMatch(
        /no input tax account/,
      );
    });

    it("accepts asset lines and refuses revenue accounts", async () => {
      const line = (accountId: string) => ({
        description: "Laptop",
        quantity: "2",
        unitPrice: "30,000",
        discount: "",
        taxRateId: "",
        expenseAccountId: accountId,
      });
      await createBill(as(accountant), rentBill({ lines: [line(equipment)] }));
      expect(
        await failure(
          createBill(
            as(accountant),
            rentBill({ vendorInvoiceNumber: "X-2", lines: [line(revenue)] }),
          ),
        ),
      ).toBeInstanceOf(ValidationError);
    });

    it("refuses self-approval, and a rejection returns the bill to draft with the reason", async () => {
      const { id } = await createBill(as(admin), rentBill());
      await submitBill(as(admin), id);
      expect((await failure(approveBill(as(admin), id))).message).toMatch(
        /cannot approve a bill you entered/,
      );
      await rejectBill(as(admin2), id, { reason: "Wrong cost centre" });
      const bill = await getBill(as(viewer), id);
      expect(bill.status).toBe("DRAFT");
      expect(bill.rejectionReason).toBe("Wrong cost centre");
      await updateBill(as(accountant), id, rentBill({ notes: "Corrected" }));
    });

    it("skips approval below the threshold", async () => {
      await updateApSettings(as(admin), {
        defaultPayableAccountId: payables,
        billApprovalRequired: true,
        billApprovalThreshold: "200,000",
        paymentApprovalRequired: true,
        paymentApprovalThreshold: "",
        allowSelfApproval: false,
        defaultPaymentTermsDays: "30",
        agingBucketDays: "30, 60, 90",
      });
      const { id } = await createBill(as(accountant), rentBill());
      expect(await submitBill(as(accountant), id)).toEqual({ status: "APPROVED" });
      expect((await getBill(as(viewer), id)).approvalSkipped).toBe(true);
    });

    it("posts a balanced journal: Dr expense, Dr input VAT, Cr payable", async () => {
      const { id, billNumber } = await postedBill();
      expect(billNumber).toBe("BILL-2026-000001");

      const bill = await getBill(as(viewer), id);
      expect(bill.status).toBe("POSTED");
      expect(bill.outstandingMinor).toBe(11_400_000);
      const journal = await getJournal(as(admin), bill.journal?.id ?? "");
      expect(journal.source).toEqual({ module: "erp", type: "ap_bill", id });
      expect(journal.debitTotalMinor).toBe(11_400_000);
      expect(journal.creditTotalMinor).toBe(11_400_000);
      const byAccount = (accountId: string) =>
        journal.lines.filter((line) => line.account.id === accountId);
      expect(byAccount(rent)[0]?.debitMinor).toBe(10_000_000);
      expect(byAccount(inputVat)[0]?.debitMinor).toBe(1_400_000);
      expect(byAccount(payables)[0]?.creditMinor).toBe(11_400_000);
      expect(await outbox("erp.APBillPosted")).toHaveLength(1);

      // A journal raised by a bill is corrected only by voiding the bill.
      expect(
        (
          await failure(
            reverseJournal(as(admin), journal.id, { reversalDate: "2026-09-26" }),
          )
        ).message,
      ).toMatch(/Void that document instead/);
    });

    it("keeps a posted bill frozen even for a writer that bypasses the services", async () => {
      const { id } = await postedBill();
      await expect(
        prisma.erpApBill.update({ where: { id }, data: { notes: "rewritten" } }),
      ).rejects.toThrow(/posted bill cannot be changed/);
      await expect(
        prisma.erpApBillLine.updateMany({
          where: { billId: id },
          data: { description: "x" },
        }),
      ).rejects.toThrow(/cannot be changed/);
      await expect(prisma.erpApBill.delete({ where: { id } })).rejects.toThrow(
        /only a draft bill can be deleted/,
      );
    });

    it("voids an unpaid posted bill by reversal", async () => {
      const { id } = await postedBill();
      const { voidJournalNumber } = await cancelBill(as(admin), id, {
        reason: "Duplicate of an earlier bill",
        voidDate: "2026-09-28",
      });
      expect(voidJournalNumber).not.toBeNull();
      const bill = await getBill(as(viewer), id);
      expect(bill.status).toBe("CANCELLED");
      expect(bill.outstandingMinor).toBe(0);
      expect((await getJournal(as(admin), bill.journal?.id ?? "")).status).toBe(
        "REVERSED",
      );
    });
  });

  describe("payments and withholding", () => {
    it("withholds on the VAT-exclusive part and pays the rest: Dr payable, Cr bank, Cr withholding", async () => {
      const bill = await postedBill();
      const payment = await postedPayment(
        paymentDraft([
          { billId: bill.id, amount: "114,000", withholdingTaxRateId: wht1 },
        ]),
      );
      expect(payment.paymentNumber).toBe("PAY-2026-000001");

      const detail = await getPayment(as(viewer), payment.id);
      expect(detail.amountMinor).toBe(11_400_000);
      // 1% of the 100,000.00 net — not of the 114,000.00 including VAT.
      expect(detail.lines[0]?.withholdingBaseMinor).toBe(10_000_000);
      expect(detail.withheldMinor).toBe(100_000);
      expect(detail.cashMinor).toBe(11_300_000);

      const journal = await getJournal(as(admin), detail.journal?.id ?? "");
      expect(journal.source).toEqual({
        module: "erp",
        type: "ap_payment",
        id: payment.id,
      });
      const byAccount = (accountId: string) =>
        journal.lines.filter((line) => line.account.id === accountId);
      expect(byAccount(payables)[0]?.debitMinor).toBe(11_400_000);
      expect(byAccount(bank)[0]?.creditMinor).toBe(11_300_000);
      expect(byAccount(withholdingPayable)[0]?.creditMinor).toBe(100_000);

      const paid = await getBill(as(viewer), bill.id);
      expect(paid.status).toBe("PAID");
      expect(paid.outstandingMinor).toBe(0);
      expect(paid.settlements).toEqual([
        expect.objectContaining({ amountMinor: 11_400_000, withheldMinor: 100_000 }),
      ]);
      expect(await outbox("erp.APPaymentPosted")).toHaveLength(1);
    });

    it("pays in parts, and never more than a bill owes — counting drafts in progress", async () => {
      const bill = await postedBill();
      await postedPayment(
        paymentDraft([{ billId: bill.id, amount: "50,000", withholdingTaxRateId: wht5 }]),
      );
      const part = await getBill(as(viewer), bill.id);
      expect(part.status).toBe("PARTIALLY_PAID");
      expect(part.outstandingMinor).toBe(6_400_000);
      expect((await listOpenBills(as(accountant), supplier))[0]?.outstandingMinor).toBe(
        6_400_000,
      );

      expect(
        await failure(
          createPayment(
            as(accountant),
            paymentDraft([{ billId: bill.id, amount: "64,000.01" }]),
          ),
        ),
      ).toBeInstanceOf(ValidationError);
      await createPayment(
        as(accountant),
        paymentDraft([{ billId: bill.id, amount: "40,000" }]),
      );
      // 40,000 is already promised by the draft above, so 30,000 more is too much.
      const error = await failure(
        createPayment(
          as(accountant),
          paymentDraft([{ billId: bill.id, amount: "30,000" }]),
        ),
      );
      expect((error as ValidationError).fieldErrors["lines.0.amount"]?.[0]).toMatch(
        /payments in progress/,
      );
    });

    it("refuses to settle another vendor's bill", async () => {
      const bill = await postedBill();
      const error = await failure(
        createPayment(
          as(accountant),
          paymentDraft([{ billId: bill.id, amount: "1,000" }], {
            vendorId: otherSupplier,
          }),
        ),
      );
      expect((error as ValidationError).fieldErrors["lines.0.billId"]?.[0]).toMatch(
        /another vendor/,
      );
    });

    it("lets only one of two approved payments for the whole bill post", async () => {
      const bill = await postedBill();
      const approved = async () => {
        const { id } = await prisma.erpApPayment.create({
          data: {
            vendorId: supplier,
            paymentDate: new Date("2026-09-25"),
            paymentMethodId: bankTransfer,
            bankAccountId: bank,
            payableAccountId: payables,
            amountMinor: 11_400_000n,
            cashMinor: 11_400_000n,
            createdBy: accountant.id,
            lines: {
              create: [
                {
                  lineNo: 1,
                  billId: bill.id,
                  amountMinor: 11_400_000n,
                  cashMinor: 11_400_000n,
                },
              ],
            },
          },
          select: { id: true },
        });
        await submitPayment(as(accountant), id);
        await approvePayment(as(admin), id);
        return id;
      };
      const first = await approved();
      const second = await approved();

      const results = await Promise.allSettled([
        postPayment(as(accountant), first),
        postPayment(as(accountant), second),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const paid = await getBill(as(viewer), bill.id);
      expect(paid.paidMinor).toBe(11_400_000);
      expect(paid.status).toBe("PAID");
    });

    it("refuses self-approval of a payment, and approval skipped below the threshold", async () => {
      const bill = await postedBill();
      const { id } = await createPayment(
        as(admin),
        paymentDraft([{ billId: bill.id, amount: "1,000" }]),
      );
      await submitPayment(as(admin), id);
      expect((await failure(approvePayment(as(admin), id))).message).toMatch(
        /cannot approve a payment you prepared/,
      );
      await approvePayment(as(admin2), id);

      await updateApSettings(as(admin), {
        defaultPayableAccountId: payables,
        billApprovalRequired: true,
        billApprovalThreshold: "",
        paymentApprovalRequired: true,
        paymentApprovalThreshold: "5,000",
        allowSelfApproval: false,
        defaultPaymentTermsDays: "30",
        agingBucketDays: "30, 60, 90",
      });
      const small = await createPayment(
        as(accountant),
        paymentDraft([{ billId: bill.id, amount: "2,000" }]),
      );
      expect(await submitPayment(as(accountant), small.id)).toEqual({
        status: "APPROVED",
      });
      const audit = await prisma.auditLog.findFirst({
        where: { action: "erp.ap_settings.updated" },
        select: { severity: true },
      });
      expect(audit?.severity).toBe("NOTICE");
    });

    it("voiding a payment makes the bill owe again; a paid bill cannot be voided until then", async () => {
      const bill = await postedBill();
      const payment = await postedPayment(
        paymentDraft([
          { billId: bill.id, amount: "114,000", withholdingTaxRateId: wht1 },
        ]),
      );
      expect(
        (await failure(cancelBill(as(admin), bill.id, { reason: "x" }))).message,
      ).toMatch(/Void the payments/);

      await cancelPayment(as(admin), payment.id, {
        reason: "Sent to the wrong account",
        voidDate: "2026-09-29",
      });
      const owed = await getBill(as(viewer), bill.id);
      expect(owed.status).toBe("POSTED");
      expect(owed.outstandingMinor).toBe(11_400_000);
      const voided = await getPayment(as(viewer), payment.id);
      expect(voided.status).toBe("CANCELLED");
      expect((await getJournal(as(admin), voided.journal?.id ?? "")).status).toBe(
        "REVERSED",
      );

      await cancelBill(as(admin), bill.id, {
        reason: "Disputed",
        voidDate: "2026-09-30",
      });
    });

    it("refuses at commit a withholding base that is not the VAT-exclusive share", async () => {
      const bill = await postedBill();
      await expect(
        prisma.erpApPayment.create({
          data: {
            vendorId: supplier,
            paymentDate: new Date("2026-09-25"),
            paymentMethodId: bankTransfer,
            bankAccountId: bank,
            payableAccountId: payables,
            amountMinor: 11_400_000n,
            withheldMinor: 114_000n,
            cashMinor: 11_286_000n,
            createdBy: accountant.id,
            lines: {
              create: [
                {
                  lineNo: 1,
                  billId: bill.id,
                  amountMinor: 11_400_000n,
                  withholdingTaxRateId: wht1,
                  withholdingBasisPoints: 100,
                  // Withholding on the VAT too: the database refuses it.
                  withholdingBaseMinor: 11_400_000n,
                  withheldMinor: 114_000n,
                  cashMinor: 11_286_000n,
                },
              ],
            },
          },
        }),
      ).rejects.toThrow(/VAT-exclusive/);
    });
  });

  describe("balances, aging and controls", () => {
    it("ties the vendor balance and AP aging to the payable account in the ledger", async () => {
      const first = await postedBill();
      await postedBill(
        rentBill({ vendorInvoiceNumber: "DOS-2026-0043", billDate: "2026-09-10" }),
      );
      await postedBill(
        rentBill({
          vendorId: otherSupplier,
          vendorInvoiceNumber: "CR-9",
          lines: [
            {
              description: "Storage",
              quantity: "1",
              unitPrice: "20,000",
              discount: "",
              taxRateId: "",
              expenseAccountId: rent,
            },
          ],
        }),
      );
      await postedPayment(
        paymentDraft([
          { billId: first.id, amount: "114,000", withholdingTaxRateId: wht1 },
        ]),
      );

      const report = await getApAgingReport(as(viewer), { asOf: "2026-11-30" });
      const ledger = await getAccount(as(admin), payables);
      expect(report.totals.outstandingMinor).toBe(11_400_000 + 2_000_000);
      expect(ledger.totals.balanceMinor).toBe(report.totals.outstandingMinor);
      expect(report.rows.map((row) => row.vendor.name)).toEqual([
        "Delta Office Supplies",
        "Cairo Rentals",
      ]);

      const vendor = await getVendor(as(viewer), supplier);
      expect(vendor.outstandingMinor).toBe(11_400_000);
      expect(vendor.billedMinor).toBe(22_800_000);
      expect(vendor.paidMinor).toBe(11_400_000);
      expect((await getAccount(as(admin), withholdingPayable)).totals.balanceMinor).toBe(
        100_000,
      );
    });

    it("refuses to close a period holding an unposted bill", async () => {
      await createBill(as(accountant), rentBill());
      const september = await prisma.erpFiscalPeriod.findUniqueOrThrow({
        where: { name: "September 2026" },
      });
      expect((await failure(closePeriod(as(admin), september.id))).message).toMatch(
        /1 unposted bill/,
      );
    });

    it("allows and refuses each AP control by role", async () => {
      const bill = await createBill(as(accountant), rentBill());
      await submitBill(as(accountant), bill.id);

      // The accountant enters and posts; approving, cancelling and settings are refused.
      expect(await failure(approveBill(as(accountant), bill.id))).toBeInstanceOf(
        ForbiddenError,
      );
      expect(
        await failure(cancelBill(as(accountant), bill.id, { reason: "x" })),
      ).toBeInstanceOf(ForbiddenError);
      expect(
        await failure(
          updateApSettings(as(accountant), {
            defaultPayableAccountId: payables,
            billApprovalRequired: false,
            paymentApprovalRequired: false,
            allowSelfApproval: true,
            defaultPaymentTermsDays: "30",
            agingBucketDays: "30",
          }),
        ),
      ).toBeInstanceOf(ForbiddenError);
      expect(
        await failure(
          createWithholdingTaxRate(as(accountant), {
            code: "WHT3",
            name: "Withholding 3%",
            rate: "3",
            payableAccountId: withholdingPayable,
          }),
        ),
      ).toBeInstanceOf(ForbiddenError);

      await approveBill(as(admin), bill.id);
      await postBill(as(accountant), bill.id);
      const payment = await createPayment(
        as(accountant),
        paymentDraft([{ billId: bill.id, amount: "1,000" }]),
      );
      await submitPayment(as(accountant), payment.id);
      expect(await failure(approvePayment(as(accountant), payment.id))).toBeInstanceOf(
        ForbiddenError,
      );
      expect(
        await failure(cancelPayment(as(accountant), payment.id, { reason: "x" })),
      ).toBeInstanceOf(ForbiddenError);

      // The ERP Finance section role reads and nothing more.
      expect((await listBills(as(viewer))).total).toBe(1);
      expect(await failure(createBill(as(viewer), rentBill()))).toBeInstanceOf(
        ForbiddenError,
      );
      expect(
        await failure(createVendor(as(viewer), { name: "Viewer Vendor" })),
      ).toBeInstanceOf(ForbiddenError);
      expect(
        await failure(
          createPayment(as(viewer), paymentDraft([{ billId: bill.id, amount: "1,000" }])),
        ),
      ).toBeInstanceOf(ForbiddenError);

      // Someone without ERP access sees nothing.
      expect(await failure(listBills(as(outsider)))).toBeInstanceOf(ForbiddenError);
      expect(await failure(getVendor(as(outsider), supplier))).toBeInstanceOf(
        ForbiddenError,
      );
      expect(await failure(getApAgingReport(as(outsider)))).toBeInstanceOf(
        ForbiddenError,
      );
    });

    it("lets a payables-only clerk list active tax rates and payment methods, but not every rate", async () => {
      const clerkRole = await createRole("ap-clerk", [
        ERP_PERMISSIONS.AP_BILL_READ,
        ERP_PERMISSIONS.AP_PAYMENT_READ,
      ]);
      const clerk = await createUser({ email: "ap.clerk@example.com" });
      await grantRole(clerk.id, clerkRole.id);

      // Bill and payment forms need these lists without any receivables permission.
      expect(
        (await listTaxRates(as(clerk), { activeOnly: true })).length,
      ).toBeGreaterThan(0);
      expect(
        (await listPaymentMethods(as(clerk), { activeOnly: true })).length,
      ).toBeGreaterThan(0);
      expect(
        await failure(listTaxRates(as(clerk), { activeOnly: false })),
      ).toBeInstanceOf(ForbiddenError);
      expect(
        await failure(listPaymentMethods(as(clerk), { activeOnly: false })),
      ).toBeInstanceOf(ForbiddenError);
      expect(
        await failure(listTaxRates(as(outsider), { activeOnly: true })),
      ).toBeInstanceOf(ForbiddenError);
    });
  });
});
