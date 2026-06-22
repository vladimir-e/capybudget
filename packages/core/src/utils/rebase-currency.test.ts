import { describe, expect, it } from "vitest";
import { rebaseDefaultCurrency } from "./rebase-currency";
import { resolveRate, buildTodayRates, SEED_RATES } from "./rates";
import { createConverter } from "../analytics/converter";
import { getNetWorthOverTime } from "../analytics/analytics";
import { makeAccount, makeTransaction } from "../test-factories";
import type { BudgetMeta } from "../entities/types";
import type { CurrencySettings } from "./money";

const fmt = (rate?: number, rateSource?: "manual" | "seed"): CurrencySettings => ({
  decimals: 2,
  symbolPosition: "before",
  ...(rate !== undefined ? { rate } : {}),
  ...(rateSource !== undefined ? { rateSource } : {}),
});

function metaWith(
  defaultCurrency: string,
  currencies: Record<string, CurrencySettings>,
): BudgetMeta {
  return {
    schemaVersion: 4,
    name: "Budget",
    defaultCurrency,
    currencies,
    createdAt: "2026-01-01T00:00:00.000Z",
    lastModified: "2026-01-01T00:00:00.000Z",
  };
}

describe("rebaseDefaultCurrency — case A (single-currency relabel)", () => {
  it("re-labels every account and resets the map, leaving amounts untouched", () => {
    const meta = metaWith("RUB", { RUB: fmt() });
    const accounts = [
      makeAccount({ id: "a", currency: "RUB" }),
      makeAccount({ id: "b", currency: "RUB" }),
    ];
    const transactions = [
      makeTransaction({ id: "t1", accountId: "a", amount: 100_000 }),
      makeTransaction({ id: "t2", accountId: "b", amount: -25_000 }),
    ];

    const result = rebaseDefaultCurrency(meta, accounts, transactions, "USD");

    expect(result.meta.defaultCurrency).toBe("USD");
    expect(Object.keys(result.meta.currencies)).toEqual(["USD"]);
    expect(result.accounts.every((a) => a.currency === "USD")).toBe(true);
    // Native amounts unchanged — a relabel, not a conversion.
    expect(result.transactions.map((t) => t.amount)).toEqual([100_000, -25_000]);
    expect(result.transactions.every((t) => t.fxRate === undefined)).toBe(true);
  });

  it("introduces no fxRate stamps and adopts the new currency's display defaults", () => {
    const meta = metaWith("USD", { USD: fmt() });
    const accounts = [makeAccount({ currency: "USD" })];
    const result = rebaseDefaultCurrency(meta, accounts, [], "RUB");

    // RUB defaults: zero decimals, symbol after.
    expect(result.meta.currencies.RUB).toEqual({ decimals: 0, symbolPosition: "after" });
  });

  it("is a no-op when the target equals the current default", () => {
    const meta = metaWith("USD", { USD: fmt() });
    const accounts = [makeAccount({ currency: "USD" })];
    const txns = [makeTransaction({})];
    const result = rebaseDefaultCurrency(meta, accounts, txns, "USD");
    expect(result.meta).toBe(meta);
    expect(result.accounts).toBe(accounts);
    expect(result.transactions).toBe(txns);
  });

  it("returns the transactions array untouched by reference (the relabel touches no flow)", () => {
    // The hook persists only files whose reference changed; a relabel must leave
    // transactions identical so transactions.csv isn't needlessly rewritten.
    const meta = metaWith("RUB", { RUB: fmt() });
    const accounts = [makeAccount({ currency: "RUB" })];
    const txns = [makeTransaction({ accountId: accounts[0].id })];
    const result = rebaseDefaultCurrency(meta, accounts, txns, "USD");
    expect(result.transactions).toBe(txns);
    expect(result.accounts).not.toBe(accounts); // accounts are re-labeled
  });
});

