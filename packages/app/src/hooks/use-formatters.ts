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
  /** Amount in cents → currency string ("$12.50" / "1 250,00 ₽"). */
  money: (cents: number) => string;
  /** Compact currency string for dense axes/badges ("$1.2K"). */
  moneyCompact: (cents: number) => string;
  /** Already-computed percentage (`12.3`, not `0.123`) → "12.3%" / "12,3%". */
  percent: (value: number, fractionDigits?: number) => string;
  /** YYYY-MM-DD → "Mar 10, 2026". */
  date: (isoYmd: string) => string;
  /** YYYY-MM-DD → "March 2026". */
  month: (isoYmd: string) => string;
  /** Date → abbreviated month name ("Mar" / "март"), for chart axes. */
  monthShort: (date: Date) => string;
}

/**
 * Locale+currency-aware formatter bundle for the render edge (see the
 * `useFormatters()` section in `specs/I18N.md`).
 *
 * Seam: `money`/`moneyCompact` read the currency context, so this hook is only
 * valid under a `CurrencyProvider` (the budget surface). `percent`/`date`/
 * `month`/`monthShort` depend on locale alone — surfaces outside the currency
 * context that need only those can keep using `useFormatPercent`/`useLocale`
 * directly.
 */
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
