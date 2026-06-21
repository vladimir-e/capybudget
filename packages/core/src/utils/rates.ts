import type { CurrencySettings } from "./money";

// A USD-anchored snapshot of mid-market rates: `rates[c]` is units of currency
// `c` per 1 USD. This is the exact shape the checkpoint-3 Lambda will serve
// (`{ base, rates }`), so it slots in later as the offline floor with no
// reshape. These are overridable fallbacks, not live data — reasonable mid-2026
// mid-market values, refreshed by the fetch layer in C3.
export interface SeedRateTable {
  base: string;
  rates: Record<string, number>;
}

export const SEED_RATES: SeedRateTable = {
  base: "USD",
  rates: {
    USD: 1,
    EUR: 0.92,
    GBP: 0.79,
    JPY: 152,
    CNY: 7.2,
    CHF: 0.88,
    CAD: 1.36,
    AUD: 1.52,
    NZD: 1.66,
    HKD: 7.81,
    SGD: 1.34,
    INR: 83.4,
    KRW: 1360,
    TWD: 32.3,
    THB: 35.5,
    MYR: 4.7,
    IDR: 16000,
    PHP: 57.5,
    VND: 25400,
    PKR: 278,
    BDT: 118,
    RUB: 91,
    UAH: 41,
    KZT: 470,
    GEL: 2.7,
    AMD: 388,
    AZN: 1.7,
    UZS: 12700,
    TRY: 34.5,
    PLN: 3.95,
    CZK: 23.2,
    HUF: 360,
    RON: 4.6,
    SEK: 10.6,
    NOK: 10.8,
    DKK: 6.85,
    ILS: 3.7,
    AED: 3.67,
    SAR: 3.75,
    ZAR: 18.2,
    EGP: 49,
    NGN: 1550,
    MXN: 18.5,
    BRL: 5.6,
    ARS: 950,
    CLP: 945,
    COP: 4100,
  },
};

// Where a resolved rate came from. `unset` means neither a manual override nor
// the seed table had the currency, so the resolver fell back to 1.0 — a quiet
// "we don't know this rate" state, not a real conversion.
export type RateProvenance = "manual" | "seed" | "unset";

export interface ResolvedRate {
  /** Value of 1 unit of the resolved currency in `defaultCurrency` units.
   *  Money is integer ×100 for every currency, so the same ratio applies to
   *  cents: `defaultCents = round(nativeCents × rate)`. */
  rate: number;
  source: RateProvenance;
}

// rate(X→D) from the USD-anchored table: units of D per 1 X. Derived by
// division — value 1 X in USD is `1/usdRates[X]`, then into D by ×usdRates[D].
// Returns undefined when either leg is missing from the seed table.
function seedRate(
  currency: string,
  defaultCurrency: string,
  table: SeedRateTable,
): number | undefined {
  const fromUsd = table.rates[currency];
  const toUsd = table.rates[defaultCurrency];
  if (fromUsd === undefined || toUsd === undefined) return undefined;
  return toUsd / fromUsd;
}

/**
 * Today's rate to convert `currency` → `defaultCurrency`, plus its provenance.
 * Walks the fallback chain: a manual override on the currency's entry → the
 * bundled seed table (derived by division for any base) → 1.0 unset. The
 * default currency, and `currency === defaultCurrency`, is always rate 1.0.
 */
export function resolveRate(
  currency: string,
  currencies: Record<string, CurrencySettings>,
  defaultCurrency: string,
  table: SeedRateTable = SEED_RATES,
): ResolvedRate {
  // The default is the base — definitionally 1.0, from neither the table nor an
  // override. No provenance tag truly fits, but a foreign row never renders for
  // the default and `buildTodayRates` reads only `.rate`, so no UI surfaces this
  // tag; "seed" is the inert placeholder, not a claim the table supplied it.
  if (currency === defaultCurrency) return { rate: 1, source: "seed" };

  const entry = currencies[currency];
  if (entry?.rateSource === "manual" && entry.rate !== undefined) {
    return { rate: entry.rate, source: "manual" };
  }

  const seed = seedRate(currency, defaultCurrency, table);
  if (seed !== undefined) return { rate: seed, source: "seed" };

  return { rate: 1, source: "unset" };
}

/**
 * The rate to freeze on a transaction created on an account holding
 * `accountCurrency`, stamped at entry time so the flow never re-rates as rates
 * move. A default-currency account returns `undefined` — its `fxRate` stays
 * empty (an implicit 1.0), keeping single-currency budgets byte-identical.
 * A foreign account stamps today's resolved rate from the same fallback chain
 * as `resolveRate`.
 */
export function stampFxRate(
  accountCurrency: string,
  currencies: Record<string, CurrencySettings>,
  defaultCurrency: string,
  table: SeedRateTable = SEED_RATES,
): number | undefined {
  if (accountCurrency === defaultCurrency) return undefined;
  return resolveRate(accountCurrency, currencies, defaultCurrency, table).rate;
}

/**
 * The `todayRates` map U4 feeds into `createConverter`: every currency in the
 * budget's map keyed to its resolved rate against the default. Each rate walks
 * the same fallback chain as `resolveRate`. The default currency resolves to
 * 1.0 like any other; the converter treats it as identity regardless.
 */
export function buildTodayRates(
  currencies: Record<string, CurrencySettings>,
  defaultCurrency: string,
  table: SeedRateTable = SEED_RATES,
): Map<string, number> {
  const rates = new Map<string, number>();
  for (const code of Object.keys(currencies)) {
    rates.set(code, resolveRate(code, currencies, defaultCurrency, table).rate);
  }
  return rates;
}
