/**
 * Budget-wide currency, provided by `CurrencyProvider` and read by consumers.
 *
 * Currency is a display concern only — money stays integer cents universally
 * (see specs/DATA_MODEL.md). These hooks hand components a formatter bound to
 * the active currency; switching currency re-renders consumers with no data
 * change underneath. Outside a provider the currency defaults to USD.
 */

import { createContext, useContext, useMemo } from "react";
import {
  DEFAULT_CURRENCY,
  formatMoney,
  formatMoneyCompact,
  currencySymbol,
} from "@capybudget/core";

export { DEFAULT_CURRENCY };

export const CurrencyContext = createContext<string>(DEFAULT_CURRENCY);

/** The active currency code (e.g. "USD"). For input-prefix and symbol cases. */
export function useCurrency(): string {
  return useContext(CurrencyContext);
}

export interface CurrencyFormatters {
  /** Format signed cents as a display string, bound to the active currency. */
  format: (cents: number) => string;
  /** Like `format`, but drops the fractional part for large amounts. */
  formatCompact: (cents: number) => string;
  /** The currency symbol alone (e.g. "$"). */
  symbol: string;
  /** The active currency code (e.g. "USD"). */
  currency: string;
}

/** Currency-aware money formatters, all bound to the budget's active currency. */
export function useFormatMoney(): CurrencyFormatters {
  const currency = useContext(CurrencyContext);
  return useMemo(
    () => ({
      format: (cents: number) => formatMoney(cents, currency),
      formatCompact: (cents: number) => formatMoneyCompact(cents, currency),
      symbol: currencySymbol(currency),
      currency,
    }),
    [currency],
  );
}
