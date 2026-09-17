import { describe, expect, it } from "vitest";
import {
  ERP_ACCOUNTANT_PERMISSIONS,
  ERP_FINANCE_ADMIN_PERMISSIONS,
  ERP_PERMISSIONS,
  ERP_VIEWER_PERMISSIONS,
} from "@/modules/erp/contracts/permissions";
import {
  apBillDraftSchema,
  apPaymentDraftSchema,
  vendorSchema,
  withholdingTaxRateSchema,
} from "@/modules/erp/contracts/schemas";
import {
  calculatePaymentLine,
  paymentTotals,
  withheldAmount,
  withholdingBase,
} from "@/modules/erp/domain/ap";

/**
 * Accounts payable rules without a database (ADR-033). The database re-derives the
 * same figures; these tests pin the arithmetic the services and the SQL share.
 */

const uuid = "5b1f5c1e-8d4f-4f7a-9f55-2f1c3e6b0a11";
const other = "6c2a6d2f-9e5a-4a8b-8a66-3a2d4f7c1b22";

describe("withholding", () => {
  it("withholds on the VAT-exclusive share of the amount settled", () => {
    // Bill: net 100,000.00 + 14% VAT = 114,000.00. Paying it in full.
    expect(withholdingBase(11_400_000n, 10_000_000n, 11_400_000n)).toBe(10_000_000n);
    // Paying half: half of the net.
    expect(withholdingBase(5_700_000n, 10_000_000n, 11_400_000n)).toBe(5_000_000n);
    // A bill without VAT: the whole amount.
    expect(withholdingBase(250_000n, 250_000n, 250_000n)).toBe(250_000n);
    expect(withholdingBase(1_000n, 0n, 0n)).toBe(0n);
  });

  it("rounds half away from zero, like the database", () => {
    // 1% of 0.50 = 0.005 → 0.01; 1% of 0.49 = 0.0049 → 0.00.
    expect(withheldAmount(50n, 100)).toBe(1n);
    expect(withheldAmount(49n, 100)).toBe(0n);
    // 3% of 333.33 = 9.9999 → 10.00.
    expect(withheldAmount(33_333n, 300)).toBe(1_000n);
  });

  it("pays amount − withheld, and nothing is withheld without a rate", () => {
    expect(
      calculatePaymentLine({
        amountMinor: 11_400_000n,
        billNetMinor: 10_000_000n,
        billTotalMinor: 11_400_000n,
        withholdingBasisPoints: 500,
      }),
    ).toEqual({
      amountMinor: 11_400_000n,
      withholdingBaseMinor: 10_000_000n,
      withheldMinor: 500_000n,
      cashMinor: 10_900_000n,
    });
    expect(
      calculatePaymentLine({
        amountMinor: 1_000n,
        billNetMinor: 1_000n,
        billTotalMinor: 1_000n,
        withholdingBasisPoints: null,
      }),
    ).toEqual({
      amountMinor: 1_000n,
      withholdingBaseMinor: 0n,
      withheldMinor: 0n,
      cashMinor: 1_000n,
    });
  });

  it("sums lines into the payment's totals", () => {
    const a = calculatePaymentLine({
      amountMinor: 11_400_000n,
      billNetMinor: 10_000_000n,
      billTotalMinor: 11_400_000n,
      withholdingBasisPoints: 100,
    });
    const b = calculatePaymentLine({
      amountMinor: 2_000_000n,
      billNetMinor: 2_000_000n,
      billTotalMinor: 2_000_000n,
      withholdingBasisPoints: null,
    });
    expect(paymentTotals([a, b])).toEqual({
      amountMinor: 13_400_000n,
      withheldMinor: 100_000n,
      cashMinor: 13_300_000n,
    });
  });
});

describe("payables schemas", () => {
  it("needs the supplier's invoice number and refuses a due date before the bill", () => {
    const bill = {
      vendorId: uuid,
      vendorInvoiceNumber: "INV-7",
      billDate: "2026-09-10",
      dueDate: "2026-09-01",
      lines: [
        {
          description: "Paper",
          quantity: "1",
          unitPrice: "100",
          discount: "",
          taxRateId: "",
          expenseAccountId: other,
        },
      ],
    };
    expect(apBillDraftSchema.safeParse(bill).success).toBe(false);
    expect(apBillDraftSchema.safeParse({ ...bill, dueDate: "" }).success).toBe(true);
    expect(
      apBillDraftSchema.safeParse({ ...bill, dueDate: "", vendorInvoiceNumber: "  " })
        .success,
    ).toBe(false);
  });

  it("refuses a payment that names a bill twice or pays nothing", () => {
    const payment = {
      vendorId: uuid,
      paymentDate: "2026-09-25",
      paymentMethodId: uuid,
      bankAccountId: other,
      lines: [
        { billId: other, amount: "100", withholdingTaxRateId: "" },
        { billId: other, amount: "50", withholdingTaxRateId: "" },
      ],
    };
    expect(apPaymentDraftSchema.safeParse(payment).success).toBe(false);
    expect(
      apPaymentDraftSchema.safeParse({
        ...payment,
        lines: [{ billId: other, amount: "0", withholdingTaxRateId: "" }],
      }).success,
    ).toBe(false);
  });

  it("validates vendor email and refuses a zero withholding rate", () => {
    expect(vendorSchema.safeParse({ name: "Delta", email: "not-an-email" }).success).toBe(
      false,
    );
    expect(vendorSchema.safeParse({ name: "Delta", email: "" }).success).toBe(true);
    const rate = { code: "WHT0", name: "Zero", rate: "0", payableAccountId: uuid };
    expect(withholdingTaxRateSchema.safeParse(rate).success).toBe(false);
    expect(withholdingTaxRateSchema.safeParse({ ...rate, rate: "1" }).success).toBe(true);
  });
});

describe("payables roles", () => {
  it("gives finance administrators every AP control", () => {
    for (const key of Object.values(ERP_PERMISSIONS).filter((k) =>
      k.startsWith("erp.ap_"),
    )) {
      expect(ERP_FINANCE_ADMIN_PERMISSIONS).toContain(key);
    }
  });

  it("lets accountants enter and post, not approve, cancel or configure", () => {
    expect(ERP_ACCOUNTANT_PERMISSIONS).toContain(ERP_PERMISSIONS.AP_BILL_POST);
    expect(ERP_ACCOUNTANT_PERMISSIONS).toContain(ERP_PERMISSIONS.AP_PAYMENT_POST);
    for (const key of [
      ERP_PERMISSIONS.AP_BILL_APPROVE,
      ERP_PERMISSIONS.AP_BILL_CANCEL,
      ERP_PERMISSIONS.AP_PAYMENT_APPROVE,
      ERP_PERMISSIONS.AP_PAYMENT_CANCEL,
      ERP_PERMISSIONS.AP_SETTINGS_ADMINISTER,
    ]) {
      expect(ERP_ACCOUNTANT_PERMISSIONS).not.toContain(key);
    }
  });

  it("lets the ERP Finance section role read payables and nothing else", () => {
    const ap = ERP_VIEWER_PERMISSIONS.filter((key) => key.startsWith("erp.ap_"));
    expect(ap.length).toBe(4);
    expect(ap.every((key) => key.endsWith(".read"))).toBe(true);
  });
});
