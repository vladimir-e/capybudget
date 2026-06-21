import { formatMonthLabel, formatMonthShort, toDateString } from "@capybudget/core";
import type { CurrencyConverter, DateRange, Transaction } from "@capybudget/core";
import type { TFunction } from "i18next";
import type { PeriodType } from "@/stores/analytics-store";

type Translate = TFunction<"analytics">;

export function formatRangeLabel(
  range: DateRange,
  periodType: PeriodType,
  locale: string,
  t: Translate,
): string {
  if (periodType === "allTime") return t("period.allTime");

  const start = range.start;
  const endDate = new Date(range.end);
  endDate.setDate(endDate.getDate() - 1);

  const monthAndYear = (d: Date) => formatMonthLabel(toDateString(d), locale);

  if (periodType === "month") {
    return monthAndYear(start);
  }

  if (periodType === "quarter") {
    const q = Math.floor(start.getMonth() / 3) + 1;
    return t("period.quarterLabel", { quarter: q, year: start.getFullYear() });
  }

  if (periodType === "year") {
    return `${start.getFullYear()}`;
  }

  // custom
  const startYear = start.getFullYear();
  const endYear = endDate.getFullYear();
  const sameMonth = start.getMonth() === endDate.getMonth() && startYear === endYear;

  if (sameMonth) {
    return monthAndYear(start);
  }

  if (startYear === endYear) {
    return `${formatMonthShort(start, locale)} – ${formatMonthShort(endDate, locale)} ${startYear}`;
  }

  return `${formatMonthShort(start, locale)} ${startYear} – ${formatMonthShort(endDate, locale)} ${endYear}`;
}

// Per-transaction `Math.abs` (on the converted flow) keeps the total reconciled
// with the pie-slice / merchant-row / chart figure that opened the modal,
// instead of netting out — and converts so a foreign account's drilldown total
// matches the default-currency figure above it.
export function formatCountAndTotal(
  transactions: Transaction[],
  format: (cents: number) => string,
  converter: CurrencyConverter,
  t: Translate,
): string {
  const count = transactions.length;
  const base = t("drilldown.transactionCount", { count });
  if (count <= 1) return base;
  const total = transactions.reduce(
    (sum, tx) => sum + Math.abs(converter.flowToDefault(tx.amount, tx.fxRate)),
    0,
  );
  return `${base} · ${format(total)}`;
}

export function formatDrilldownSubtitle(
  range: DateRange,
  periodType: PeriodType,
  transactions: Transaction[],
  format: (cents: number) => string,
  converter: CurrencyConverter,
  locale: string,
  t: Translate,
): string {
  return `${formatRangeLabel(range, periodType, locale, t)} · ${formatCountAndTotal(transactions, format, converter, t)}`;
}
