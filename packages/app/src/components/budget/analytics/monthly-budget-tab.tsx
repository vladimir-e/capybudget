import { useEffect, useMemo, useRef, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  formatMoney,
  getMonthlyBudgetSummary,
  parseMoney,
  centsToEditString,
  CATEGORY_GROUP_ORDER,
} from "@capybudget/core";
import type {
  Category,
  CategoryGroup,
  DateRange,
  Transaction,
} from "@capybudget/core";
import { useSetCategoryAssigned } from "@/hooks/use-category-mutations";
import { toast } from "sonner";
import { progressState } from "./monthly-budget-progress";
import { TransactionsModal } from "@/components/budget/transactions-modal";
import { TransactionsDrilldownLink } from "@/components/budget/transactions-drilldown-link";
import { formatRangeLabel } from "./format-range";
import {
  budgetDrilldownTitle,
  filterForBudgetDrilldown,
  partitionCategoriesForBudget,
  type MonthlyBudgetDrilldown,
} from "./monthly-budget-drilldown";

// ── Color palette ────
//
// Binary against the effective target: under/at target is income-green, over
// is expense-red. Untargeted rows (no budget, no history) render neutral —
// the muted track stands in, so there's no fill color for that state.
const PROGRESS_COLOR = {
  ok: "var(--amount-income)",
  over: "var(--amount-expense)",
  untargeted: "var(--muted-foreground)",
} as const;

// ── KPI strip ────

interface KPICard {
  label: string;
  value: number;
  tone?: "default" | "income" | "expense";
  /** When set, the value renders as a drilldown link that opens the
   *  transactions browser for whatever scope this card represents. */
  onClick?: () => void;
}

