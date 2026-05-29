import type {
  Category,
  CategoryHistoricalStatsResult,
  DateRange,
  MonthlyBudgetSummary,
  Transaction,
} from "@capybudget/core";
import {
  getCategoryHistoricalStats,
  getMonthlyBudgetSummary,
} from "@capybudget/core";
import { effectiveTarget } from "./monthly-budget-progress";

/** A budget row enriched with the category's spending history and the
 *  resulting target. This is what the Monthly Budget UI renders: the
 *  current month's `{ assigned, spent }` plus the historical context that
 *  lets every category show a progress bar by default. */
export interface BudgetRow {
  categoryId: string;
  /** Explicit monthly budget in cents. `null` = no explicit budget set. */
  assigned: number | null;
  /** Abs cents spent this (viewed) month. */
  spent: number;
  /** Abs cents spent in the calendar month before the viewed month. */
  lastMonth: number;
  /** Mean monthly spend over the 3 months before the viewed month. */
  avg3Month: number;
  /** Derived target from history: `max(lastMonth, avg3Month)`, or `null`
   *  when there is no usable history. */
  implicitTarget: number | null;
  /** What spend is measured against: `assigned ?? implicitTarget`. `null`
   *  only when both are absent (the untargeted, neutral case). */
  effectiveTarget: number | null;
  /** True when this row is tracking against the derived target rather than
   *  an explicit budget (`assigned === null && implicitTarget !== null`). */
  isImplicit: boolean;
}

export interface BudgetView {
  rows: BudgetRow[];
  /** Sum of effective targets across all rows — the meaningful "planned"
   *  total now that most rows target implicitly. Rows with no effective
   *  target contribute 0. */
  totalTargeted: number;
  /** Sum of explicit `assigned` across rows that have one. Retained for the
   *  subset of UI that still speaks in manually-budgeted terms. */
  totalAssigned: number;
  /** Sum of `spent` across all rows. */
  totalSpent: number;
  /** Count of rows whose spend is strictly over their effective target.
   *  Untargeted rows never count. */
  overCount: number;
  /** Months of dataset history before the viewed month. `0` ⟺ every row is
   *  untargeted. */
  monthsOfData: number;
}

/** Compose the per-category month summary with historical stats into the
 *  enriched rows the Monthly Budget tab renders. Keeps `getMonthlyBudgetSummary`
 *  focused on the current month; the historical/target layer lives here. */
export function buildBudgetView(
  transactions: Transaction[],
  categories: Category[],
  range: DateRange,
): BudgetView {
  const summary = getMonthlyBudgetSummary(transactions, categories, range);
  const stats = getCategoryHistoricalStats(transactions, categories, range);
  return mergeBudgetView(summary, stats);
}

/** Pure merge step, split out so it can be unit-tested without re-deriving
 *  the inputs. */
export function mergeBudgetView(
  summary: MonthlyBudgetSummary,
  stats: CategoryHistoricalStatsResult,
): BudgetView {
  let totalTargeted = 0;
  let totalAssigned = 0;
  let totalSpent = 0;
  let overCount = 0;

  const rows: BudgetRow[] = summary.rows.map((r) => {
    const s = stats.byCategory.get(r.categoryId);
    const lastMonth = s?.lastMonth ?? 0;
    const avg3Month = s?.avg3Month ?? 0;
    const implicitTarget = s?.implicitTarget ?? null;
    const target = effectiveTarget(r.assigned, implicitTarget);

    totalSpent += r.spent;
    if (r.assigned !== null) totalAssigned += r.assigned;
    if (target !== null) {
      totalTargeted += target;
      if (r.spent > target) overCount += 1;
    }

    return {
      categoryId: r.categoryId,
      assigned: r.assigned,
      spent: r.spent,
      lastMonth,
      avg3Month,
      implicitTarget,
      effectiveTarget: target,
      isImplicit: r.assigned === null && implicitTarget !== null,
    };
  });

  return {
    rows,
    totalTargeted,
    totalAssigned,
    totalSpent,
    overCount,
    monthsOfData: stats.monthsOfData,
  };
}
