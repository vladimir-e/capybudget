import { filterTransactionsByDateRange } from "@capybudget/core";
import type { DateRange, Transaction } from "@capybudget/core";

export type CompareViewMode = "expense" | "income";

/** The transaction window for a clicked trend bucket, `[start, end)`.
 *
 *  Derived from the trend point's own period boundary — never re-parsed from
 *  the locale-formatted X-axis label — so it lines up exactly with the buckets
 *  `getCategoryTrends` produced. `pointDate` is the bucket's ISO period start
 *  (`TrendPoint.date`): first-of-month for monthly granularity, the Monday of
 *  the week for weekly. The window is clamped to `dateRange` on both ends so a
 *  partial leading or trailing bucket can't reach outside the charted period. */
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

/** One row of the Compare line chart. `monthLabel` is the localized X label;
 *  `month` is core's English bucket label, kept for the drilldown title's
 *  stable identity. `__start`/`__end` are the bucket's ISO window (see
 *  `bucketWindow`). The remaining keys are dynamic per-category amounts, keyed
 *  by the localized category display name. */
export type CompareChartRow = {
  month: string;
  monthLabel: string;
  __start: string;
  __end: string;
} & Record<string, string | number>;

/** Resolve the chart row a Recharts `LineChart` `onClick` refers to.
 *
 *  The 3.x wrapper `onClick` passes a `MouseHandlerDataParam` with no
 *  `activePayload` — only `activeTooltipIndex` (a number for a categorical
 *  chart) and `activeLabel` (the X value). We index our own `chartData`:
 *  the tooltip index first, then an X-label match as a fallback so a
 *  future Recharts change to the index field can't silently break the click.
 *  Returns `null` when neither resolves to a valid row. */
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

/** A click target for the Compare line-chart drilldown.
 *
 *  `range` is the clicked bucket's own date window (see `bucketWindow`).
 *  `categoryIds` is the selected set, using `""` for the synthetic
 *  Uncategorized bucket — the same encoding `getCategoryTrends` accepts. */
export interface CompareDrilldown {
  /** Display label for the clicked bucket, e.g. "Jan 2024" or "Jan 6". */
  label: string;
  /** The bucket's transaction window, `[from, to)`. */
  range: { from: Date; to: Date };
  /** Selected category ids (`""` = Uncategorized). */
  categoryIds: string[];
  mode: CompareViewMode;
}

/** Filter transactions matching the active Compare drilldown — the same
 *  type-and-category gating that produced the chart, scoped to the clicked
 *  bucket's date window. */
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
