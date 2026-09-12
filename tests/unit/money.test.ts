import { describe, expect, it } from "vitest";
import {
  allocate,
  applyRate,
  formatMoney,
  MoneyError,
  sumMinor,
  toMajorUnits,
  toMinorUnits,
} from "@/lib/money";

/**
 * Money is the other place where a subtle bug is a serious defect (ADR-006).
 * These tests exist to keep integer-minor-unit discipline honest.
 */

describe("toMinorUnits", () => {
  it("converts a major amount to integer minor units", () => {
    expect(toMinorUnits(1234.56)).toBe(123456);
  });

  it("rounds once, at the boundary", () => {
    expect(toMinorUnits(0.005)).toBe(1);
    expect(toMinorUnits(0.004)).toBe(0);
  });

  it("handles the classic floating point case", () => {
    // 0.1 + 0.2 = 0.30000000000000004 as floats; in minor units it is exact.
    expect(sumMinor([toMinorUnits(0.1), toMinorUnits(0.2)])).toBe(toMinorUnits(0.3));
  });

  it("rejects a non-finite amount", () => {
    expect(() => toMinorUnits(Number.NaN)).toThrow(MoneyError);
    expect(() => toMinorUnits(Number.POSITIVE_INFINITY)).toThrow(MoneyError);
  });
});

describe("sumMinor", () => {
  it("sums exactly", () => {
    expect(sumMinor([1, 2, 3, 999])).toBe(1005);
  });

  it("returns zero for an empty list", () => {
    expect(sumMinor([])).toBe(0);
  });

  it("rejects a fractional operand, which means a float leaked in", () => {
    expect(() => sumMinor([100, 0.5])).toThrow(MoneyError);
  });
});

describe("applyRate", () => {
  it("applies a percentage", () => {
    expect(applyRate(10_000, 0.14)).toBe(1400);
  });

  it("rounds half away from zero, symmetrically for credits and debits", () => {
    // A reversal must cancel the original exactly; banker's rounding would not.
    expect(applyRate(5, 0.5)).toBe(3);
    expect(applyRate(-5, 0.5)).toBe(-3);
  });

  it("rejects a non-integer base amount", () => {
    expect(() => applyRate(10.5, 0.1)).toThrow(MoneyError);
  });
});

describe("allocate", () => {
  it("splits evenly when it divides exactly", () => {
    expect(allocate(900, 3)).toEqual([300, 300, 300]);
  });

  it("distributes the remainder without creating or losing money", () => {
    const parts = allocate(1000, 3);
    expect(parts).toEqual([334, 333, 333]);
    expect(sumMinor(parts)).toBe(1000);
  });

  it("preserves the total for awkward splits", () => {
    for (const [amount, count] of [
      [1, 3],
      [7, 2],
      [100, 7],
      [12_345, 11],
    ] as const) {
      expect(sumMinor(allocate(amount, count))).toBe(amount);
    }
  });

  it("handles negative amounts symmetrically", () => {
    const parts = allocate(-1000, 3);
    expect(sumMinor(parts)).toBe(-1000);
    expect(parts).toEqual([-334, -333, -333]);
  });

  it("rejects a non-positive part count", () => {
    expect(() => allocate(100, 0)).toThrow(MoneyError);
    expect(() => allocate(100, -1)).toThrow(MoneyError);
  });
});

describe("toMajorUnits / formatMoney", () => {
  it("converts back for display", () => {
    expect(toMajorUnits(123456)).toBe(1234.56);
  });

  it("rejects a fractional minor amount", () => {
    expect(() => toMajorUnits(10.5)).toThrow(MoneyError);
  });

  it("formats with two decimals and the currency", () => {
    const formatted = formatMoney(123456, "EGP", "en-EG");
    expect(formatted).toMatch(/1,234\.56/);
  });
});
