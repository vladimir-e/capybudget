import { useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  CATEGORY_GROUP_ORDER,
  formatMoney,
  formatMoneyCompact,
  getCategoryTrends,
} from "@capybudget/core";
import type { Category, DateRange, Transaction } from "@capybudget/core";
import { Checkbox } from "@/components/ui/checkbox";
import { ChartSwitcher } from "./chart-switcher";

// ── Constants ──

/** Number of categories pre-selected when the tab loads or viewMode flips. */
const DEFAULT_TOP_N = 5;

/** Color palette for the line chart. Slot assignment is by selected-order index,
 *  persisted across toggles within a session (see PickState.colorMap below). */
const CHART_LINE_COLORS = [
  "oklch(0.55 0.14 55)",   // amber
  "oklch(0.50 0.14 30)",   // terracotta
  "oklch(0.58 0.10 85)",   // golden
  "oklch(0.52 0.12 290)",  // plum
  "oklch(0.55 0.08 250)",  // slate blue
  "oklch(0.60 0.14 15)",   // coral
  "oklch(0.48 0.10 60)",   // dark amber
  "oklch(0.58 0.12 340)",  // rose
];

const UNCATEGORIZED_KEY = "__uncategorized__";

// ── Types ──

type ViewMode = "expense" | "income";

const VIEW_OPTIONS: Array<{ value: ViewMode; label: string }> = [
  { value: "expense", label: "Expenses" },
  { value: "income", label: "Income" },
];

interface CategoryRow {
  /** "" represents Uncategorized; we use a distinct internal key in selection state. */
  id: string;
  name: string;
  group: string;
  total: number;
}

interface CompareTabProps {
  transactions: Transaction[];
  categories: Category[];
  dateRange: DateRange;
}

// ── Tooltip ──

