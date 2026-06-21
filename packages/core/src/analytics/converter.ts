/**
 * Native → default-currency conversion for analytics roll-ups.
 *
 * Two valuation modes, deliberately distinct because they read different rates:
 *
 *  - **Flows** — what something cost or earned (spending, income, cash flow,
 *    merchants, trends, net-worth-over-time). Valued at the rate stamped on the
 *    transaction the day it happened (`fxRate`), so history never re-rates.
 *  - **Holdings** — what an account is worth *right now* (current balance,
 *    current net worth). Valued at today's rate for the account's currency.
 *
 * The two intentionally don't reconcile: the gap is unrealized FX gain/loss.
 *
 * Conversion is read-time only — native amounts are never rewritten. Money is
 * integer cents (×100 for every currency, zero-decimal ones included), so a
 * conversion is just `Math.round(native × rate)` with no minor-unit bookkeeping.
 * Sum native first, convert once (net worth converts a whole account balance,
 * not each transaction).
 *
 * With no foreign accounts every rate is absent and every conversion is the
 * identity — see `IDENTITY_CONVERTER`. That is what keeps a single-currency
 * budget byte-identical.
 */

export interface CurrencyConverter {
  /** Value a transaction's native amount in the default currency using its
   *  stamped rate (the rate on the day it happened). Absent rate → 1.0. */
  flowToDefault(nativeCents: number, stampedRate?: number): number;
  /** Value a native balance in the default currency using today's rate for
   *  that currency. Absent/default/unknown currency → 1.0. */
  holdingToDefault(nativeCents: number, currency?: string): number;
}

function convert(nativeCents: number, rate: number): number {
  return rate === 1 ? nativeCents : Math.round(nativeCents * rate);
}

/** No foreign accounts, no rates: every conversion returns its input. */
export const IDENTITY_CONVERTER: CurrencyConverter = {
  flowToDefault: (nativeCents) => nativeCents,
  holdingToDefault: (nativeCents) => nativeCents,
};

/**
 * A converter backed by a currency→today's-rate map (the rate of each
 * currency against `defaultCurrency`). The default currency, and any currency
 * absent from the map, resolves to 1.0. An undefined stamped rate is treated
 * as 1.0 (a default-currency transaction never carries one).
 */
export function createConverter(
  todayRates: ReadonlyMap<string, number>,
  defaultCurrency: string,
): CurrencyConverter {
  return {
    flowToDefault: (nativeCents, stampedRate) =>
      convert(nativeCents, stampedRate ?? 1),
    holdingToDefault: (nativeCents, currency) => {
      if (currency === undefined || currency === defaultCurrency) {
        return nativeCents;
      }
      return convert(nativeCents, todayRates.get(currency) ?? 1);
    },
  };
}
