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
import { useFormatLocale } from "@capybudget/i18n";

export { DEFAULT_CURRENCY };

export interface CurrencyConfig extends MoneyFormat {
  currency: string;
}

const DEFAULT_CONFIG: CurrencyConfig = {
  currency: DEFAULT_CURRENCY,
  ...formatDefaultsFor(DEFAULT_CURRENCY),
};

export const CurrencyContext = createContext<CurrencyConfig>(DEFAULT_CONFIG);

export function useCurrency(): string {
  return useContext(CurrencyContext).currency;
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
