import { formatMonthLabel, formatMonthShort, toDateString } from "@capybudget/core";
import type { DateRange, Transaction } from "@capybudget/core";
import type { PeriodType } from "@/stores/analytics-store";

/** Human-readable label for an analytics date range, picked to match the
 *  period type (e.g. "May 2026", "Q2 2026", "Jan – Mar 2026"). Month names
 *  follow the active UI language, threaded in by the caller (the same locale
 *  the currency formatter reads). Used both by the date-range nav and by the
 *  transactions browser modal subtitle so the two surfaces stay in sync. */
export function formatRangeLabel(range: DateRange, periodType: PeriodType, locale: string): string {
  if (periodType === "allTime") return "All Time";

  const start = range.start;
  const endDate = new Date(range.end);
  endDate.setDate(endDate.getDate() - 1);

  const monthAndYear = (d: Date) => formatMonthLabel(toDateString(d), locale);

  if (periodType === "month") {
    return monthAndYear(start);
  }

  if (periodType === "quarter") {
    const q = Math.floor(start.getMonth() / 3) + 1;
    return `Q${q} ${start.getFullYear()}`;
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

/** Transaction count plus the abs-summed total when there's more than one,
 *  e.g. "3 transactions · $128.40". The per-transaction `Math.abs` keeps the
 *  total reconciled with the pie-slice / merchant-row / chart figure that
 *  opened the modal. */
export function formatCountAndTotal(
  transactions: Transaction[],
  format: (cents: number) => string,
): string {
  const count = transactions.length;
  const base = `${count} transaction${count === 1 ? "" : "s"}`;
  if (count <= 1) return base;
  const total = transactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);
  return `${base} · ${format(total)}`;
}

/** Subtitle for the transactions drilldown modal: range label + count/total. */
export function formatDrilldownSubtitle(
  range: DateRange,
  periodType: PeriodType,
  transactions: Transaction[],
  format: (cents: number) => string,
  locale: string,
): string {
  return `${formatRangeLabel(range, periodType, locale)} · ${formatCountAndTotal(transactions, format)}`;
}
