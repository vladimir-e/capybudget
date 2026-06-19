import type { Category, DateRange, Transaction } from "@capybudget/core";
import { filterTransactionsByDateRange } from "@capybudget/core";
import type { TFunction } from "i18next";

/** Drilldown contexts for the Monthly Budget tab. `category` is a per-row
 *  Spent cell; `all` mirrors the "Spent this month" KPI — every eligible
 *  categorized expense in the viewed month. */
export type MonthlyBudgetDrilldown =
  | { kind: "category"; category: Category }
  | { kind: "all" };

/** Ids of the categories whose spend rolls up into the budget — non-archived,
 *  non-Income. Mirrors `getMonthlyBudgetSummary`'s eligibility exactly, so the
 *  "Spent this month" drilldown lists exactly the transactions behind the
 *  total. (Uncategorized expenses are excluded there too.) */
export function eligibleBudgetCategoryIds(categories: Category[]): Set<string> {
  const ids = new Set<string>();
  for (const c of categories) {
    if (c.archived || c.group === "Income") continue;
    ids.add(c.id);
  }
  return ids;
}

/** Filter transactions for a Monthly Budget drilldown: expenses only, within
 *  the month, matching the drilldown's scope. Uncategorized expenses are
 *  intentionally excluded — the summary numbers themselves ignore them. */
export function filterForBudgetDrilldown(
  transactions: Transaction[],
  dateRange: DateRange,
  drilldown: MonthlyBudgetDrilldown,
  eligibleIds: Set<string>,
): Transaction[] {
  const inRange = filterTransactionsByDateRange(transactions, dateRange);
  return inRange.filter((t) => {
    if (t.type !== "expense") return false;
    switch (drilldown.kind) {
      case "category":
        return t.categoryId === drilldown.category.id;
      case "all":
        return eligibleIds.has(t.categoryId);
    }
  });
}

/** Modal title for the active drilldown — matches the cell the user clicked.
 *  `categoryDisplay` localizes a canonical default category name (the stored
 *  string is unchanged; only the title text is). */
export function budgetDrilldownTitle(
  d: MonthlyBudgetDrilldown,
  t: TFunction<"analytics">,
  categoryDisplay: (name: string) => string,
): string {
  switch (d.kind) {
    case "category":
      return categoryDisplay(d.category.name);
    case "all":
      return t("monthlyBudget.spentThisMonth");
  }
}
