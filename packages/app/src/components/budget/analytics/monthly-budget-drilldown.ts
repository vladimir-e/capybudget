import type { Category, DateRange, Transaction } from "@capybudget/core";
import { filterTransactionsByDateRange } from "@capybudget/core";

/** Possible drilldown contexts for the Monthly Budget tab. `category` is
 *  the per-row Spent cell; `tracked` and `other` mirror the two clickable
 *  KPI cards (Spent tracked vs Other Spending). */
export type MonthlyBudgetDrilldown =
  | { kind: "category"; category: Category }
  | { kind: "tracked" }
  | { kind: "other" };

/** Partition non-archived, non-Income categories into tracked / untracked
 *  by whether `assigned` is non-null. Mirrors `getMonthlyBudgetSummary`'s
 *  partitioning exactly — the KPI-bucket drilldowns reuse these sets so
 *  the listed transactions match the displayed totals. */
export function partitionCategoriesForBudget(categories: Category[]): {
  trackedIds: Set<string>;
  untrackedIds: Set<string>;
} {
  const trackedIds = new Set<string>();
  const untrackedIds = new Set<string>();
  for (const c of categories) {
    if (c.archived || c.group === "Income") continue;
    if (c.assigned !== null) trackedIds.add(c.id);
    else untrackedIds.add(c.id);
  }
  return { trackedIds, untrackedIds };
}

/** Filter transactions for a Monthly Budget drilldown: expenses only,
 *  within the month, matching the drilldown's scope. Uncategorized
 *  expenses are intentionally excluded from the KPI buckets — the
 *  summary numbers themselves ignore them. */
export function filterForBudgetDrilldown(
  transactions: Transaction[],
  dateRange: DateRange,
  drilldown: MonthlyBudgetDrilldown,
  categoryPartition: { trackedIds: Set<string>; untrackedIds: Set<string> },
): Transaction[] {
  const inRange = filterTransactionsByDateRange(transactions, dateRange);
  return inRange.filter((t) => {
    if (t.type !== "expense") return false;
    switch (drilldown.kind) {
      case "category":
        return t.categoryId === drilldown.category.id;
      case "tracked":
        return categoryPartition.trackedIds.has(t.categoryId);
      case "other":
        return categoryPartition.untrackedIds.has(t.categoryId);
    }
  });
}

/** Modal title for the active drilldown — matches the cell the user
 *  clicked. */
export function budgetDrilldownTitle(d: MonthlyBudgetDrilldown): string {
  switch (d.kind) {
    case "category":
      return d.category.name;
    case "tracked":
      return "Spent (tracked)";
    case "other":
      return "Other Spending";
  }
}
