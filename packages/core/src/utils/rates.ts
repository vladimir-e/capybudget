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
 * The received amount, in `toCurrency` cents, that `fromCents` of `fromCurrency`
 * converts to at today's display cross-rate `rate(from→to) = rate(from→default)
 * / rate(to→default)`. The single rounding convention behind both the transfer
 * form's prefill and the MCP handler's inferred `toAmount`, so the two can't
 * drift. This is a default — the real received amount the user enters overrides
 * it; the executed rate then derives from the two amounts (`stampTransferRates`).
 */
export function crossRateAmount(
  fromCents: number,
  fromCurrency: string,
  toCurrency: string,
  currencies: Record<string, CurrencySettings>,
  defaultCurrency: string,
  table: SeedRateTable = SEED_RATES,
): number {
  const crossRate =
    resolveRate(fromCurrency, currencies, defaultCurrency, table).rate /
    resolveRate(toCurrency, currencies, defaultCurrency, table).rate;
  return Math.round(fromCents * crossRate);
}

/** The two per-leg rates a transfer stamps — each leg's native→default rate,
 *  `undefined` when that leg is in the default currency (an implicit 1.0). */
export interface TransferRates {
  fromRate: number | undefined;
  toRate: number | undefined;
}

/**
 * The rates to freeze on a cross-currency transfer's two legs, one per leg, at
 * entry time. The from leg holds `fromCurrency` (the outflow), the to leg holds
 * `toCurrency` (the inflow); `fromAmount` / `toAmount` are the positive native
 * magnitudes moved on each side.
 *
 * Each leg is valued in the default currency the same way a standalone
 * transaction is — its own rate, or empty for a default-currency leg. The one
 * special case is when **exactly one** leg is the default: the two amounts then
 * pin the real rate this transfer executed at, more accurate than the table, so
 * we derive the foreign leg's rate from them rather than resolving it. For
 * `-fromAmount × fromRate + toAmount × toRate` to net to ~0 (no phantom FX), the
 * foreign side must take the counter-amount over its own:
 *   - from=default → `toRate = fromAmount / toAmount`   (value of 1 toUnit in default)
 *   - to=default   → `fromRate = toAmount / fromAmount` (value of 1 fromUnit in default)
 *
 * A same-currency transfer (both default, or both the same foreign) takes the
 * one shared resolver rate on both legs — byte-identical to the single-amount
 * path. When neither leg is the default, the amounts give the X↔Y rate but not
 * either →default rate, so each leg stamps its own resolver rate.
 */
export function stampTransferRates(
  fromCurrency: string,
  toCurrency: string,
  fromAmount: number,
  toAmount: number,
  currencies: Record<string, CurrencySettings>,
  defaultCurrency: string,
  table: SeedRateTable = SEED_RATES,
): TransferRates {
  if (fromCurrency === toCurrency) {
    const shared = stampFxRate(fromCurrency, currencies, defaultCurrency, table);
    return { fromRate: shared, toRate: shared };
  }

  const fromIsDefault = fromCurrency === defaultCurrency;
  const toIsDefault = toCurrency === defaultCurrency;

  if (fromIsDefault && toAmount !== 0) {
    return { fromRate: undefined, toRate: fromAmount / toAmount };
  }
  if (toIsDefault && fromAmount !== 0) {
    return { fromRate: toAmount / fromAmount, toRate: undefined };
  }

  return {
    fromRate: stampFxRate(fromCurrency, currencies, defaultCurrency, table),
    toRate: stampFxRate(toCurrency, currencies, defaultCurrency, table),
  };
}

/**
 * The `todayRates` map `createConverter` consumes: every currency in the
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
