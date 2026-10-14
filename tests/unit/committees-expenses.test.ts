import { describe, expect, it } from "vitest";
import { expenseSchema, missionSchema } from "@/modules/committees/contracts/schemas";
import {
  cleanReceiptName,
  formatExpenseAmount,
  parseAmountText,
  receiptContentType,
  receiptMatchesContent,
  totalsByCurrency,
} from "@/modules/committees/domain/expenses";

/** Pure rules behind mission expenses (ADR-037). */

const MISSION = "11111111-1111-4111-8111-111111111111";
const RECEIPT = "22222222-2222-4222-8222-222222222222";

describe("amounts", () => {
  it("converts typed text to minor units exactly", () => {
    expect(parseAmountText("1,250.50")).toEqual({ ok: true, minor: 125050 });
    expect(parseAmountText("  75 ")).toEqual({ ok: true, minor: 7500 });
    expect(parseAmountText("0.5")).toEqual({ ok: true, minor: 50 });
    expect(parseAmountText("19.99")).toEqual({ ok: true, minor: 1999 });
  });

  it("reads Arabic-Indic digits and the Arabic decimal separator", () => {
    const arabic = String.fromCharCode(0x0661, 0x0662, 0x0663, 0x066b, 0x0664, 0x0665);
    expect(parseAmountText(arabic)).toEqual({ ok: true, minor: 12345 });
  });

  it("refuses zero, negatives, three decimals, words and absurd amounts", () => {
    for (const text of ["0", "0.00", "-5", "1.234", "ten", "", "100000000"]) {
      expect(parseAmountText(text).ok, text).toBe(false);
    }
    expect(parseAmountText("10000000.00")).toEqual({ ok: true, minor: 1000000000 });
  });

  it("formats with the currency, two decimals and thousands separators", () => {
    expect(formatExpenseAmount(125050, "TRY")).toBe("TRY 1,250.50");
    expect(formatExpenseAmount(5, "EUR")).toBe("EUR 0.05");
  });
});

describe("totals", () => {
  it("adds up per currency, never across, and leaves rejected claims out", () => {
    expect(
      totalsByCurrency([
        { currency: "TRY", status: "SUBMITTED", amountMinor: 3000, count: 1 },
        { currency: "TRY", status: "APPROVED", amountMinor: 10000, count: 2 },
        { currency: "TRY", status: "REJECTED", amountMinor: 999, count: 1 },
        { currency: "EUR", status: "APPROVED", amountMinor: 2000, count: 1 },
      ]),
    ).toEqual([
      { currency: "EUR", claimedMinor: 2000, approvedMinor: 2000, count: 1 },
      { currency: "TRY", claimedMinor: 13000, approvedMinor: 10000, count: 3 },
    ]);
    expect(totalsByCurrency([])).toEqual([]);
  });
});

describe("receipt pictures", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

  it("accepts JPG, JPEG and PNG by name only", () => {
    expect(receiptContentType("dinner.JPG")).toBe("image/jpeg");
    expect(receiptContentType("taxi.jpeg")).toBe("image/jpeg");
    expect(receiptContentType("visa.png")).toBe("image/png");
    expect(receiptContentType("invoice.pdf")).toBeNull();
    expect(receiptContentType("photo.heic")).toBeNull();
  });

  it("believes the bytes, not the name", () => {
    expect(receiptMatchesContent("dinner.jpg", jpeg)).toBe(true);
    expect(receiptMatchesContent("visa.png", png)).toBe(true);
    expect(receiptMatchesContent("dinner.jpg", png)).toBe(false);
    expect(receiptMatchesContent("dinner.jpg", pdf)).toBe(false);
  });

  it("keeps only the base name, without paths or control characters", () => {
    expect(cleanReceiptName("../../etc/passwd.jpg")).toBe("passwd.jpg");
    expect(cleanReceiptName("C:\\Users\\me\\taxi.png")).toBe("taxi.png");
    expect(cleanReceiptName(`bad${String.fromCharCode(0)}name.jpg`)).toBe("badname.jpg");
  });
});

describe("the expense form's schema", () => {
  const base = {
    missionId: MISSION,
    category: "DINNER",
    expenseDate: "2026-10-12",
    amount: "450.00",
    currency: "TRY",
    receiptId: RECEIPT,
  };

  it("turns the typed amount into minor units", () => {
    expect(expenseSchema.parse(base)).toMatchObject({ amount: 45000, description: null });
  });

  it("requires a description for Other, and only for Other", () => {
    expect(expenseSchema.safeParse({ ...base, category: "OTHER" }).success).toBe(false);
    expect(
      expenseSchema.safeParse({ ...base, category: "OTHER", description: "Sim card" })
        .success,
    ).toBe(true);
    expect(expenseSchema.safeParse({ ...base, description: "  " }).success).toBe(true);
  });

  it("makes the receipt optional, and a supported currency and a real date required", () => {
    for (const receiptId of ["", null, undefined]) {
      expect(expenseSchema.parse({ ...base, receiptId }).receiptId).toBeNull();
    }
    expect(expenseSchema.safeParse({ ...base, receiptId: "not-an-id" }).success).toBe(
      false,
    );
    expect(expenseSchema.safeParse({ ...base, currency: "JPY" }).success).toBe(false);
    expect(expenseSchema.safeParse({ ...base, expenseDate: "2026-02-30" }).success).toBe(
      false,
    );
    expect(expenseSchema.safeParse({ ...base, amount: "0" }).success).toBe(false);
  });

  it("names missions and gives each a supported default currency", () => {
    expect(
      missionSchema.parse({ name: " Turkey Trip ", defaultCurrency: "TRY" }),
    ).toEqual({
      name: "Turkey Trip",
      description: null,
      defaultCurrency: "TRY",
      isActive: true,
    });
    expect(missionSchema.safeParse({ name: "", defaultCurrency: "TRY" }).success).toBe(
      false,
    );
  });
});
