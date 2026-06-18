import type { DateRange, Transaction } from "@capybudget/core";
import type { PeriodType } from "@/stores/analytics-store";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const SHORT_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Human-readable label for an analytics date range, picked to match the
 *  period type (e.g. "May 2026", "Q2 2026", "Jan – Mar 2026"). Used both
 *  by the date-range nav and by the transactions browser modal subtitle so
 *  the two surfaces stay in sync. */
export function formatRangeLabel(range: DateRange, periodType: PeriodType): string {
  if (periodType === "allTime") return "All Time";

  const start = range.start;
  const endDate = new Date(range.end);
  endDate.setDate(endDate.getDate() - 1);

  if (periodType === "month") {
    return `${MONTH_NAMES[start.getMonth()]} ${start.getFullYear()}`;
  }

  if (periodType === "quarter") {
    const q = Math.floor(start.getMonth() / 3) + 1;
    return `Q${q} ${start.getFullYear()}`;
  }

  if (periodType === "year") {
    return `${start.getFullYear()}`;
  }

  // custom
  const startMonth = start.getMonth();
  const startYear = start.getFullYear();
  const endMonth = endDate.getMonth();
  const endYear = endDate.getFullYear();

  if (startMonth === endMonth && startYear === endYear) {
    return `${MONTH_NAMES[startMonth]} ${startYear}`;
  }

  if (startYear === endYear) {
    return `${SHORT_MONTHS[startMonth]} – ${SHORT_MONTHS[endMonth]} ${startYear}`;
  }

  return `${SHORT_MONTHS[startMonth]} ${startYear} – ${SHORT_MONTHS[endMonth]} ${endYear}`;
}

/** Transaction count plus the abs-summed total when there's more than one,
 *  e.g. "3 transactions · $128.40". The per-transaction `Math.abs` keeps the
 *  total reconciled with the pie-slice / merchant-row / chart figure that
 *  opened the modal. Shared by every drilldown subtitle. `format` is the
 *  currency-bound formatter from `useFormatMoney`. */
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
): string {
  return `${formatRangeLabel(range, periodType)} · ${formatCountAndTotal(transactions, format)}`;
}
