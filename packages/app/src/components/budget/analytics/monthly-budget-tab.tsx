import { useMemo, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  basisLabel,
  CATEGORY_GROUP_ORDER,
} from "@capybudget/core";
import type {
  Category,
  CategoryGroup,
  DateRange,
  Transaction,
} from "@capybudget/core";
import { useLocale } from "@capybudget/i18n";
import { useFormatMoney } from "@/contexts/currency-context";
import { useBudgetBasis } from "./use-budget-basis";
import { buildBudgetView } from "./monthly-budget-rows";
import { BudgetBarLegend } from "./budget-bar";
import { TransactionsModal } from "@/components/budget/transactions-modal";
import { formatDrilldownSubtitle } from "./format-range";
import {
  budgetDrilldownTitle,
  eligibleBudgetCategoryIds,
  filterForBudgetDrilldown,
  type MonthlyBudgetDrilldown,
} from "./monthly-budget-drilldown";
import { KpiStrip } from "./monthly-budget-kpi-strip";
import { ColumnHeader, GroupSection } from "./monthly-budget-group-section";
import { EmptyState } from "@/components/ui/empty-state";
import { NO_CATEGORIES_YET } from "./empty-copy";

interface MonthlyBudgetTabProps {
  transactions: Transaction[];
  categories: Category[];
  dateRange: DateRange;
  hasAnyTransactions: boolean;
}

