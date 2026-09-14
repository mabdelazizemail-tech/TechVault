import { describe, expect, it } from "vitest";
import {
  ERP_ACCOUNTANT_PERMISSIONS,
  ERP_FINANCE_ADMIN_PERMISSIONS,
  ERP_PERMISSIONS,
  ERP_PERMISSION_DEFINITIONS,
} from "@/modules/erp/contracts/permissions";
import {
  arAllocationSchema,
  arInvoiceDraftSchema,
  arSettingsSchema,
  taxRateSchema,
} from "@/modules/erp/contracts/schemas";
import {
  addDays,
  agingBoundaryProblem,
  agingBucketIndex,
  agingBucketLabels,
  approvalRequired,
  calculateLine,
  daysBetween,
  divideRounded,
  formatBasisPoints,
  formatDocumentNumber,
  formatQuantity,
  invoiceTotals,
  lineProblems,
  parseQuantityText,
  parseRateText,
  paymentStatus,
  quantityToDecimal,
} from "@/modules/erp/domain/ar";

/**
 * Accounts receivable arithmetic and rules, without a database (CLAUDE.md §20).
 */

describe("quantities", () => {
  it("parses exact quantities to four decimal places", () => {
    expect(parseQuantityText("2.5")).toEqual({ ok: true, scaled: 25_000n });
    expect(parseQuantityText("1,000")).toEqual({ ok: true, scaled: 10_000_000n });
    expect(quantityToDecimal(25_000n)).toBe("2.5000");
    expect(formatQuantity("2.5000")).toBe("2.5");
    expect(formatQuantity("3.0000")).toBe("3");
  });

  it("rejects zero, negative, too precise and non-numeric quantities", () => {
    for (const bad of ["0", "-1", "1.23456", "two", ""]) {
      expect(parseQuantityText(bad).ok, bad).toBe(false);
    }
  });
});

describe("divideRounded — half away from zero, like Postgres round(numeric)", () => {
  it("rounds halves away from zero", () => {
    expect(divideRounded(5n, 2n)).toBe(3n);
    expect(divideRounded(-5n, 2n)).toBe(-3n);
    expect(divideRounded(4n, 3n)).toBe(1n);
    expect(divideRounded(5n, 3n)).toBe(2n);
  });
});

describe("calculateLine — the server's pricing", () => {
  it("computes gross, discount, net, tax and total", () => {
    // 2 × 40,000.00 at 14%
    expect(
      calculateLine({
        quantityScaled: 20_000n,
        unitPriceMinor: 4_000_000n,
        discountMinor: 0n,
        taxBasisPoints: 1400,
      }),
    ).toEqual({
      grossMinor: 8_000_000n,
      discountMinor: 0n,
      netMinor: 8_000_000n,
      taxMinor: 1_120_000n,
      totalMinor: 9_120_000n,
    });
  });

  it("applies the discount before tax and rounds tax per line", () => {
    // 1 × 219.30 − 0 at 14% = 30.702 → 30.70
    expect(
      calculateLine({
        quantityScaled: 10_000n,
        unitPriceMinor: 21_930n,
        discountMinor: 0n,
        taxBasisPoints: 1400,
      }).taxMinor,
    ).toBe(3_070n);
    // 1 × 1,000.00 − 100.00 discount at 14% on 900.00
    const line = calculateLine({
      quantityScaled: 10_000n,
      unitPriceMinor: 100_000n,
      discountMinor: 10_000n,
      taxBasisPoints: 1400,
    });
    expect([line.netMinor, line.taxMinor, line.totalMinor]).toEqual([
      90_000n,
      12_600n,
      102_600n,
    ]);
  });

  it("rounds a fractional quantity amount half away from zero", () => {
    // 0.5 × 0.01 = 0.005 → 0.01
    expect(
      calculateLine({
        quantityScaled: 5_000n,
        unitPriceMinor: 1n,
        discountMinor: 0n,
        taxBasisPoints: null,
      }).grossMinor,
    ).toBe(1n);
  });

  it("flags a discount above the line amount", () => {
    expect(
      lineProblems({
        quantityScaled: 10_000n,
        unitPriceMinor: 500n,
        discountMinor: 600n,
        taxBasisPoints: null,
      }),
    ).toEqual([
      { field: "discount", message: "The discount cannot be more than the line amount." },
    ]);
  });

  it("sums invoice totals so total = subtotal − discount + tax", () => {
    const totals = invoiceTotals([
      calculateLine({
        quantityScaled: 20_000n,
        unitPriceMinor: 4_000_000n,
        discountMinor: 0n,
        taxBasisPoints: 1400,
      }),
      calculateLine({
        quantityScaled: 10_000n,
        unitPriceMinor: 2_000_000n,
        discountMinor: 500_000n,
        taxBasisPoints: null,
      }),
    ]);
    expect(totals).toEqual({
      subtotalMinor: 10_000_000n,
      discountMinor: 500_000n,
      taxMinor: 1_120_000n,
      totalMinor: 10_620_000n,
    });
    expect(totals.totalMinor).toBe(
      totals.subtotalMinor - totals.discountMinor + totals.taxMinor,
    );
  });
});

