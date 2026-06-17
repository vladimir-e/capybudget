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