export function MonthlyBudgetTab({
  transactions,
  categories,
  dateRange,
  hasAnyTransactions,
}: MonthlyBudgetTabProps) {
  const { format } = useFormatMoney();
  const locale = useLocale();
  const [hideUntargeted, setHideUntargeted] = useState(false);
  const [drilldown, setDrilldown] = useState<MonthlyBudgetDrilldown | null>(null);

  const [basis, setBasis] = useBudgetBasis();
  // Resolved label for the active basis, computed once and threaded to the
  // legend trigger and every bar's reference pin so the wording can't diverge.
  // The viewed month is the range's start (a first-of-month boundary).
  const referenceLabel = useMemo(
    () => basisLabel(basis, dateRange.start),
    [basis, dateRange.start],
  );

  const view = useMemo(
    () => buildBudgetView(transactions, categories, dateRange, basis),
    [transactions, categories, dateRange, basis],
  );

  // Per-category lookup so each row gets its enriched data without scanning.
  const rowByCategory = useMemo(
    () => new Map(view.rows.map((r) => [r.categoryId, r])),
    [view.rows],
  );

  const targetedCount = view.rows.reduce(
    (n, r) => n + (r.effectiveTarget !== null ? 1 : 0),
    0,
  );
  // Whether any row draws a real zoned bar (vs a dashed placeholder). Gates
  // the legend and the hide-untargeted filter.
  const hasTargetedRows = targetedCount > 0;

  // Categories grouped by group, in canonical order, excluding Income and archived.
  const grouped = useMemo(() => {
    const map = new Map<CategoryGroup, Category[]>();
    for (const c of categories) {
      if (c.archived) continue;
      if (c.group === "Income") continue;
      if (!map.has(c.group)) map.set(c.group, []);
      map.get(c.group)!.push(c);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.sortOrder - b.sortOrder);
    }
    return map;
  }, [categories]);

  // Income excluded → don't render it. Also include any user-defined groups
  // not in the canonical order (matching how the rest of the app lists groups).
  const orderedGroups = useMemo(() => {
    const seen = new Set<CategoryGroup>();
    const result: CategoryGroup[] = [];
    for (const g of CATEGORY_GROUP_ORDER) {
      if (g === "Income") continue;
      if (grouped.has(g)) {
        result.push(g);
        seen.add(g);
      }
    }
    for (const g of grouped.keys()) {
      if (!seen.has(g)) result.push(g);
    }
    return result;
  }, [grouped]);

  const hasCategories = orderedGroups.length > 0;

  // Eligible category ids, so the "Spent this month" drilldown lists exactly
  // the transactions behind `totalSpent`.
  const eligibleIds = useMemo(
    () => eligibleBudgetCategoryIds(categories),
    [categories],
  );

  // Pre-filtered transactions for the active drilldown.
  const drilldownTransactions = useMemo(
    () =>
      drilldown
        ? filterForBudgetDrilldown(transactions, dateRange, drilldown, eligibleIds)
        : [],
    [drilldown, transactions, dateRange, eligibleIds],
  );

  return (
    // `pt-4` lives on the tab itself rather than the outer scroll container so
    // the Monthly Budget KPI strip gets breathing room above it without
    // re-introducing a dead zone above the sticky `ColumnHeader` (this padding
    // scrolls with the content, the sticky header still pins flush with the
    // viewport top).
    <div className="space-y-5 pt-4">
      {/* KPI strip — meaningful by default, even before anything is manually
       *  budgeted. "Spent this month" sums all categorized expense and drills
       *  into them; "Tracking toward" is the sum of effective targets (mostly
       *  implicit); "Over budget" counts rows past their target. */}
      <KpiStrip
        cards={[
          {
            label: "Spent this month",
            display: format(view.totalSpent),
            tone: "expense",
            onClick:
              view.totalSpent > 0 ? () => setDrilldown({ kind: "all" }) : undefined,
          },
          {
            label: "Tracking toward",
            display: format(view.totalTargeted),
          },
          {
            label: "Over budget",
            display: String(view.overCount),
            tone: view.overCount > 0 ? "expense" : "default",
          },
        ]}
      />

      {/* Empty state */}
      {!hasCategories ? (
        <EmptyState
          title="No categories to budget"
          description={
            hasAnyTransactions
              ? "Add categories to start tracking."
              : NO_CATEGORIES_YET
          }
        />
      ) : (
        <div className="space-y-3">
          {/* Filter + legend share one row: the "show only tracked" toggle
           *  sits under the Category column on the left, the history-pin legend
           *  stays out near the bars on the right. The toggle only appears when
           *  some rows are tracked and others aren't — otherwise an empty slot
           *  keeps the legend pinned right. The whole row needs at least one
           *  real bar drawn, or the pins it keys don't exist. */}
          {hasTargetedRows && (
            <div className="flex items-center justify-between gap-3 px-3">
              {targetedCount < view.rows.length ? (
                <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                  <Checkbox
                    checked={hideUntargeted}
                    onCheckedChange={(v) => setHideUntargeted(v === true)}
                  />
                  <span>
                    Show only tracked{" "}
                    <span className="text-muted-foreground tabular-nums">
                      ({targetedCount} of {view.rows.length})
                    </span>
                  </span>
                </label>
              ) : (
                <div />
              )}
              <BudgetBarLegend
                basis={basis}
                referenceLabel={referenceLabel}
                onBasisChange={setBasis}
              />
            </div>
          )}

          <div>
            {/* Column-header row — sticks to the top of the scroll viewport so
             *  the labels stay visible while the user scrolls through groups. */}
            <ColumnHeader />

            <div className="space-y-4 pt-2">
              {orderedGroups.map((g) => {
                const cats = grouped.get(g) ?? [];
                return (
                  <GroupSection
                    key={g}
                    group={g}
                    categories={cats}
                    rowByCategory={rowByCategory}
                    hideUntargeted={hideUntargeted}
                    referenceLabel={referenceLabel}
                    onDrilldown={(category) => setDrilldown({ kind: "category", category })}
                  />
                );
              })}
            </div>
          </div>
        </div>
      )}

      <TransactionsModal
        open={drilldown !== null}
        onOpenChange={(open) => !open && setDrilldown(null)}
        transactions={drilldownTransactions}
        lockedFilters={
          drilldown
            ? {
                // `categoryId` chip only makes sense for the per-category
                // drilldown; the all-spend bucket spans many categories and
                // the period chip is enough context.
                ...(drilldown.kind === "category"
                  ? { categoryId: drilldown.category.id }
                  : {}),
                dateRange: { from: dateRange.start, to: dateRange.end },
              }
            : {}
        }
        title={drilldown ? budgetDrilldownTitle(drilldown) : ""}
        subtitle={drilldown ? formatDrilldownSubtitle(dateRange, "month", drilldownTransactions, format, locale) : undefined}
      />
    </div>
  );
}
