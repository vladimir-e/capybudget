/**
 * Budget-wide currency and money-format config, provided by `CurrencyProvider`
 * and read by consumers.
 *
 * Currency and formatting are display concerns only — money stays integer
 * cents universally (see specs/DATA_MODEL.md). These hooks hand components a
 * formatter bound to the active currency + format; changing either re-renders
 * consumers with no data change underneath. Outside a provider it defaults to
 * USD with its standard formatting.
 */

import { createContext, useContext, useMemo } from "react";
import {
  DEFAULT_CURRENCY,
  formatDefaultsFor,
  formatMoney,
  formatMoneyCompact,
  currencySymbol,
  type MoneyFormat,
  type SymbolPosition,
} from "@capybudget/core";

export { DEFAULT_CURRENCY };

/** The active currency plus its display-format config, threaded together so a
 *  format change propagates everywhere currency already does. */
export interface CurrencyConfig extends MoneyFormat {
  currency: string;
}

const DEFAULT_CONFIG: CurrencyConfig = {
  currency: DEFAULT_CURRENCY,
  ...formatDefaultsFor(DEFAULT_CURRENCY),
};

export const CurrencyContext = createContext<CurrencyConfig>(DEFAULT_CONFIG);

/** The active currency code (e.g. "USD"). For input-prefix and symbol cases. */
export function useCurrency(): string {
  return useContext(CurrencyContext).currency;
}

export interface CurrencyFormatters {
  /** Format signed cents as a display string, bound to the active currency. */
  format: (cents: number) => string;
  /** Like `format`, but drops the fractional part for large amounts. */
  formatCompact: (cents: number) => string;
  /** The currency symbol alone (e.g. "$"). */
  symbol: string;
  /** Where the symbol sits relative to the amount, so callers placing it
   *  themselves (edit affordances, sign detection) match the formatter. */
  symbolPosition: SymbolPosition;
  /** The active currency code (e.g. "USD"). */
  currency: string;
}

/** Currency-aware money formatters, bound to the budget's active currency and
 *  its chosen symbol position + precision. */
export function useFormatMoney(): CurrencyFormatters {
  const { currency, decimals, symbolPosition } = useContext(CurrencyContext);
  return useMemo(() => {
    const format: MoneyFormat = { decimals, symbolPosition };
    return {
      format: (cents: number) => formatMoney(cents, currency, format),
      formatCompact: (cents: number) => formatMoneyCompact(cents, currency, format),
      symbol: currencySymbol(currency),
      symbolPosition,
      currency,
    };
  }, [currency, decimals, symbolPosition]);
}
