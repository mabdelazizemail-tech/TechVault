import { BASIS_POINTS_PER_WHOLE, divideRounded } from "./ar";

/**
 * Pure accounts payable rules (ADR-033). The database re-derives every figure here
 * with the same rounding — half away from zero — so a service bug cannot store a
 * withholding amount the rules would not produce.
 */

/**
 * The part of a payment line that tax is withheld on: the VAT-exclusive share of the
 * amount settled, amount × (bill net ÷ bill total). Withholding applies to the price
 * of the goods or service, not to the VAT on top of it.
 */
export function withholdingBase(
  amountMinor: bigint,
  billNetMinor: bigint,
  billTotalMinor: bigint,
): bigint {
  if (billTotalMinor <= 0n) return 0n;
  return divideRounded(amountMinor * billNetMinor, billTotalMinor);
}

export function withheldAmount(baseMinor: bigint, basisPoints: number): bigint {
  return divideRounded(baseMinor * BigInt(basisPoints), BigInt(BASIS_POINTS_PER_WHOLE));
}

export type PaymentLineAmounts = {
  amountMinor: bigint;
  withholdingBaseMinor: bigint;
  withheldMinor: bigint;
  cashMinor: bigint;
};

/** One payment line: what it settles, what is withheld and what leaves the bank. */
export function calculatePaymentLine(input: {
  amountMinor: bigint;
  billNetMinor: bigint;
  billTotalMinor: bigint;
  withholdingBasisPoints: number | null;
}): PaymentLineAmounts {
  if (input.withholdingBasisPoints === null) {
    return {
      amountMinor: input.amountMinor,
      withholdingBaseMinor: 0n,
      withheldMinor: 0n,
      cashMinor: input.amountMinor,
    };
  }
  const base = withholdingBase(
    input.amountMinor,
    input.billNetMinor,
    input.billTotalMinor,
  );
  const withheld = withheldAmount(base, input.withholdingBasisPoints);
  return {
    amountMinor: input.amountMinor,
    withholdingBaseMinor: base,
    withheldMinor: withheld,
    cashMinor: input.amountMinor - withheld,
  };
}

export function paymentTotals(lines: readonly PaymentLineAmounts[]): {
  amountMinor: bigint;
  withheldMinor: bigint;
  cashMinor: bigint;
} {
  return lines.reduce(
    (sum, line) => ({
      amountMinor: sum.amountMinor + line.amountMinor,
      withheldMinor: sum.withheldMinor + line.withheldMinor,
      cashMinor: sum.cashMinor + line.cashMinor,
    }),
    { amountMinor: 0n, withheldMinor: 0n, cashMinor: 0n },
  );
}