describe("rebaseDefaultCurrency — case B (multi-currency value-preserving rebase)", () => {
  // Default RUB; a USD account (foreign) and an IDR account (foreign) alongside
  // RUB accounts. Switch the default RUB → USD.
  function multiCurrencyFixture() {
    const meta = metaWith("RUB", { RUB: fmt(), USD: fmt(), IDR: fmt() });
    const accounts = [
      makeAccount({ id: "rub", currency: "RUB" }),
      makeAccount({ id: "usd", currency: "USD" }),
      makeAccount({ id: "idr", currency: "IDR" }),
    ];
    // Stamp each foreign transaction as the app would: native→default(RUB) rate.
    const usdToRub = resolveRate("USD", meta.currencies, "RUB").rate;
    const idrToRub = resolveRate("IDR", meta.currencies, "RUB").rate;
    const transactions = [
      // RUB account: default-currency flows, no stamp.
      makeTransaction({ id: "r1", accountId: "rub", amount: 500_000 }),
      makeTransaction({ id: "r2", accountId: "rub", amount: -120_000 }),
      // USD account: stamped at today's USD→RUB.
      makeTransaction({ id: "u1", accountId: "usd", amount: 100_000, fxRate: usdToRub }),
      // IDR account: stamped at today's IDR→RUB.
      makeTransaction({ id: "i1", accountId: "idr", amount: 1_000_000, fxRate: idrToRub }),
    ];
    return { meta, accounts, transactions };
  }

  it("scales a NON-home transaction's default value by k (the oracle)", () => {
    const { meta, accounts, transactions } = multiCurrencyFixture();
    const k = 1 / resolveRate("USD", meta.currencies, "RUB").rate;

    const result = rebaseDefaultCurrency(meta, accounts, transactions, "USD");

    expect(result.meta.defaultCurrency).toBe("USD");
    // RUB and IDR flows are foreign to the new USD default — their default value
    // scales by k: round(amount × newStamp) ≈ round(amount × oldStamp) × k.
    for (const id of ["r1", "r2", "i1"]) {
      const before = transactions.find((t) => t.id === id)!;
      const after = result.transactions.find((t) => t.id === id)!;
      expect(after.amount).toBe(before.amount); // native amount never moves
      const valueInOld = Math.round(before.amount * (before.fxRate ?? 1));
      const valueInNew = Math.round(after.amount * (after.fxRate ?? 1));
      expect(valueInNew).toBeCloseTo(valueInOld * k, 0);
      expect(Math.abs(valueInNew - valueInOld * k)).toBeLessThanOrEqual(1);
    }
  });

  it("snaps a HOME transaction to its native face amount, with fxRate cleared", () => {
    const { meta, accounts, transactions } = multiCurrencyFixture();
    const result = rebaseDefaultCurrency(meta, accounts, transactions, "USD");

    // The USD account's flows are now home-currency: face value, no stamp.
    for (const id of ["u1"]) {
      const before = transactions.find((t) => t.id === id)!;
      const after = result.transactions.find((t) => t.id === id)!;
      expect(after.amount).toBe(before.amount);
      expect(after.fxRate).toBeUndefined();
      // Default value === native face amount (no FX against itself).
      expect(Math.round(after.amount * (after.fxRate ?? 1))).toBe(before.amount);
    }
  });

  it("clears a home-currency stamp even when it was stamped at a HISTORICAL rate", () => {
    // The crux: a USD deposit recorded months ago at 80 ₽/$ (not today's 91).
    // Under the new default USD it must read its $1000 face value, NOT old × k
    // (which the prior epsilon-clearing impl left at a scaled, wrong value).
    const meta = metaWith("RUB", { RUB: fmt(), USD: fmt() });
    const accounts = [
      makeAccount({ id: "rub", currency: "RUB" }),
      makeAccount({ id: "usd", currency: "USD" }),
    ];
    const historicalRate = 80; // ₽ per $ on the day it happened — not today's seed.
    const transactions = [
      makeTransaction({ id: "u-hist", accountId: "usd", amount: 100_000, fxRate: historicalRate }),
    ];

    const result = rebaseDefaultCurrency(meta, accounts, transactions, "USD");
    const k = 1 / resolveRate("USD", meta.currencies, "RUB").rate;

    const after = result.transactions.find((t) => t.id === "u-hist")!;
    expect(after.fxRate).toBeUndefined();
    // Face: $1000.00 (100_000 cents), not the scaled old × k it would have been.
    expect(Math.round(after.amount * (after.fxRate ?? 1))).toBe(100_000);
    expect(Math.round(after.amount * (after.fxRate ?? 1))).not.toBe(
      Math.round(100_000 * historicalRate * k),
    );
  });

  it("keeps native currencies on every account (the rebase touches no account)", () => {
    const { meta, accounts, transactions } = multiCurrencyFixture();
    const result = rebaseDefaultCurrency(meta, accounts, transactions, "USD");
    // Accounts are returned untouched by reference — only stamps and the map move.
    expect(result.accounts).toBe(accounts);
    expect(result.accounts.map((a) => a.currency)).toEqual(["RUB", "USD", "IDR"]);
  });

  it("re-stamps the formerly-default RUB flows at k (they are now foreign)", () => {
    const { meta, accounts, transactions } = multiCurrencyFixture();
    const k = 1 / resolveRate("USD", meta.currencies, "RUB").rate;
    const result = rebaseDefaultCurrency(meta, accounts, transactions, "USD");

    const rubTxn = result.transactions.find((t) => t.id === "r1");
    // Was a default (no stamp = 1.0); becomes k = RUB→USD.
    expect(rubTxn?.fxRate).toBeCloseTo(k, 12);
  });

  it("re-expresses the rate map against NEW: NEW is the rate-free default, OLD carries k", () => {
    const { meta, accounts, transactions } = multiCurrencyFixture();
    const result = rebaseDefaultCurrency(meta, accounts, transactions, "USD");

    // NEW (USD) is the default entry — display knobs only, no rate.
    expect(result.meta.currencies.USD.rate).toBeUndefined();
    expect(result.meta.currencies.USD.rateSource).toBeUndefined();

    // OLD (RUB) and the surviving foreign (IDR) resolve correctly against USD.
    // The seed-derived RUB→USD and IDR→USD should match resolveRate on the new map.
    const rubToUsd = resolveRate("RUB", result.meta.currencies, "USD").rate;
    const idrToUsd = resolveRate("IDR", result.meta.currencies, "USD").rate;
    expect(rubToUsd).toBeCloseTo(1 / SEED_RATES.rates.RUB, 12);
    expect(idrToUsd).toBeCloseTo(1 / SEED_RATES.rates.IDR, 12);
  });

  it("holdings keep their value scaled uniformly by k (the holding oracle)", () => {
    const { meta, accounts, transactions } = multiCurrencyFixture();
    const k = 1 / resolveRate("USD", meta.currencies, "RUB").rate;
    const result = rebaseDefaultCurrency(meta, accounts, transactions, "USD");

    const before = createConverter(buildTodayRates(meta.currencies, "RUB"), "RUB");
    const after = createConverter(
      buildTodayRates(result.meta.currencies, "USD"),
      "USD",
    );

    // A holding of 1,000,000 in each foreign currency: value-in-NEW ≈ value-in-OLD × k.
    for (const code of ["RUB", "USD", "IDR"]) {
      const valueOld = before.holdingToDefault(1_000_000, code);
      const valueNew = after.holdingToDefault(1_000_000, code);
      expect(valueNew).toBeCloseTo(valueOld * k, 0);
    }
  });

  it("keeps net-worth-over-time the same shape, uniformly scaled by k", () => {
    // The fixture stamps the USD (home) flows at TODAY's rate, so home-currency
    // face value and old × k coincide for them (face = amount, and old × k =
    // amount × usdToRub × 1/usdToRub = amount). The whole series therefore scales
    // by k uniformly. A historically-stamped home flow breaks that uniformity by
    // design — that's the dedicated crux test above, not this shape check.
    const { meta, accounts, transactions } = multiCurrencyFixture();
    const k = 1 / resolveRate("USD", meta.currencies, "RUB").rate;
    const result = rebaseDefaultCurrency(meta, accounts, transactions, "USD");

    const range = {
      start: new Date("2026-01-01T00:00:00.000Z"),
      end: new Date("2026-03-01T00:00:00.000Z"),
    };
    const beforeConv = createConverter(buildTodayRates(meta.currencies, "RUB"), "RUB");
    const afterConv = createConverter(
      buildTodayRates(result.meta.currencies, "USD"),
      "USD",
    );

    const seriesOld = getNetWorthOverTime(accounts, transactions, range, undefined, beforeConv);
    const seriesNew = getNetWorthOverTime(
      result.accounts,
      result.transactions,
      range,
      undefined,
      afterConv,
    );

    expect(seriesNew.length).toBe(seriesOld.length);
    expect(seriesOld.length).toBeGreaterThan(0);
    for (let i = 0; i < seriesOld.length; i++) {
      expect(seriesNew[i].date).toBe(seriesOld[i].date);
      // Same shape: each point scales by k. The two series round independently
      // (old sums RUB-valued cents, new sums USD-valued cents), so a point can
      // drift a few cents from the exact k-scaling — sub-currency-unit noise, not
      // a shape change. Bound it relative to the point's own magnitude.
      const scaled = seriesOld[i].netWorth * k;
      const tolerance = Math.max(2, Math.abs(scaled) * 1e-4);
      expect(Math.abs(seriesNew[i].netWorth - scaled)).toBeLessThanOrEqual(tolerance);
    }
  });

  it("carries a manual foreign rate across as manual × k, preserving the user's intent", () => {
    // Default RUB, USD foreign with a hand-set rate of 100 RUB per USD.
    const meta = metaWith("RUB", {
      RUB: fmt(),
      USD: fmt(100, "manual"),
    });
    const accounts = [
      makeAccount({ id: "rub", currency: "RUB" }),
      makeAccount({ id: "usd", currency: "USD" }),
      makeAccount({ id: "eur", currency: "EUR" }),
    ];
    // EUR foreign with a manual rate too (95 RUB per EUR), to verify carry-across.
    meta.currencies.EUR = fmt(95, "manual");

    // Switch RUB → USD. k = 1 / rate(USD→RUB) = 1/100.
    const result = rebaseDefaultCurrency(meta, accounts, [], "USD");
    const k = 1 / 100;

    // EUR's manual rate becomes 95 × k = 0.95 USD per EUR, still manual.
    expect(result.meta.currencies.EUR.rate).toBeCloseTo(95 * k, 12);
    expect(result.meta.currencies.EUR.rateSource).toBe("manual");

    // OLD (RUB) carries k as manual (NEW's rate was manual, so k pins the intent).
    expect(result.meta.currencies.RUB.rate).toBeCloseTo(k, 12);
    expect(result.meta.currencies.RUB.rateSource).toBe("manual");
  });
});