function CompareTooltipContent({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-background px-3 py-2 shadow-md space-y-1">
      <p className="text-sm font-medium">{label}</p>
      {payload.map((entry) => (
        <div key={entry.dataKey} className="flex items-center gap-2 text-sm">
          <span
            className="h-2 w-2 rounded-full shrink-0"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-muted-foreground">{entry.dataKey}</span>
          <span className="tabular-nums font-medium ml-auto">
            {formatMoney(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Helpers ──

/** Selection state uses a stable internal key so Uncategorized has a unique id. */
function toSelectionKey(id: string): string {
  return id === "" ? UNCATEGORIZED_KEY : id;
}

function fromSelectionKey(key: string): string {
  return key === UNCATEGORIZED_KEY ? "" : key;
}

/** Build category rows for the chosen type with totals computed in the current period. */
function buildCategoryRows(
  transactions: Transaction[],
  categories: Category[],
  dateRange: DateRange,
  type: ViewMode,
): CategoryRow[] {
  const startMs = dateRange.start.getTime();
  const endMs = dateRange.end.getTime();

  // categoryId → period total (uncategorized keyed as "")
  const totals = new Map<string, number>();
  for (const t of transactions) {
    if (t.type !== type) continue;
    const ms = new Date(t.datetime).getTime();
    if (ms < startMs || ms >= endMs) continue;
    const key = t.categoryId || "";
    totals.set(key, (totals.get(key) ?? 0) + Math.abs(t.amount));
  }

  // Active categories only (archived stay hidden by default).
  const active = categories.filter((c) => !c.archived);

  const rows: CategoryRow[] = active.map((c) => ({
    id: c.id,
    name: c.name,
    group: c.group,
    total: totals.get(c.id) ?? 0,
  }));

  // Add uncategorized row if any transactions of this type lack a category in range.
  const uncatTotal = totals.get("") ?? 0;
  if (uncatTotal > 0) {
    rows.push({ id: "", name: "Uncategorized", group: "Uncategorized", total: uncatTotal });
  }

  return rows;
}

/** Group rows by category group, ordered by CATEGORY_GROUP_ORDER then any custom groups. */
function groupRows(rows: CategoryRow[]): Array<{ group: string; rows: CategoryRow[] }> {
  const byGroup = new Map<string, CategoryRow[]>();
  for (const row of rows) {
    const list = byGroup.get(row.group) ?? [];
    list.push(row);
    byGroup.set(row.group, list);
  }

  // Order: canonical groups first, then any extras (custom groups, "Uncategorized") in insertion order.
  const ordered: string[] = [];
  for (const g of CATEGORY_GROUP_ORDER) {
    if (byGroup.has(g)) ordered.push(g);
  }
  for (const g of byGroup.keys()) {
    if (!ordered.includes(g)) ordered.push(g);
  }

  return ordered.map((g) => ({
    group: g,
    rows: (byGroup.get(g) ?? []).sort((a, b) => b.total - a.total),
  }));
}

/** Top-N keys for current rows, in descending-total order. Skips zero-spend rows
 *  so we never seed with flat-zero lines. */
function topByTotalKeys(rows: CategoryRow[], n: number): string[] {
  return [...rows]
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, n)
    .map((r) => toSelectionKey(r.id));
}

// ── State ──

/** Combined selection + sticky color-slot state. Kept as a single object so
 *  state transitions are atomic — selection and color assignment always update together. */
interface PickState {
  /** Selected category keys (UNCATEGORIZED_KEY for uncategorized). */
  selected: Set<string>;
  /** Stable color-slot map: once a key gets a slot, it keeps it across deselect/reselect. */
  colorMap: Map<string, number>;
  /** Next free slot to hand out. Wrapped at assignment with CHART_LINE_COLORS.length. */
  nextSlot: number;
}

const EMPTY_PICK: PickState = { selected: new Set(), colorMap: new Map(), nextSlot: 0 };

/** Add `keys` to the slot map in iteration order, skipping ones already present.
 *  `nextSlot` wraps modulo the palette length so long sessions stay bounded. */
function withSlotsFor(state: PickState, keys: Iterable<string>): PickState {
  let colorMap: Map<string, number> | null = null;
  let nextSlot = state.nextSlot;
  for (const key of keys) {
    if (state.colorMap.has(key)) continue;
    if (!colorMap) colorMap = new Map(state.colorMap);
    const slot = nextSlot % CHART_LINE_COLORS.length;
    colorMap.set(key, slot);
    nextSlot++;
  }
  if (!colorMap) return state;
  return { ...state, colorMap, nextSlot };
}

/** Build a fresh PickState seeded with top-N selection in display order. */
function seedPickState(rows: CategoryRow[]): PickState {
  const ordered = topByTotalKeys(rows, DEFAULT_TOP_N);
  return withSlotsFor({ ...EMPTY_PICK, selected: new Set(ordered) }, ordered);
}

// ── Main ──

/** Outer shell owns the viewMode toggle. The inner component is keyed on viewMode
 *  so flipping Expenses ↔ Income remounts and re-seeds selection from scratch — the
 *  React-idiomatic pattern for "reset state when a prop changes." Period navigation
 *  does NOT remount, which is the whole point of the Compare tab.
 *  See https://react.dev/learn/preserving-and-resetting-state#resetting-state-with-a-key */
export function CompareTab(props: CompareTabProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("expense");

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ChartSwitcher options={VIEW_OPTIONS} value={viewMode} onChange={setViewMode} />
      </div>
      <CompareTabBody key={viewMode} {...props} viewMode={viewMode} />
    </div>
  );
}

interface CompareTabBodyProps extends CompareTabProps {
  viewMode: ViewMode;
}

function CompareTabBody({ transactions, categories, dateRange, viewMode }: CompareTabBodyProps) {
  // Build category rows for current period + view mode.
  const rows = useMemo(
    () => buildCategoryRows(transactions, categories, dateRange, viewMode),
    [transactions, categories, dateRange, viewMode],
  );

  // Lazy initializer: seed from the rows visible at first mount of this body.
  // The `key={viewMode}` on the parent guarantees a fresh mount per view, so
  // this initializer fires exactly once per Expenses↔Income flip and never
  // re-runs on period navigation.
  const [pick, setPick] = useState<PickState>(() =>
    rows.length > 0 ? seedPickState(rows) : EMPTY_PICK,
  );

  // Toggle a single category. Color slots are sticky: once assigned, the slot persists
  // even if the user deselects then reselects within the session.
  function toggle(key: string) {
    setPick((prev) => {
      const selected = new Set(prev.selected);
      if (selected.has(key)) {
        selected.delete(key);
        return { ...prev, selected };
      }
      selected.add(key);
      return withSlotsFor({ ...prev, selected }, [key]);
    });
  }

  function selectAll() {
    // Walk rows in descending-total order to match the seeded default's color
    // assignment (post-clear → post-select-all should look like first mount).
    // Skip zero-spend rows: selecting them only adds flat-zero lines that
    // obscure the chart without conveying anything.
    const keys: string[] = [];
    for (const row of [...rows].sort((a, b) => b.total - a.total)) {
      if (row.total === 0) continue;
      keys.push(toSelectionKey(row.id));
    }
    setPick((prev) => withSlotsFor({ ...prev, selected: new Set(keys) }, keys));
  }

  function clearAll() {
    // Don't clear colorMap — keeps stable slots if the user re-selects.
    setPick((prev) => ({ ...prev, selected: new Set() }));
  }

  const selected = pick.selected;

  const grouped = useMemo(() => groupRows(rows), [rows]);

  // Build series data for the selected categories.
  // Note: getCategoryTrends buckets monthly, so the X-axis only has one point
  // per month within `dateRange`. Year, All Time, and (multi-month) custom
  // ranges are the periods that produce useful trend lines — see
  // allowedPeriods in analytics-view.tsx.
  const selectedIdsForCore = useMemo(
    () => [...selected].map(fromSelectionKey),
    [selected],
  );

  const seriesData = useMemo(
    () =>
      getCategoryTrends(transactions, categories, dateRange, {
        type: viewMode,
        categoryIds: selectedIdsForCore,
      }),
    [transactions, categories, dateRange, viewMode, selectedIdsForCore],
  );

  const periodHasData = rows.length > 0;
  const anySelected = selected.size > 0;

  // Map series → color slot, handling Uncategorized's empty-string id.
  const seriesWithColor = useMemo(() => {
    return seriesData.series.map((s) => {
      const key = toSelectionKey(s.categoryId);
      const slot = pick.colorMap.get(key) ?? 0;
      return {
        ...s,
        color: CHART_LINE_COLORS[slot % CHART_LINE_COLORS.length],
      };
    });
  }, [seriesData.series, pick.colorMap]);

  // Chart data shape: { month, [categoryName]: cents, ... }
  const chartData = useMemo(() => {
    const nameById = new Map(seriesData.series.map((s) => [s.categoryId, s.categoryName]));
    return seriesData.points.map((point) => {
      const row: Record<string, string | number> = { month: point.month };
      for (const [catId, amt] of Object.entries(point.byCategory)) {
        const name = nameById.get(catId) ?? "Uncategorized";
        row[name] = amt;
      }
      return row;
    });
  }, [seriesData]);

  if (!periodHasData) {
    return (
      <p className="text-sm text-muted-foreground py-12 text-center">
        No {viewMode === "expense" ? "expenses" : "income"} in this period
      </p>
    );
  }

  return (
    <div className="flex flex-col md:flex-row gap-6 items-start">
      {/* Category checklist */}
      <div className="w-full md:w-[30%] md:shrink-0 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground font-medium uppercase tracking-wide">
            Categories
          </span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={selectAll}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={clearAll}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Clear
            </button>
          </div>
        </div>

        <div className="space-y-3">
          {grouped.map(({ group, rows: groupRowsList }) => (
            <div key={group} className="space-y-1">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground/80 font-medium pb-0.5 border-b border-border/50">
                {group}
              </div>
              <ul className="space-y-0.5">
                {groupRowsList.map((row) => {
                  const key = toSelectionKey(row.id);
                  const isChecked = selected.has(key);
                  const slot = pick.colorMap.get(key);
                  const swatchColor =
                    isChecked && slot !== undefined
                      ? CHART_LINE_COLORS[slot % CHART_LINE_COLORS.length]
                      : "transparent";
                  // Zero-spend rows: dim and disable. They stay visible for
                  // orientation but can't be selected — flat-zero lines only
                  // clutter the chart.
                  const isZero = row.total === 0;
                  const noDataTip = `No ${viewMode === "expense" ? "expenses" : "income"} in this period`;
                  return (
                    <li key={key}>
                      <label
                        className={`grid grid-cols-[10px_16px_1fr_auto] items-center gap-2 py-1 px-1 rounded-sm transition-colors ${
                          isZero
                            ? "opacity-40 cursor-not-allowed"
                            : "cursor-pointer hover:bg-muted/40"
                        }`}
                        title={isZero ? noDataTip : undefined}
                      >
                        <span
                          className="h-2.5 w-2.5 rounded-full border border-border"
                          style={{
                            backgroundColor: swatchColor,
                            borderColor: isChecked ? "transparent" : undefined,
                          }}
                          aria-hidden
                        />
                        <Checkbox
                          checked={isChecked}
                          disabled={isZero}
                          onCheckedChange={() => toggle(key)}
                          aria-label={`Toggle ${row.name}`}
                        />
                        <span className="text-sm text-foreground truncate">
                          {row.name}
                        </span>
                        <span className="text-xs text-muted-foreground tabular-nums text-right">
                          {row.total > 0 ? formatMoney(row.total) : ""}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="flex-1 min-w-0 w-full">
        {!anySelected ? (
          <p className="text-sm text-muted-foreground py-24 text-center">
            Select categories to compare
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 12 }}
                className="text-muted-foreground"
              />
              <YAxis
                tickFormatter={(v: number) => formatMoneyCompact(v)}
                tick={{ fontSize: 12 }}
                className="text-muted-foreground"
                width={65}
              />
              <Tooltip content={<CompareTooltipContent />} />
              <Legend wrapperStyle={{ fontSize: "12px" }} />
              {seriesWithColor.map((s) => (
                <Line
                  key={s.categoryId || UNCATEGORIZED_KEY}
                  dataKey={s.categoryName}
                  type="monotone"
                  stroke={s.color}
                  strokeWidth={2}
                  dot={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
