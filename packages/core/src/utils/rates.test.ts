import { describe, expect, it } from "vitest";
import { SEED_RATES, resolveRate, buildTodayRates, stampFxRate, stampTransferRates } from "./rates";
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

describe("stampFxRate — the rate frozen on a foreign transaction at entry", () => {
  it("returns undefined for a default-currency account (leaves fxRate empty = 1.0)", () => {
    expect(stampFxRate("USD", { USD: fmt() }, "USD")).toBeUndefined();
  });

  it("resolves today's rate for a foreign account through the same chain", () => {
    expect(stampFxRate("EUR", { EUR: fmt(1.5, "manual"), USD: fmt() }, "USD")).toBe(1.5);
    expect(stampFxRate("RUB", { RUB: fmt(), USD: fmt() }, "USD")).toBeCloseTo(
      1 / SEED_RATES.rates.RUB,
      10,
    );
  });

  it("falls back to the unset floor (1.0) for a currency absent from the seed table", () => {
    expect(stampFxRate("XYZ", { XYZ: fmt(), USD: fmt() }, "USD")).toBe(1);
  });
});

describe("stampTransferRates — per-leg rates for a transfer", () => {
  const usdEurRub = {
    USD: fmt(),
    EUR: fmt(),
    RUB: fmt(),
  };

  // The money-correctness invariant: at the stamped per-leg rates the two legs
  // net to ~0 in the default currency (any residue is the real FX spread).
  const netDefault = (
    fromAmount: number,
    toAmount: number,
    fromRate: number | undefined,
    toRate: number | undefined,
  ) => -fromAmount * (fromRate ?? 1) + toAmount * (toRate ?? 1);

  describe("same-currency transfer (unchanged: one shared rate)", () => {
    it("both legs undefined for an all-default transfer", () => {
      expect(stampTransferRates("USD", "USD", 10000, 10000, usdEurRub, "USD")).toEqual({
        fromRate: undefined,
        toRate: undefined,
      });
    });

    it("both legs share the one resolver rate for a same-foreign transfer", () => {
      const { fromRate, toRate } = stampTransferRates("RUB", "RUB", 10000, 10000, usdEurRub, "USD");
      expect(fromRate).toBeCloseTo(1 / SEED_RATES.rates.RUB, 10);
      expect(toRate).toBe(fromRate);
    });
  });

  describe("one side is the default — rate derived from the two amounts (the bank rate)", () => {
    it("default→foreign: the foreign (to) leg's rate is fromAmount / toAmount", () => {
      // $100 → €92: rate(EUR→USD) = 100/92 ≈ 1.087, more accurate than the table.
      const { fromRate, toRate } = stampTransferRates("USD", "EUR", 10000, 9200, usdEurRub, "USD");
      expect(fromRate).toBeUndefined();
      expect(toRate).toBeCloseTo(10000 / 9200, 12);
      expect(netDefault(10000, 9200, fromRate, toRate)).toBeCloseTo(0, 6);
    });

    it("foreign→default: the foreign (from) leg's rate is toAmount / fromAmount", () => {
      // €92 → $100: rate(EUR→USD) = 100/92, the to leg is the default (empty).
      const { fromRate, toRate } = stampTransferRates("EUR", "USD", 9200, 10000, usdEurRub, "USD");
      expect(toRate).toBeUndefined();
      expect(fromRate).toBeCloseTo(10000 / 9200, 12);
      expect(netDefault(9200, 10000, fromRate, toRate)).toBeCloseTo(0, 6);
    });

    it("the derived rate is the true executed rate, not the seed table's", () => {
      // The user got a worse rate (€90 for $100) than the seed (≈€92); we stamp
      // the rate they actually got, 100/90, not 1/0.92.
      const { toRate } = stampTransferRates("USD", "EUR", 10000, 9000, usdEurRub, "USD");
      expect(toRate).toBeCloseTo(10000 / 9000, 12);
      expect(toRate).not.toBeCloseTo(1 / SEED_RATES.rates.EUR, 4);
    });
  });

  describe("neither side is the default — each leg stamps its resolver rate", () => {
    it("foreign→foreign uses the table for both legs", () => {
      // Default USD, EUR→RUB. The amounts give EUR↔RUB but not either →USD rate.
      const { fromRate, toRate } = stampTransferRates("EUR", "RUB", 9200, 836000, usdEurRub, "USD");
      expect(fromRate).toBeCloseTo(1 / SEED_RATES.rates.EUR, 10);
      expect(toRate).toBeCloseTo(1 / SEED_RATES.rates.RUB, 10);
    });
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
