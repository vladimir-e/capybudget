import { useCallback } from "react";
import { useLocale } from "@capybudget/i18n";

/**
 * Locale-aware percentage formatter. Takes an already-computed percentage
 * value (e.g. `12.3`, not `0.123`) and renders it with the active locale's
 * decimal separator — `12.3%` under `en`, `12,3%` under `ru` — keeping the
 * `%` glyph adjacent to match the rest of the UI. The grouping/decimal glyphs
 * follow the active UI language, the same way money formatting does.
 */
export function useFormatPercent(): (value: number, fractionDigits?: number) => string {
  const locale = useLocale();
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