describe("tax rates", () => {
  it("parses and formats rates as basis points", () => {
    expect(parseRateText("14")).toEqual({ ok: true, basisPoints: 1400 });
    expect(parseRateText("14.5%")).toEqual({ ok: true, basisPoints: 1450 });
    expect(parseRateText("101").ok).toBe(false);
    expect(parseRateText("abc").ok).toBe(false);
    expect(formatBasisPoints(1400)).toBe("14%");
    expect(formatBasisPoints(1450)).toBe("14.5%");
    expect(formatBasisPoints(5)).toBe("0.05%");
  });
});

describe("approval rules are configuration", () => {
  it("requires approval for everything, nothing, or at a threshold", () => {
    expect(
      approvalRequired(
        { invoiceApprovalRequired: true, approvalThresholdMinor: null },
        1n,
      ),
    ).toBe(true);
    expect(
      approvalRequired(
        { invoiceApprovalRequired: false, approvalThresholdMinor: null },
        10n ** 12n,
      ),
    ).toBe(false);
    const threshold = {
      invoiceApprovalRequired: true,
      approvalThresholdMinor: 1_000_000n,
    };
    expect(approvalRequired(threshold, 999_999n)).toBe(false);
    expect(approvalRequired(threshold, 1_000_000n)).toBe(true);
  });
});

describe("payment status and dates", () => {
  it("derives the payment status from the paid amount", () => {
    expect(paymentStatus(0n, 100n)).toBe("POSTED");
    expect(paymentStatus(40n, 100n)).toBe("PARTIALLY_PAID");
    expect(paymentStatus(100n, 100n)).toBe("PAID");
  });

  it("adds days and counts days between dates", () => {
    expect(addDays("2026-09-10", 30)).toBe("2026-10-10");
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
    expect(daysBetween("2026-07-15", "2026-09-30")).toBe(77);
  });
});

describe("aging buckets", () => {
  const boundaries = [30, 60, 90, 120];

  it("places days past due into Current, 1–30 … 120+", () => {
    expect(
      [-5, 0, 1, 30, 31, 60, 61, 90, 91, 120, 121, 400].map((days) =>
        agingBucketIndex(days, boundaries),
      ),
    ).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
    expect(agingBucketLabels(boundaries)).toEqual([
      "Current",
      "1–30",
      "31–60",
      "61–90",
      "91–120",
      "120+",
    ]);
  });

  it("validates configured boundaries", () => {
    expect(agingBoundaryProblem(boundaries)).toBeNull();
    expect(agingBoundaryProblem([30, 30])).not.toBeNull();
    expect(agingBoundaryProblem([60, 30])).not.toBeNull();
    expect(agingBoundaryProblem([])).not.toBeNull();
    expect(agingBoundaryProblem([0, 30])).not.toBeNull();
  });
});

describe("document numbers", () => {
  it("formats from the configured series", () => {
    expect(formatDocumentNumber("INV", 2026, 6, 1)).toBe("INV-2026-000001");
    expect(formatDocumentNumber("RCT", null, 4, 12)).toBe("RCT-0012");
  });
});

