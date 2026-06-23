import { createContext, useContext, useMemo } from "react";
import {
  DEFAULT_CURRENCY,
  formatDefaultsFor,
  formatMoney,
  formatMoneyCompact,
  currencySymbol,
  createConverter,
  buildTodayRates,
  SEED_RATES,
  type CurrencyConverter,
  type CurrencySettings,
  type MoneyFormat,
  type SymbolPosition,
} from "@capybudget/core";
import { useFormatLocale } from "@capybudget/i18n";

export { DEFAULT_CURRENCY };

export interface CurrencyConfig extends MoneyFormat {
  /** The budget's default currency — what every roll-up rolls up into. */
  currency: string;
  /** The full per-currency settings map, so the converter can resolve each
   *  foreign currency's rate against the default. Absent → a single-currency
   *  budget; the converter is the identity. */
  currencies?: Record<string, CurrencySettings>;
}

const DEFAULT_CONFIG: CurrencyConfig = {
  currency: DEFAULT_CURRENCY,
  currencies: { [DEFAULT_CURRENCY]: formatDefaultsFor(DEFAULT_CURRENCY) },
  ...formatDefaultsFor(DEFAULT_CURRENCY),
};

export const CurrencyContext = createContext<CurrencyConfig>(DEFAULT_CONFIG);

export function useCurrency(): string {
  return useContext(CurrencyContext).currency;
}

/** The full per-currency settings map for the active budget. The absent-map
 *  fallback is memoized on `currency` so it returns a stable reference across
 *  renders — otherwise a fresh object each render would bust the `useConverter`
 *  memo for single-currency budgets. */
export function useCurrencies(): Record<string, CurrencySettings> {
  const { currency, currencies } = useContext(CurrencyContext);
  const fallback = useMemo(
    () => ({ [currency]: formatDefaultsFor(currency) }),
    [currency],
  );
  return currencies ?? fallback;
}

/**
 * The analytics converter for the active budget — flows value at each
 * transaction's stamped rate, holdings at today's resolved rate. A
 * single-currency budget yields all-1.0 rates, so this is the identity
 * function and nothing moves. Pass it into every core analytics roll-up.
 */
export function useConverter(): CurrencyConverter {
  const { currency } = useContext(CurrencyContext);
  const currencies = useCurrencies();
  return useMemo(
    () => createConverter(buildTodayRates(currencies, currency, SEED_RATES), currency),
    [currencies, currency],
  );
}

export interface CurrencyFormatters {
  format: (cents: number) => string;
  formatCompact: (cents: number) => string;
  symbol: string;
  symbolPosition: SymbolPosition;
  currency: string;
}

export function useFormatMoney(): CurrencyFormatters {
  const { currency, decimals, symbolPosition } = useContext(CurrencyContext);
  // Format locale drives grouping/decimal glyphs ("1 250,00 ₽" under ru, region
  // variants under en); currency and symbol are independent of it.
  const locale = useFormatLocale();
  return useMemo(() => {
    const format: MoneyFormat = { decimals, symbolPosition };
    return {
      format: (cents: number) => formatMoney(cents, currency, format, locale),
      formatCompact: (cents: number) => formatMoneyCompact(cents, currency, format, locale),
      symbol: currencySymbol(currency),
      symbolPosition,
      currency,
    };
  }, [currency, decimals, symbolPosition, locale]);
}

/**
 * Format a native amount in a given account's own currency — used wherever a
 * per-row figure is shown in the currency it's actually stored in, rather than
 * the budget default. An account in the default currency (or `undefined`) routes
 * to the configured default formatter, so a single-currency budget renders
 * identically; a foreign account uses that currency's display defaults.
 */
export function useAccountMoney(): (cents: number, currency?: string) => string {
  const { currency: defaultCurrency, decimals, symbolPosition } = useContext(CurrencyContext);
  const locale = useFormatLocale();
  return useMemo(() => {
    const defaultFormat: MoneyFormat = { decimals, symbolPosition };
    return (cents: number, currency?: string) => {
      if (currency === undefined || currency === defaultCurrency) {
        return formatMoney(cents, defaultCurrency, defaultFormat, locale);
      }
      return formatMoney(cents, currency, formatDefaultsFor(currency), locale);
    };
  }, [defaultCurrency, decimals, symbolPosition, locale]);
}

/** The symbol + position to render for an account's own currency — the inline
 *  amount editor's affix. Matches `useAccountMoney`: the default currency uses
 *  the configured position, a foreign currency its display defaults. */
export function useAccountSymbol(
  currency?: string,
): { symbol: string; symbolPosition: SymbolPosition } {
  const { currency: defaultCurrency, symbolPosition } = useContext(CurrencyContext);
  return useMemo(() => {
    if (currency === undefined || currency === defaultCurrency) {
      return { symbol: currencySymbol(defaultCurrency), symbolPosition };
    }
    return {
      symbol: currencySymbol(currency),
      symbolPosition: formatDefaultsFor(currency).symbolPosition,
    };
  }, [currency, defaultCurrency, symbolPosition]);
}
