import { z } from "zod";
import { logger } from "@/platform/observability/logger";

/**
 * Exchange rates against the US dollar, from ExchangeRate-API's open-access feed
 * (ADR-038; docs/architecture/integrations/exchange-rates.md). No account or key;
 * the provider publishes new rates once a day and asks for attribution wherever
 * the rates are shown.
 *
 * This adapter is the only code that knows the provider. Callers get "units of a
 * currency per 1 USD" as exact decimal strings, or null when the feed cannot be
 * reached or says something unexpected. It never throws: a missing rate must not
 * stop anyone from submitting an expense.
 */

export const EXCHANGE_RATE_SOURCE = "exchangerate-api";

/** The provider's terms ask for this credit beside any rate it supplied. */
export const EXCHANGE_RATE_ATTRIBUTION = {
  label: "Rates by Exchange Rate API",
  href: "https://www.exchangerate-api.com",
} as const;

const ENDPOINT = "https://open.er-api.com/v6/latest/USD";
/** A submission waits at most this long for a rate; after that it is converted later. */
const TIMEOUT_MS = 3000;
/** Rates change daily; re-reading hourly picks up a new day's rates promptly. */
const MAX_AGE_MS = 60 * 60 * 1000;
/** After a failure, pages do not wait on the feed again for this long. */
const RETRY_AFTER_MS = 5 * 60 * 1000;
/** Fits the database column, numeric(20,10). */
const DECIMAL = /^\d{1,10}(\.\d{1,10})?$/;

const responseSchema = z.object({
  result: z.literal("success"),
  time_last_update_unix: z.number().int().positive(),
  rates: z.record(z.string(), z.number()),
});

export type UsdRates = {
  /** Units of each currency per 1 USD, as exact decimal strings ("49.45021"). */
  perUsd: ReadonlyMap<string, string>;
  /** When the provider published these rates. */
  publishedAt: Date;
  source: typeof EXCHANGE_RATE_SOURCE;
};

let cached: { rates: UsdRates; fetchedAt: number } | null = null;
let failedAt: number | null = null;

/** Today's rates, from the per-process cache when fresh. Null when unavailable. */
export async function getUsdRates(): Promise<UsdRates | null> {
  const now = Date.now();
  if (cached !== null && now - cached.fetchedAt < MAX_AGE_MS) return cached.rates;
  if (failedAt !== null && now - failedAt < RETRY_AFTER_MS) return cached?.rates ?? null;

  try {
    const response = await fetch(ENDPOINT, {
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const parsed = responseSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error("Unexpected response from the rate feed");

    const perUsd = new Map<string, string>();
    for (const [code, value] of Object.entries(parsed.data.rates)) {
      const text = decimalText(value);
      if (/^[A-Z]{3}$/.test(code) && text !== null) perUsd.set(code, text);
    }
    if (perUsd.get("USD") !== "1")
      throw new Error("The rate feed is not quoted against USD");

    const rates: UsdRates = {
      perUsd,
      publishedAt: new Date(parsed.data.time_last_update_unix * 1000),
      source: EXCHANGE_RATE_SOURCE,
    };
    cached = { rates, fetchedAt: now };
    failedAt = null;
    return rates;
  } catch (error) {
    failedAt = now;
    logger.warn("Could not load exchange rates", {
      module: "platform",
      operation: "integrations.exchangeRates",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    // A slightly old rate beats none while the feed is down.
    return cached?.rates ?? null;
  }
}

/**
 * A rate from the feed as a plain decimal with at most ten places, or null for
 * anything that is not a positive number the database column can hold.
 */
export function decimalText(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const text = String(value);
  if (DECIMAL.test(text)) return text;
  // Very small or very precise values: keep ten places, as the column does.
  const fixed = value.toFixed(10).replace(/\.?0+$/, "");
  return DECIMAL.test(fixed) && Number(fixed) > 0 ? fixed : null;
}

/** Tests only: forget cached rates and failures. */
export function resetExchangeRateCache(): void {
  cached = null;
  failedAt = null;
}
