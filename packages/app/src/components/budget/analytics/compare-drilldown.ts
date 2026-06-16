import { filterTransactionsByDateRange } from "@capybudget/core";
import type { Transaction } from "@capybudget/core";

export type CompareViewMode = "expense" | "income";

/** A click target for the Compare line-chart drilldown.
 *
 *  `range` is the clicked bucket's own date window — derived from the trend
 *  point's period boundaries, never re-parsed from the X-axis label — so the
 *  filter lines up exactly with the buckets `getCategoryTrends` produced
 *  (handles both monthly and weekly granularity).
 *
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