function KpiStrip({ cards }: { cards: KPICard[] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {cards.map((c) => {
        const toneClass =
          c.tone === "income"
            ? "text-amount-income"
            : c.tone === "expense"
              ? "text-amount-expense"
              : "text-foreground";
        const valueClass = `text-xl font-bold tabular-nums mt-1 ${toneClass}`;
        return (
          <div key={c.label} className="rounded-lg border bg-card px-4 py-3">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {c.label}
            </div>
            {c.onClick ? (
              <div className={valueClass}>
                <TransactionsDrilldownLink
                  onClick={c.onClick}
                  ariaLabel={`View ${c.label} transactions`}
                >
                  {formatMoney(c.value)}
                </TransactionsDrilldownLink>
              </div>
            ) : (
              <div className={valueClass}>{formatMoney(c.value)}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Progress bar ────

function ProgressBar({ spent, assigned }: { spent: number; assigned: number }) {
  const state = progressState(spent, assigned, null);
  const ratio = assigned === 0 ? (spent > 0 ? 1 : 0) : spent / assigned;

  // Cap the filled bar at 100%; overshoot gets a separate tail beyond it.
  const filled = Math.min(ratio, 1) * 100;
  const overshoot = Math.max(ratio - 1, 0);
  // Compress overshoot logarithmically so a 5x overrun doesn't dominate the row.
  const overshootDisplay = overshoot > 0 ? Math.min(Math.log2(1 + overshoot) * 25, 60) : 0;
  const hasOvershoot = overshootDisplay > 0;

  // Track and tail render as a single continuous bar — no gap. When overshoot
  // exists, the track loses its right-rounded corners and the tail picks them
  // up, so the join reads as one pill rather than two disconnected segments.
  return (
    <div className="flex items-center h-2">
      <div
        className={`relative h-2 flex-1 bg-muted overflow-hidden rounded-l-full ${
          hasOvershoot ? "" : "rounded-r-full"
        }`}
      >
        <div
          className="absolute left-0 top-0 h-full rounded-full transition-all"
          style={{
            width: `${filled}%`,
            backgroundColor: PROGRESS_COLOR[state],
          }}
        />
      </div>
      {hasOvershoot && (
        <div
          className="h-2 rounded-r-full"
          style={{
            width: `${overshootDisplay}%`,
            backgroundColor: PROGRESS_COLOR.over,
          }}
          aria-label="Over budget"
        />
      )}
    </div>
  );
}

// ── Inline assigned input ────

interface AssignedInputProps {
  category: Category;
}

/** Editable monthly target. Empty input commits as `null` (untracked);
 *  `0` commits as tracked-at-zero. Click to enter, Esc to cancel,
 *  Enter or blur to commit. */
function AssignedInput({ category }: AssignedInputProps) {
  // When not editing, the displayed value is derived directly from the prop.
  // When editing, we mount a separate <Editor> with its own local state and
  // an unconditional auto-focus on mount. This sidesteps the "sync state on
  // prop change" problem and the React Compiler warning that comes with it.
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <Editor
        category={category}
        onDone={() => setEditing(false)}
      />
    );
  }

  const display =
    category.assigned === null ? (
      <span className="text-muted-foreground/60 italic">add</span>
    ) : (
      <span className="tabular-nums">{formatMoney(category.assigned)}</span>
    );

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="text-right text-sm w-full rounded px-2 py-1 hover:bg-accent transition-colors"
      aria-label={`Edit assigned amount for ${category.name}`}
    >
      {display}
    </button>
  );
}

function Editor({ category, onDone }: { category: Category; onDone: () => void }) {
  const [value, setValue] = useState(() =>
    category.assigned === null ? "" : centsToEditString(category.assigned),
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const setAssigned = useSetCategoryAssigned();

  // Auto-focus runs once when the editor mounts.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function commit() {
    const trimmed = value.trim();
    let next: number | null;
    if (trimmed === "") {
      next = null;
    } else {
      // parseMoney coerces unparseable input to 0; guard explicitly so
      // typing "twenty" doesn't silently track the category at zero.
      const numericPart = trimmed.replace(/[^0-9.-]/g, "");
      if (numericPart === "" || isNaN(parseFloat(numericPart))) {
        // Garbage input — bail without writing.
        onDone();
        return;
      }
      const cents = parseMoney(trimmed);
      if (cents < 0) {
        // Negative assigned doesn't make sense — bail without writing.
        onDone();
        return;
      }
      next = cents;
    }

    if (next === category.assigned) {
      onDone();
      return;
    }

    setAssigned.mutate(
      { categoryId: category.id, assigned: next },
      {
        onError: () => toast.error(`Couldn't update ${category.name}`),
      },
    );
    onDone();
  }

  return (
    <div className="flex items-center justify-end">
      <span className="text-sm text-muted-foreground pr-0.5">$</span>
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onDone();
          }
        }}
        placeholder="0.00"
        className="h-7 bg-transparent border-0 border-b border-brand/40 rounded-none px-0.5 text-right text-sm tabular-nums focus:outline-none focus:ring-0 focus:border-brand/60 transition-colors"
        style={{ width: `${Math.max(value.length, 5) + 1}ch` }}
      />
    </div>
  );
}

// ── Category row ────

interface CategoryRowProps {
  category: Category;
  spent: number;
  onDrilldown: (category: Category) => void;
}

function CategoryRow({ category, spent, onDrilldown }: CategoryRowProps) {
  const tracked = category.assigned !== null;
  const remaining = tracked ? category.assigned! - spent : null;
  const state = progressState(spent, category.assigned, null);
  const hasSpent = spent > 0;

  return (
    <div
      className={`grid grid-cols-[minmax(0,1.4fr)_120px_120px_minmax(160px,2fr)_120px] gap-3 items-center px-3 py-2 rounded-md hover:bg-accent/40 transition-colors ${
        tracked ? "" : "opacity-70"
      }`}
    >
      {/* Name + dot */}
      <div className="flex items-center gap-2 min-w-0">
        <span
          className="h-2 w-2 rounded-full shrink-0"
          style={{ backgroundColor: tracked ? "var(--brand)" : "var(--muted-foreground)" }}
        />
        <span className="text-sm truncate">{category.name}</span>
      </div>

      {/* Assigned (editable) */}
      <AssignedInput category={category} />

      {/* Spent — tracked rows always show the number (incl. $0.00).
       *  Untracked rows show their spend if any, em-dash otherwise — that's
       *  the per-category counterpart to the "Other Spending" KPI.
       *  Clickable when there's spending to show; opens the transactions
       *  browser pre-filtered to this category + month. */}
      {hasSpent ? (
        <div className="text-right text-sm tabular-nums">
          <TransactionsDrilldownLink
            onClick={() => onDrilldown(category)}
            ariaLabel={`View ${category.name} transactions`}
          >
            {formatMoney(spent)}
          </TransactionsDrilldownLink>
        </div>
      ) : (
        <span className="text-right text-sm tabular-nums">
          {tracked ? (
            formatMoney(spent)
          ) : (
            <span className="text-muted-foreground/50">—</span>
          )}
        </span>
      )}

      {/* Progress */}
      <div>
        {tracked ? (
          <ProgressBar spent={spent} assigned={category.assigned!} />
        ) : (
          <span className="text-xs text-muted-foreground/60 italic">not tracked</span>
        )}
      </div>

      {/* Remaining */}
      <span
        className={`text-right text-sm tabular-nums ${
          state === "over" ? "text-amount-expense" : "text-foreground"
        }`}
      >
        {tracked ? (
          formatMoney(remaining!)
        ) : (
          <span className="text-muted-foreground/50">—</span>
        )}
      </span>
    </div>
  );
}

// ── Column header ────

/** Sticky labels above the rows — same grid as `CategoryRow` so columns line
 *  up with the data. */
function ColumnHeader() {
  return (
    <div className="sticky top-0 z-10 bg-background border-b grid grid-cols-[minmax(0,1.4fr)_120px_120px_minmax(160px,2fr)_120px] gap-3 items-center px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
      <span>Category</span>
      <span className="text-right">Assigned</span>
      <span className="text-right">Spent</span>
      <span /> {/* progress column intentionally unlabelled */}
      <span className="text-right">Remaining</span>
    </div>
  );
}

// ── Group section ────

interface GroupSectionProps {
  group: CategoryGroup;
  categories: Category[];
  spentByCategory: Map<string, number>;
  showOnlyTracked: boolean;
  onDrilldown: (category: Category) => void;
}

function GroupSection({
  group,
  categories,
  spentByCategory,
  showOnlyTracked,
  onDrilldown,
}: GroupSectionProps) {
  const visible = showOnlyTracked
    ? categories.filter((c) => c.assigned !== null)
    : categories;

  if (visible.length === 0) return null;

  const totalCount = categories.length;
  const trackedCount = categories.reduce(
    (n, c) => n + (c.assigned !== null ? 1 : 0),
    0,
  );

  return (
    <div className="space-y-0.5">
      {/* Group header — title only, full width, no per-group subtotals. */}
      <div className="px-3 pt-3 pb-1.5 border-b">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          {group}
          {trackedCount < totalCount && (
            <span className="ml-2 text-xs font-normal normal-case tracking-normal text-muted-foreground/60">
              {trackedCount}/{totalCount} tracked
            </span>
          )}
        </h3>
      </div>

      {/* Rows */}
      {visible.map((c) => (
        <CategoryRow
          key={c.id}
          category={c}
          spent={spentByCategory.get(c.id) ?? 0}
          onDrilldown={onDrilldown}
        />
      ))}
    </div>
  );
}

// ── Main ────

interface MonthlyBudgetTabProps {
  transactions: Transaction[];
  categories: Category[];
  dateRange: DateRange;
}

export function MonthlyBudgetTab({
  transactions,
  categories,
  dateRange,
}: MonthlyBudgetTabProps) {
  const [showOnlyTracked, setShowOnlyTracked] = useState(false);
  const [drilldown, setDrilldown] = useState<MonthlyBudgetDrilldown | null>(null);

  const summary = useMemo(
    () => getMonthlyBudgetSummary(transactions, categories, dateRange),
    [transactions, categories, dateRange],
  );

  // Build a quick lookup so each row doesn't search summary.rows
  const spentByCategory = useMemo(
    () => new Map(summary.rows.map((r) => [r.categoryId, r.spent])),
    [summary.rows],
  );

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

  const remaining = summary.totalAssigned - summary.totalSpentTracked;

  // Mirror `getMonthlyBudgetSummary`'s partitioning so the KPI-bucket
  // drilldowns sum to the displayed totals.
  const partition = useMemo(
    () => partitionCategoriesForBudget(categories),
    [categories],
  );

  // Pre-filtered transactions for the active drilldown.
  const drilldownTransactions = useMemo(
    () =>
      drilldown
        ? filterForBudgetDrilldown(transactions, dateRange, drilldown, partition)
        : [],
    [drilldown, transactions, dateRange, partition],
  );

  return (
    // `pt-4` lives on the tab itself rather than the outer scroll container so
    // the Monthly Budget KPI strip gets breathing room above it without
    // re-introducing a dead zone above the sticky `ColumnHeader` (this padding
    // scrolls with the content, the sticky header still pins flush with the
    // viewport top).
    <div className="space-y-5 pt-4">
      {/* KPI strip. `Assigned` and `Remaining` are math over `category.assigned`
       *  values — no transaction set maps cleanly to them, so they stay
       *  display-only. `Spent (tracked)` and `Other Spending` are sums of
       *  real expense transactions, so they get drilldown links. */}
      <KpiStrip
        cards={[
          { label: "Assigned", value: summary.totalAssigned },
          {
            label: "Spent (tracked)",
            value: summary.totalSpentTracked,
            tone: "expense",
            onClick:
              summary.totalSpentTracked > 0
                ? () => setDrilldown({ kind: "tracked" })
                : undefined,
          },
          {
            label: "Remaining",
            value: remaining,
            tone: remaining < 0 ? "expense" : "income",
          },
          {
            label: "Other Spending",
            value: summary.totalOtherSpending,
            onClick:
              summary.totalOtherSpending > 0
                ? () => setDrilldown({ kind: "other" })
                : undefined,
          },
        ]}
      />

      {/* Filter toggle */}
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <Checkbox
            checked={showOnlyTracked}
            onCheckedChange={(v) => setShowOnlyTracked(v === true)}
          />
          <span>Display only tracked categories</span>
        </label>
        <span className="text-xs text-muted-foreground tabular-nums">
          {summary.trackedCount} of {summary.totalCount} tracked
        </span>
      </div>

      {/* Empty state */}
      {orderedGroups.length === 0 ? (
        <p className="text-sm text-muted-foreground py-12 text-center">
          No categories to budget. Add categories to start tracking.
        </p>
      ) : (
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
                  spentByCategory={spentByCategory}
                  showOnlyTracked={showOnlyTracked}
                  onDrilldown={(category) => setDrilldown({ kind: "category", category })}
                />
              );
            })}
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
                // drilldown; the tracked / other buckets span many
                // categories and the period chip is enough context.
                ...(drilldown.kind === "category"
                  ? { categoryId: drilldown.category.id }
                  : {}),
                dateRange: { from: dateRange.start, to: dateRange.end },
              }
            : {}
        }
        title={drilldown ? budgetDrilldownTitle(drilldown) : ""}
        subtitle={
          drilldown
            ? `${formatRangeLabel(dateRange, "month")} · ${drilldownTransactions.length} transaction${
                drilldownTransactions.length === 1 ? "" : "s"
              }`
            : undefined
        }
      />
    </div>
  );
}
