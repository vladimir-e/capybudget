import { filterTransactionsByDateRange } from "@capybudget/core";
import type { DateRange, Transaction, TrendPoint } from "@capybudget/core";

export type CompareViewMode = "expense" | "income";

// Join on the category id, never the localized display name: two categories
// that share a translated label would otherwise collapse into one chart line.
export function seriesKeyFor(categoryId: string): string {
  return `cat:${categoryId}`;
}

// Derived from the trend point's own ISO period start, never re-parsed from the
// locale-formatted X-axis label, so it matches the buckets getCategoryTrends
// produced. Clamped to dateRange so a partial edge bucket can't reach outside it.
export function bucketWindow(
  pointDate: string,
  granularity: "month" | "week",
  dateRange: DateRange,
): { start: Date; end: Date } {
  const periodStart = new Date(pointDate);
  const periodEnd =
    granularity === "week"
      ? new Date(periodStart.getFullYear(), periodStart.getMonth(), periodStart.getDate() + 7)
      : new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, 1);
  const startMs = Math.max(periodStart.getTime(), dateRange.start.getTime());
  const endMs = Math.min(periodEnd.getTime(), dateRange.end.getTime());
  return { start: new Date(startMs), end: new Date(endMs) };
}

export type CompareChartRow = {
  // English bucket label, kept for the drilldown title's stable identity.
  month: string;
  monthLabel: string;
  __start: string;
  __end: string;
} & Record<string, string | number>;

export function buildCompareChartRows(
  points: TrendPoint[],
  granularity: "month" | "week",
  dateRange: DateRange,
  xLabel: (isoDate: string) => string,
): CompareChartRow[] {
  return points.map((point): CompareChartRow => {
    const win = bucketWindow(point.date, granularity, dateRange);
    const row: CompareChartRow = {
      month: point.month,
      monthLabel: xLabel(point.date),
      __start: win.start.toISOString(),
      __end: win.end.toISOString(),
    };
    for (const [catId, amt] of Object.entries(point.byCategory)) {
      row[seriesKeyFor(catId)] = amt;
    }
    return row;
  });
}

// Recharts 3.x `onClick` passes no `activePayload` — only `activeTooltipIndex`
// and `activeLabel`. Index by tooltip index first, then fall back to an X-label
// match so a future change to the index field can't silently break the click.
export function resolveClickedRow(
  rows: CompareChartRow[],
  activeTooltipIndex: unknown,
  activeLabel: unknown,
): CompareChartRow | null {
  // Only coerce a real number or a numeric string — `Number(null)`/`Number("")`
  // are `0` and would wrongly resolve to the first bucket on an empty click.
  if (typeof activeTooltipIndex === "number" || typeof activeTooltipIndex === "string") {
    const idx = Number(activeTooltipIndex);
    if (activeTooltipIndex !== "" && Number.isInteger(idx) && idx >= 0 && idx < rows.length) {
      return rows[idx];
    }
  }
  if (typeof activeLabel === "string") {
    return rows.find((r) => r.monthLabel === activeLabel) ?? null;
  }
  return null;
}

export interface CompareDrilldown {
  label: string;
  range: { from: Date; to: Date };
  // `""` encodes the Uncategorized bucket, matching what getCategoryTrends accepts.
  categoryIds: string[];
  mode: CompareViewMode;
}

export function filterForCompareDrilldown(
  transactions: Transaction[],
  drilldown: CompareDrilldown,
): Transaction[] {
  const wanted = new Set(drilldown.categoryIds);
  const inRange = filterTransactionsByDateRange(transactions, {
    start: drilldown.range.from,
    end: drilldown.range.to,
  });
  return inRange.filter(
    (t) => t.type === drilldown.mode && wanted.has(t.categoryId || ""),
  );
}
