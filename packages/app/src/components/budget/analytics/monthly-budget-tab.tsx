import { useEffect, useMemo, useRef, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  formatMoney,
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
import { buildBudgetView, type BudgetRow } from "./monthly-budget-rows";
import { BudgetBar, BudgetBarLegend } from "./budget-bar";
import { BudgetNoHistoryNote } from "./budget-no-history-note";
import { TransactionsModal } from "@/components/budget/transactions-modal";
import { TransactionsDrilldownLink } from "@/components/budget/transactions-drilldown-link";
import { formatRangeLabel } from "./format-range";
import {
  budgetDrilldownTitle,
  eligibleBudgetCategoryIds,
  filterForBudgetDrilldown,
  type MonthlyBudgetDrilldown,
} from "./monthly-budget-drilldown";

// ── KPI strip ────

interface KPICard {
  label: string;
  /** Pre-formatted display value (money, a count, etc.). */
  display: string;
  tone?: "default" | "income" | "expense";
  /** When set, the value renders as a drilldown link that opens the
   *  transactions browser for whatever scope this card represents. */
  onClick?: () => void;
}

function KpiStrip({ cards }: { cards: KPICard[] }) {
  return (
    <div className="grid grid-cols-3 gap-3">
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
                  {c.display}
                </TransactionsDrilldownLink>
              </div>
            ) : (
              <div className={valueClass}>{c.display}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Inline assigned input ────

interface AssignedInputProps {
  category: Category;
  row: BudgetRow;
}

/** Editable monthly target. Three resting states, all click-to-edit into the
 *  same `Editor`:
 *   - explicit budget   → the assigned amount.
 *   - implicit target   → the auto-derived amount + an "auto" tag, so the user
 *                         sees Capy's inferred number and can override it.
 *   - untargeted        → a quiet "set" affordance (no budget, no history).
 *  Empty input commits as `null` (back to auto/untargeted); `0` commits as an
 *  explicit zero target. Esc cancels, Enter or blur commits. */
function AssignedInput({ category, row }: AssignedInputProps) {
  // When not editing, the displayed value is derived directly from the props.
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

  let display: React.ReactNode;
  let ariaLabel: string;
  if (row.assigned !== null) {
    display = <span className="tabular-nums">{formatMoney(row.assigned)}</span>;
    ariaLabel = `Edit budget for ${category.name}`;
  } else if (row.isImplicit) {
    // AUTO is a prefix label pinned left while the amount stays pegged to the
    // column's right edge, so auto targets line up with explicit-budget rows.
    display = (
      <span className="flex w-full items-center justify-between gap-1.5">
        <span className="rounded-sm bg-muted px-1 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">
          auto
        </span>
        <span className="tabular-nums text-muted-foreground">
          {formatMoney(row.implicitTarget!)}
        </span>
      </span>
    );
    ariaLabel = `Set a budget for ${category.name} (currently auto: ${formatMoney(row.implicitTarget!)})`;
  } else {
    display = <span className="text-muted-foreground/60 italic">set</span>;
    ariaLabel = `Set a budget for ${category.name}`;
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="text-right text-sm w-full rounded px-2 py-1 hover:bg-accent transition-colors"
      aria-label={ariaLabel}
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
  row: BudgetRow;
  onDrilldown: (category: Category) => void;
}

function CategoryRow({ category, row, onDrilldown }: CategoryRowProps) {
  const { spent, effectiveTarget } = row;
  const targeted = effectiveTarget !== null;
  const hasSpent = spent > 0;
  // Remaining only exists when there's a target to count down from. Over-spend
  // renders as a signed negative ("-$X") in the expense token — the minus sign
  // carries the meaning, so it reads without relying on color alone.
  const remaining = targeted ? effectiveTarget - spent : null;
  const over = remaining !== null && remaining < 0;

  return (
    <div
      className={`grid grid-cols-[minmax(0,1.4fr)_140px_120px_minmax(160px,2fr)_120px] gap-3 items-center px-3 py-2 rounded-md hover:bg-accent/40 transition-colors ${
        targeted ? "" : "opacity-70"
      }`}
    >
      {/* Name + dot — brand dot when Capy is tracking the category (explicit
       *  or implicit target), muted when there's no basis to track against. */}
      <div className="flex items-center gap-2 min-w-0">
        <span
          className="h-2 w-2 rounded-full shrink-0"
          style={{ backgroundColor: targeted ? "var(--brand)" : "var(--muted-foreground)" }}
        />
        <span className="text-sm truncate">{category.name}</span>
      </div>

      {/* Assigned / target (editable) */}
      <AssignedInput category={category} row={row} />

      {/* Spent — targeted rows always show the number (incl. $0.00).
       *  Untargeted rows show their spend if any, em-dash otherwise.
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
          {targeted ? (
            formatMoney(spent)
          ) : (
            <span className="text-muted-foreground/50">—</span>
          )}
        </span>
      )}

      {/* Zoned bar */}
      <div>
        <BudgetBar row={row} />
      </div>

      {/* Remaining — signed, so an overspend reads "-$X" in the expense token. */}
      <span
        className={`text-right text-sm tabular-nums ${
          over ? "text-amount-expense" : "text-foreground"
        }`}
      >
        {remaining === null ? (
          <span className="text-muted-foreground/50">—</span>
        ) : (
          formatMoney(remaining)
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
    <div className="sticky top-0 z-10 bg-background border-b grid grid-cols-[minmax(0,1.4fr)_140px_120px_minmax(160px,2fr)_120px] gap-3 items-center px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
      <span>Category</span>
      <span className="text-right">Target</span>
      <span className="text-right">Spent</span>
      <span /> {/* bar column intentionally unlabelled */}
      <span className="text-right">Remaining</span>
    </div>
  );
}

// ── Group section ────

interface GroupSectionProps {
  group: CategoryGroup;
  categories: Category[];
  rowByCategory: Map<string, BudgetRow>;
  hideUntargeted: boolean;
  onDrilldown: (category: Category) => void;
}

function GroupSection({
  group,
  categories,
  rowByCategory,
  hideUntargeted,
  onDrilldown,
}: GroupSectionProps) {
  const entries = categories.map((c) => ({
    category: c,
    row: rowByCategory.get(c.id),
  }));

  // An untargeted row with spend still says something ("Other Spending"), so
  // the filter only hides untargeted rows that are also empty — unless the
  // user explicitly asks to hide all untargeted, which collapses the noise to
  // the rows Capy is actually tracking.
  const visible = hideUntargeted
    ? entries.filter((e) => e.row && e.row.effectiveTarget !== null)
    : entries;

  if (visible.length === 0) return null;

  const totalCount = categories.length;
  const targetedCount = entries.reduce(
    (n, e) => n + (e.row && e.row.effectiveTarget !== null ? 1 : 0),
    0,
  );

  return (
    <div className="space-y-0.5">
      {/* Group header — title only, full width, no per-group subtotals. */}
      <div className="px-3 pt-3 pb-1.5 border-b">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          {group}
          {targetedCount < totalCount && (
            <span className="ml-2 text-xs font-normal normal-case tracking-normal text-muted-foreground/60">
              {targetedCount}/{totalCount} tracked
            </span>
          )}
        </h3>
      </div>

      {/* Rows */}
      {visible.map(
        (e) =>
          e.row && (
            <CategoryRow
              key={e.category.id}
              category={e.category}
              row={e.row}
              onDrilldown={onDrilldown}
            />
          ),
      )}
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
  const [hideUntargeted, setHideUntargeted] = useState(false);
  const [drilldown, setDrilldown] = useState<MonthlyBudgetDrilldown | null>(null);

  const view = useMemo(
    () => buildBudgetView(transactions, categories, dateRange),
    [transactions, categories, dateRange],
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

  // No prior-month spend anywhere → every implicit target is null. The tab
  // frames this as "targets are forming" rather than a wall of empty bars.
  const noHistory = view.monthsOfData === 0;

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
            display: formatMoney(view.totalSpent),
            tone: "expense",
            onClick:
              view.totalSpent > 0 ? () => setDrilldown({ kind: "all" }) : undefined,
          },
          {
            label: "Tracking toward",
            display: formatMoney(view.totalTargeted),
          },
          {
            label: "Over budget",
            display: String(view.overCount),
            tone: view.overCount > 0 ? "expense" : "default",
          },
        ]}
      />

      {/* The filter only makes sense once some rows are targeted and others
       *  aren't — otherwise hiding the untargeted ones empties the table or
       *  does nothing. */}
      {hasTargetedRows && targetedCount < view.rows.length && (
        <label className="flex w-fit items-center gap-2 text-sm cursor-pointer select-none">
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
      )}

      {/* Empty state */}
      {!hasCategories ? (
        <p className="text-sm text-muted-foreground py-12 text-center">
          No categories to budget. Add categories to start tracking.
        </p>
      ) : (
        <div className="space-y-3">
          {noHistory && <BudgetNoHistoryNote />}

          {/* Legend keys the history pins — show it once at least one row
           *  draws a real bar. With nothing targeted yet the bars are dashed
           *  placeholders with no pins, so it would explain nothing. */}
          {hasTargetedRows && (
            <div className="px-3">
              <BudgetBarLegend />
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
