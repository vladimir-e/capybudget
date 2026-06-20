import { useCallback } from "react";
import { useFormatLocale } from "@capybudget/i18n";

// Takes an already-computed percentage (`12.3`, not `0.123`).
export function useFormatPercent(): (value: number, fractionDigits?: number) => string {
  const locale = useFormatLocale();
  return useCallback(
    (value: number, fractionDigits = 1) => {
      const num = new Intl.NumberFormat(locale, {
        style: "decimal",
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
      }).format(value);
      return `${num}%`;
    },
    [locale],
  );
}
