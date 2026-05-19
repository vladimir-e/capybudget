import type { Transaction } from "@capybudget/core";

export type SpendingViewMode = "expenses" | "income";

export interface SliceDrilldown {
  categoryId: string;
  categoryName: string;
  mode: SpendingViewMode;
}

/** Build the drilldown state for a pie-slice click. The viewMode is
 *  captured at click time so a later switch of the view-mode toggle
 *  doesn't reinterpret the open drilldown. */
export function buildSliceDrilldown(
  slice: { categoryId: string; name: string },
  mode: SpendingViewMode,
): SliceDrilldown {
  return {
    categoryId: slice.categoryId,
    categoryName: slice.name,
    mode,
  };
}

/** Filter transactions matching the active spending drilldown — same
 *  type-and-category gating that produced the underlying breakdown. */
export function filterForSliceDrilldown(
  transactions: Transaction[],
  drilldown: SliceDrilldown,
): Transaction[] {
  const wantType = drilldown.mode === "expenses" ? "expense" : "income";
  return transactions.filter(
    (t) => t.type === wantType && t.categoryId === drilldown.categoryId,
  );
}
