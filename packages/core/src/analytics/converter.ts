/** Native → default-currency conversion for analytics roll-ups. */
export interface CurrencyConverter {
  /** Value a transaction's native amount in the default currency using its
   *  stamped rate (the rate on the day it happened). Absent rate → 1.0. */
  flowToDefault(nativeCents: number, stampedRate?: number): number;
  /** Value a native balance in the default currency using today's rate for
   *  that currency. Absent/default/unknown currency → 1.0. */
  holdingToDefault(nativeCents: number, currency?: string): number;
}

// The rate===1 short-circuit returns the exact input rather than
// Math.round(n * 1), so a single-currency budget never makes a float round-trip
// and stays byte-identical.
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