describe("AR input schemas — server-side validation", () => {
  const revenue = "3f0c9a0e-8a57-4d8f-9e0b-6f4a2f6f9c11";
  const customer = "8b1a2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
  const valid = {
    crmAccountId: customer,
    invoiceDate: "2026-09-10",
    lines: [
      {
        description: "Consulting",
        quantity: "2",
        unitPrice: "40,000",
        discount: "",
        taxRateId: "",
        revenueAccountId: revenue,
      },
    ],
  };

  it("accepts a valid draft and ignores fields the server owns", () => {
    const parsed = arInvoiceDraftSchema.parse({
      ...valid,
      totalMinor: 1,
      status: "PAID",
      invoiceNumber: "HACK",
    });
    expect(parsed).not.toHaveProperty("totalMinor");
    expect(parsed).not.toHaveProperty("status");
    expect(parsed.lines[0]?.quantity).toBe(20_000n);
  });

  it("rejects no lines, a zero quantity, a negative price and a due date before the invoice", () => {
    expect(arInvoiceDraftSchema.safeParse({ ...valid, lines: [] }).success).toBe(false);
    expect(
      arInvoiceDraftSchema.safeParse({
        ...valid,
        lines: [{ ...valid.lines[0], quantity: "0" }],
      }).success,
    ).toBe(false);
    expect(
      arInvoiceDraftSchema.safeParse({
        ...valid,
        lines: [{ ...valid.lines[0], unitPrice: "-5" }],
      }).success,
    ).toBe(false);
    expect(
      arInvoiceDraftSchema.safeParse({ ...valid, dueDate: "2026-09-01" }).success,
    ).toBe(false);
    expect(
      arInvoiceDraftSchema.safeParse({ ...valid, crmAccountId: "acme" }).success,
    ).toBe(false);
  });

  it("rejects duplicate and non-positive allocations", () => {
    const invoiceId = revenue;
    expect(
      arAllocationSchema.safeParse({
        allocations: [
          { invoiceId, amount: "10" },
          { invoiceId, amount: "5" },
        ],
      }).success,
    ).toBe(false);
    expect(
      arAllocationSchema.safeParse({ allocations: [{ invoiceId, amount: "0" }] }).success,
    ).toBe(false);
    expect(
      arAllocationSchema.safeParse({ allocations: [{ invoiceId, amount: "10" }] })
        .success,
    ).toBe(true);
  });

  it("parses settings and tax rates from what a form sends", () => {
    const settings = arSettingsSchema.parse({
      defaultReceivableAccountId: "",
      invoiceApprovalRequired: true,
      approvalThreshold: "50,000",
      allowSelfApproval: false,
      defaultPaymentTermsDays: "30",
      agingBucketDays: "30, 60, 90",
    });
    expect(settings.approvalThreshold).toBe(5_000_000n);
    expect(settings.agingBucketDays).toEqual([30, 60, 90]);
    expect(
      taxRateSchema.parse({
        code: "VAT14",
        name: "VAT",
        rate: "14",
        taxAccountId: revenue,
      }).rate,
    ).toBe(1400);
  });
});

describe("AR permissions and roles", () => {
  it("keys every AR control to its own action", () => {
    const actions = Object.fromEntries(
      ERP_PERMISSION_DEFINITIONS.map((definition) => [definition.key, definition.action]),
    );
    expect(actions[ERP_PERMISSIONS.AR_INVOICE_APPROVE]).toBe("APPROVE");
    expect(actions[ERP_PERMISSIONS.AR_INVOICE_POST]).toBe("POST");
    expect(actions[ERP_PERMISSIONS.AR_INVOICE_CANCEL]).toBe("CANCEL");
    expect(actions[ERP_PERMISSIONS.AR_RECEIPT_ALLOCATE]).toBe("ALLOCATE");
  });

  it("keeps approval, cancellation, credit terms and settings away from accountants", () => {
    for (const control of [
      ERP_PERMISSIONS.AR_INVOICE_APPROVE,
      ERP_PERMISSIONS.AR_INVOICE_CANCEL,
      ERP_PERMISSIONS.AR_RECEIPT_CANCEL,
      ERP_PERMISSIONS.AR_CUSTOMER_UPDATE,
      ERP_PERMISSIONS.AR_SETTINGS_ADMINISTER,
    ]) {
      expect(ERP_ACCOUNTANT_PERMISSIONS).not.toContain(control);
      expect(ERP_FINANCE_ADMIN_PERMISSIONS).toContain(control);
    }
    expect(ERP_ACCOUNTANT_PERMISSIONS).toContain(ERP_PERMISSIONS.AR_RECEIPT_ALLOCATE);
  });
});
