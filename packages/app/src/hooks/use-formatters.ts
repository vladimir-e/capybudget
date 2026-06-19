import { useMemo } from "react";
import {
  formatDateLabel,
  formatMonthLabel,
  formatMonthShort,
} from "@capybudget/core";
import { useLocale } from "@capybudget/i18n";
import { useFormatMoney } from "@/contexts/currency-context";
import { useFormatPercent } from "@/lib/format-percent";

export interface Formatters {
  money: (cents: number) => string;
  moneyCompact: (cents: number) => string;
  percent: (value: number, fractionDigits?: number) => string;
  date: (isoYmd: string) => string;
  month: (isoYmd: string) => string;
  monthShort: (date: Date) => string;
}

// `money`/`moneyCompact` read the currency context, so this hook is only valid
// under a `CurrencyProvider` (the budget surface). The rest depend on locale
// alone; surfaces without the currency context use `useFormatPercent`/`useLocale`.
export function useFormatters(): Formatters {
  const { format, formatCompact } = useFormatMoney();
  const percent = useFormatPercent();
  const locale = useLocale();

  return useMemo<Formatters>(
    () => ({
      money: format,
      moneyCompact: formatCompact,
      percent,
      date: (isoYmd) => formatDateLabel(isoYmd, locale),
      month: (isoYmd) => formatMonthLabel(isoYmd, locale),
      monthShort: (date) => formatMonthShort(date, locale),
    }),
    [format, formatCompact, percent, locale],
  );
}
