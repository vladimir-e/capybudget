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
  CategoryGroupSubtotal,
  DateRange,
  Transaction,
} from "@capybudget/core";
import { useSetCategoryAssigned } from "@/hooks/use-category-mutations";
import { toast } from "sonner";
import { progressState } from "./monthly-budget-progress";

// ── Color palette (matches spec: well-under / close / over) ────
//
// Tailwind has bg-amount-income (green) and bg-amount-expense (red) wired
// to theme tokens. There's no "gold/warning" token, so we use an oklch
// literal in the gold band — visually consistent across themes because OKLCh
// keeps lightness/chroma stable.
const PROGRESS_COLOR = {
  ok: "var(--amount-income)",
  warn: "oklch(0.70 0.14 80)",
  over: "var(--amount-expense)",
} as const;

// ── KPI strip ────

interface KPICard {
  label: string;
  value: number;
  tone?: "default" | "income" | "expense";
}

function KpiStrip({ cards }: { cards: KPICard[] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {cards.map((c) => (
        <div key={c.label} className="rounded-lg border bg-card px-4 py-3">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {c.label}
          </div>
          <div
            className={`text-xl font-bold tabular-nums mt-1 ${
              c.tone === "income"
                ? "text-amount-income"
                : c.tone === "expense"
                  ? "text-amount-expense"
                  : "text-foreground"
            }`}
          >
            {formatMoney(c.value)}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Progress bar ────

function ProgressBar({ spent, assigned }: { spent: number; assigned: number }) {
  const state = progressState(spent, assigned)!;
  const ratio = assigned === 0 ? (spent > 0 ? 1 : 0) : spent / assigned;

  // Cap the filled bar at 100%; overshoot gets a separate tail beyond it.
  const filled = Math.min(ratio, 1) * 100;
  const overshoot = Math.max(ratio - 1, 0);
  // Compress overshoot logarithmically so a 5x overrun doesn't dominate the row.
  const overshootDisplay = overshoot > 0 ? Math.min(Math.log2(1 + overshoot) * 25, 60) : 0;

  return (
    <div className="flex items-center gap-1 h-2">
      <div className="relative h-2 flex-1 rounded-full bg-muted overflow-hidden">
        <div
          className="absolute left-0 top-0 h-full rounded-full transition-all"
          style={{
            width: `${filled}%`,
            backgroundColor: PROGRESS_COLOR[state],
          }}
        />
      </div>
      {overshootDisplay > 0 && (
        <div
          className="h-2 rounded-full"
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
}

function CategoryRow({ category, spent }: CategoryRowProps) {
  const tracked = category.assigned !== null;
  const remaining = tracked ? category.assigned! - spent : null;
  const state = progressState(spent, category.assigned);

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
       *  the per-category counterpart to the "Other Spending" KPI. */}
      <span className="text-right text-sm tabular-nums">
        {tracked || spent > 0 ? (
          formatMoney(spent)
        ) : (
          <span className="text-muted-foreground/50">—</span>
        )}
      </span>

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

// ── Group section ────

interface GroupSectionProps {
  group: CategoryGroup;
  categories: Category[];
  spentByCategory: Map<string, number>;
  subtotal: CategoryGroupSubtotal;
  showOnlyTracked: boolean;
}

function GroupSection({
  group,
  categories,
  spentByCategory,
  subtotal,
  showOnlyTracked,
}: GroupSectionProps) {
  const visible = showOnlyTracked
    ? categories.filter((c) => c.assigned !== null)
    : categories;

  if (visible.length === 0) return null;

  const subtotalRemaining = subtotal.assigned - subtotal.spent;

  return (
    <div className="space-y-0.5">
      {/* Group header with subtotals */}
      <div className="grid grid-cols-[minmax(0,1.4fr)_120px_120px_minmax(160px,2fr)_120px] gap-3 items-center px-3 pt-3 pb-1.5 border-b">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          {group}
          {subtotal.trackedCount < subtotal.totalCount && (
            <span className="ml-2 text-xs font-normal normal-case tracking-normal text-muted-foreground/60">
              {subtotal.trackedCount}/{subtotal.totalCount} tracked
            </span>
          )}
        </h3>
        <span className="text-right text-xs font-medium tabular-nums text-muted-foreground">
          {subtotal.trackedCount > 0 ? formatMoney(subtotal.assigned) : ""}
        </span>
        <span className="text-right text-xs font-medium tabular-nums text-muted-foreground">
          {subtotal.trackedCount > 0 ? formatMoney(subtotal.spent) : ""}
        </span>
        <span /> {/* progress column intentionally empty in subtotal row */}
        <span
          className={`text-right text-xs font-medium tabular-nums ${
            subtotal.trackedCount > 0 && subtotalRemaining < 0
              ? "text-amount-expense"
              : "text-muted-foreground"
          }`}
        >
          {subtotal.trackedCount > 0 ? formatMoney(subtotalRemaining) : ""}
        </span>
      </div>

      {/* Rows */}
      {visible.map((c) => (
        <CategoryRow
          key={c.id}
          category={c}
          spent={spentByCategory.get(c.id) ?? 0}
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

  const subtotalByGroup = useMemo(
    () => new Map(summary.groupSubtotals.map((g) => [g.group, g])),
    [summary.groupSubtotals],
  );

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

  return (
    <div className="space-y-5">
      {/* KPI strip */}
      <KpiStrip
        cards={[
          { label: "Assigned", value: summary.totalAssigned },
          { label: "Spent (tracked)", value: summary.totalSpentTracked, tone: "expense" },
          {
            label: "Remaining",
            value: remaining,
            tone: remaining < 0 ? "expense" : "income",
          },
          { label: "Other Spending", value: summary.totalOtherSpending },
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
        <div className="space-y-4">
          {orderedGroups.map((g) => {
            const cats = grouped.get(g) ?? [];
            const subtotal = subtotalByGroup.get(g) ?? {
              group: g,
              assigned: 0,
              spent: 0,
              trackedCount: 0,
              totalCount: cats.length,
            };
            return (
              <GroupSection
                key={g}
                group={g}
                categories={cats}
                spentByCategory={spentByCategory}
                subtotal={subtotal}
                showOnlyTracked={showOnlyTracked}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
