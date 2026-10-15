import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decimalText,
  getUsdRates,
  resetExchangeRateCache,
} from "@/platform/integrations/exchange-rates";

/** The exchange-rate adapter (ADR-038), with the provider faked at `fetch`. */

const FEED = {
  result: "success",
  time_last_update_unix: 1_791_936_151,
  time_next_update_unix: 1_792_022_621,
  base_code: "USD",
  rates: { USD: 1, EGP: 53.095404, TRY: 49.45021, EUR: 0.894425, XAU: 0.00000041 },
};

function respondWith(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe("getUsdRates", () => {
  beforeEach(() => {
    resetExchangeRateCache();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns units per USD as exact decimals, with the publication time", async () => {
    vi.stubGlobal("fetch", respondWith(FEED));
    const rates = await getUsdRates();
    expect(rates?.source).toBe("exchangerate-api");
    expect(rates?.publishedAt).toEqual(new Date(1_791_936_151_000));
    expect(rates?.perUsd.get("TRY")).toBe("49.45021");
    expect(rates?.perUsd.get("EGP")).toBe("53.095404");
    expect(rates?.perUsd.get("USD")).toBe("1");
    expect(rates?.perUsd.get("XAU")).toBe("0.00000041");
  });

  it("reads the feed once an hour, not on every call", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const fetch = respondWith(FEED);
    vi.stubGlobal("fetch", fetch);
    await getUsdRates();
    await getUsdRates();
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 61 * 60 * 1000);
    await getUsdRates();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("returns null when the feed fails, and waits before asking again", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const fetch = vi.fn(async () => {
      throw new Error("network down");
    });
    vi.stubGlobal("fetch", fetch);
    expect(await getUsdRates()).toBeNull();
    expect(await getUsdRates()).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 6 * 60 * 1000);
    await getUsdRates();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("refuses an error status, an unexpected shape, and rates not quoted against USD", async () => {
    vi.stubGlobal("fetch", respondWith(FEED, 503));
    expect(await getUsdRates()).toBeNull();

    resetExchangeRateCache();
    vi.stubGlobal(
      "fetch",
      respondWith({ result: "error", "error-type": "unsupported-code" }),
    );
    expect(await getUsdRates()).toBeNull();

    resetExchangeRateCache();
    vi.stubGlobal("fetch", respondWith({ ...FEED, rates: { ...FEED.rates, USD: 1.1 } }));
    expect(await getUsdRates()).toBeNull();
  });

  it("keeps the last good rates while the feed is down", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.stubGlobal("fetch", respondWith(FEED));
    const good = await getUsdRates();
    vi.setSystemTime(Date.now() + 61 * 60 * 1000);
    vi.stubGlobal("fetch", respondWith(FEED, 500));
    expect(await getUsdRates()).toBe(good);
  });
});

describe("decimalText", () => {
  it("keeps plain decimals and rounds very small ones to ten places", () => {
    expect(decimalText(49.45021)).toBe("49.45021");
    expect(decimalText(1)).toBe("1");
    expect(decimalText(1e-7)).toBe("0.0000001");
  });

  it("refuses zero, negatives, infinities and numbers too large for the column", () => {
    for (const value of [0, -1, Number.POSITIVE_INFINITY, Number.NaN, 1e12, 1e-11]) {
      expect(decimalText(value), String(value)).toBeNull();
    }
  });
});
