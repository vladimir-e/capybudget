import { describe, expect, it } from "vitest";
import { SEED_RATES, resolveRate, buildTodayRates } from "./rates";
import type { CurrencySettings } from "./money";

const fmt = (rate?: number, rateSource?: "manual" | "seed"): CurrencySettings => ({
  decimals: 2,
  symbolPosition: "before",
  ...(rate !== undefined ? { rate } : {}),
  ...(rateSource !== undefined ? { rateSource } : {}),
});

describe("resolveRate — fallback chain", () => {
  it("uses a manual override when present", () => {
    const currencies = { USD: fmt(), EUR: fmt(1.2, "manual") };
    expect(resolveRate("EUR", currencies, "USD")).toEqual({ rate: 1.2, source: "manual" });
  });

  it("falls through to the seed table when there is no manual override", () => {
    // 1 EUR in USD = usdRates[USD]/usdRates[EUR] = 1/0.92.
    const currencies = { USD: fmt(), EUR: fmt() };
    const resolved = resolveRate("EUR", currencies, "USD");
    expect(resolved.source).toBe("seed");
    expect(resolved.rate).toBeCloseTo(1 / 0.92, 10);
  });

  it("falls through to seed when an entry carries a rate but rateSource is not manual", () => {
    // A stored seed value must not be treated as a manual override.
    const currencies = { USD: fmt(), EUR: fmt(99, "seed") };
    const resolved = resolveRate("EUR", currencies, "USD");
    expect(resolved.source).toBe("seed");
    expect(resolved.rate).toBeCloseTo(1 / 0.92, 10);
  });

  it("returns 1.0 unset for a currency absent from the seed table", () => {
    const currencies = { USD: fmt(), XYZ: fmt() };
    expect(resolveRate("XYZ", currencies, "USD")).toEqual({ rate: 1, source: "unset" });
  });

  it("returns 1.0 for the default currency itself", () => {
    const currencies = { USD: fmt() };
    expect(resolveRate("USD", currencies, "USD").rate).toBe(1);
  });
});

describe("resolveRate — cross-rate division for a non-USD default", () => {
  it("derives rate(RUB→EUR) by division, with the direction right", () => {
    // Default EUR, foreign RUB. 1 RUB in EUR = usdRates[EUR]/usdRates[RUB]
    // = 0.92/91 ≈ 0.0101 EUR per ruble — a small number, as it must be.
    const currencies = { EUR: fmt(), RUB: fmt() };
    const resolved = resolveRate("RUB", currencies, "EUR");
    expect(resolved.source).toBe("seed");
    expect(resolved.rate).toBeCloseTo(0.92 / 91, 10);
    expect(resolved.rate).toBeLessThan(1);
  });

  it("inverts cleanly: rate(EUR→RUB) is the reciprocal of rate(RUB→EUR)", () => {
    const eurToRub = resolveRate("EUR", { RUB: fmt(), EUR: fmt() }, "RUB");
    const rubToEur = resolveRate("RUB", { RUB: fmt(), EUR: fmt() }, "EUR");
    expect(eurToRub.rate).toBeCloseTo(1 / rubToEur.rate, 8);
    expect(eurToRub.rate).toBeGreaterThan(1);
  });

  it("converts cents in the documented direction (defaultCents = round(nativeCents × rate))", () => {
    // 100,000 RUB cents (1000.00 ₽) into EUR cents at 0.92/91 ≈ 1011 cents.
    const { rate } = resolveRate("RUB", { EUR: fmt(), RUB: fmt() }, "EUR");
    expect(Math.round(100_000 * rate)).toBe(Math.round(100_000 * (0.92 / 91)));
  });
});

describe("buildTodayRates", () => {
  it("covers every currency in the map, each resolved against the default", () => {
    const currencies = {
      USD: fmt(),
      EUR: fmt(1.5, "manual"),
      RUB: fmt(),
      XYZ: fmt(),
    };
    const rates = buildTodayRates(currencies, "USD");
    expect([...rates.keys()].sort()).toEqual(["EUR", "RUB", "USD", "XYZ"]);
    expect(rates.get("USD")).toBe(1);
    expect(rates.get("EUR")).toBe(1.5); // manual override wins
    expect(rates.get("RUB")).toBeCloseTo(1 / SEED_RATES.rates.RUB, 10);
    expect(rates.get("XYZ")).toBe(1); // unset floor
  });
});
