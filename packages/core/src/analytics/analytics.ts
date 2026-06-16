import type { Transaction, Category, Account, BudgetBasis } from "../entities/types";

export interface DateRange {
  start: Date;
  end: Date;
}

export interface CategoryBreakdown {
  categoryId: string;
  categoryName: string;
  group: string;
  total: number; // absolute cents (always positive for display)
  count: number;
  percentage: number; // 0-100
}

export interface NetWorthPoint {
  date: string; // ISO date string (last day of the labeled month)
  netWorth: number; // cents
  byAccount: Record<string, number>; // accountId → balance at that point
}

/** Extend the range's end so it spans at least `minMonths` calendar months. */
export function ensureMinMonths(range: DateRange, minMonths: number): DateRange {
  const months = (range.end.getFullYear() - range.start.getFullYear()) * 12
    + (range.end.getMonth() - range.start.getMonth());
  if (months >= minMonths) return range;
  return {
    start: range.start,
    end: new Date(range.start.getFullYear(), range.start.getMonth() + minMonths, 1),
  };
}

/** Filter transactions whose datetime falls within [start, end). */
export function filterTransactionsByDateRange(
  transactions: Transaction[],
  range: DateRange,
): Transaction[] {
  const startMs = range.start.getTime();
  const endMs = range.end.getTime();
  return transactions.filter((t) => {
    const ms = new Date(t.datetime).getTime();
    return ms >= startMs && ms < endMs;
  });
}

/** Group expenses by category, sorted by total descending. Excludes transfers. */
export function getSpendingByCategory(
  transactions: Transaction[],
  categories: Category[],
): CategoryBreakdown[] {
  return breakdownByCategory(
    transactions.filter((t) => t.type === "expense"),
    categories,
  );
}

/** Group income by category, sorted by total descending. Excludes transfers. */
export function getIncomeByCategory(
  transactions: Transaction[],
  categories: Category[],
): CategoryBreakdown[] {
  return breakdownByCategory(
    transactions.filter((t) => t.type === "income"),
    categories,
  );
}

function breakdownByCategory(
  transactions: Transaction[],
  categories: Category[],
): CategoryBreakdown[] {
  const catMap = new Map(categories.map((c) => [c.id, c]));

  const groups = new Map<string, { total: number; count: number }>();
  for (const t of transactions) {
    const key = t.categoryId || "__uncategorized__";
    const entry = groups.get(key) ?? { total: 0, count: 0 };
    entry.total += Math.abs(t.amount);
    entry.count += 1;
    groups.set(key, entry);
  }

  const grandTotal = [...groups.values()].reduce((s, g) => s + g.total, 0);

  const result: CategoryBreakdown[] = [];
  for (const [key, { total, count }] of groups) {
    const cat = key === "__uncategorized__" ? undefined : catMap.get(key);
    result.push({
      categoryId: key === "__uncategorized__" ? "" : key,
      categoryName: cat?.name ?? "Uncategorized",
      group: cat?.group ?? "",
      total,
      count,
      percentage: grandTotal > 0 ? (total / grandTotal) * 100 : 0,
    });
  }

  return result.sort((a, b) => b.total - a.total);
}

/** Net worth at the end of each month within the range: a point labeled month M
 *  is net worth as of the last day of M (it reflects every transaction through
 *  that month's end). Single-pass O(transactions log transactions + points).
 *
 *  Archived accounts ARE counted: archiving requires a zero derived balance, so an
 *  archived account contributes $0 to the latest point but correctly restores the
 *  running balance at past points (e.g. a credit card that ran negative in 2019
 *  before being paid off and closed). Only `excludeFromNetWorth` accounts — which
 *  may hold a non-zero balance and are never part of net worth — are dropped. */
export function getNetWorthOverTime(
  accounts: Account[],
  transactions: Transaction[],
  range: DateRange,
): NetWorthPoint[] {
  const activeAccountIds = new Set(
    accounts
      .filter((a) => !a.excludeFromNetWorth)
      .map((a) => a.id),
  );

  // Sort transactions by datetime once
  const sorted = [...transactions].sort(
    (a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime(),
  );

  // Pre-compute timestamps to avoid repeated Date construction
  const txTimestamps = sorted.map((t) => new Date(t.datetime).getTime());

  // Single pass: cumulative balance walk, emitting one point per month-end.
  const balances: Record<string, number> = {};
  for (const id of activeAccountIds) {
    balances[id] = 0;
  }

  let txIdx = 0;
  const points: NetWorthPoint[] = [];

  // First month to emit: the month containing/after range.start (matches the
  // prior behavior — a start aligned to first-of-month yields that month).
  const cursor = new Date(range.start.getFullYear(), range.start.getMonth(), 1);
  if (cursor < range.start) {
    cursor.setMonth(cursor.getMonth() + 1);
  }
  const endMs = range.end.getTime();

  while (cursor.getTime() < endMs) {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const firstOfNextMonth = new Date(year, month + 1, 1).getTime();
    // Exclusive upper bound for the cumulative walk: include the whole month,
    // but never reach past the range's end (a partial current month stops there).
    const threshold = Math.min(firstOfNextMonth, endMs);

    while (txIdx < sorted.length && txTimestamps[txIdx] < threshold) {
      const t = sorted[txIdx];
      if (activeAccountIds.has(t.accountId)) {
        balances[t.accountId] = (balances[t.accountId] ?? 0) + t.amount;
      }
      txIdx++;
    }

    // Display date = last day of M, clamped to range.end. The clamp keeps a
    // partial current month honest; because we only enter M when its first day
    // is < range.end, the clamped date always still falls within M, so the UI
    // label resolves to M.
    const lastDayOfMonth = new Date(year, month + 1, 0).getTime();
    const displayMs = Math.min(lastDayOfMonth, endMs);

    const byAccount: Record<string, number> = { ...balances };
    points.push({
      date: new Date(displayMs).toISOString(),
      netWorth: Object.values(byAccount).reduce((s, v) => s + v, 0),
      byAccount,
    });

    cursor.setMonth(month + 1);
  }

  return points;
}

/** Sum income and expenses separately. Excludes transfers. */
export function getPeriodSummary(
  transactions: Transaction[],
): { totalIncome: number; totalExpenses: number; net: number } {
  let totalIncome = 0;
  let totalExpenses = 0;

  for (const t of transactions) {
    if (t.type === "income") totalIncome += t.amount;
    else if (t.type === "expense") totalExpenses += t.amount;
    // transfers excluded
  }

  return { totalIncome, totalExpenses, net: totalIncome + totalExpenses };
}

// ── Cash Flow ─────

export interface CashFlowPoint {
  date: string; // ISO date string (first of month)
  month: string; // display label, e.g. "Apr 2026"
  income: number; // positive cents
  expenses: number; // positive cents (absolute value)
  net: number; // cents (positive = surplus, negative = deficit)
}

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Monthly income vs expenses within the range. Excludes transfers. */
export function getCashFlow(
  transactions: Transaction[],
  range: DateRange,
): CashFlowPoint[] {
  const startMs = range.start.getTime();
  const endMs = range.end.getTime();

  const buckets = new Map<string, { income: number; expenses: number }>();

  for (const t of transactions) {
    if (t.type === "transfer") continue;
    const ms = new Date(t.datetime).getTime();
    if (ms < startMs || ms >= endMs) continue;

    const d = new Date(t.datetime);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const bucket = buckets.get(key) ?? { income: 0, expenses: 0 };

    if (t.type === "income") {
      bucket.income += t.amount;
    } else if (t.type === "expense") {
      bucket.expenses += Math.abs(t.amount);
    }

    buckets.set(key, bucket);
  }

  const points: CashFlowPoint[] = [];
  const cursor = new Date(range.start.getFullYear(), range.start.getMonth(), 1);
  while (cursor < range.end) {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const key = `${year}-${String(month + 1).padStart(2, "0")}`;
    const bucket = buckets.get(key) ?? { income: 0, expenses: 0 };

    points.push({
      date: new Date(year, month, 1).toISOString(),
      month: `${MONTH_LABELS[month]} ${year}`,
      income: bucket.income,
      expenses: bucket.expenses,
      net: bucket.income - bucket.expenses,
    });

    cursor.setMonth(month + 1);
  }

  return points;
}

// ── Top Merchants ─────

export interface MerchantSpending {
  merchant: string;
  total: number; // absolute cents
  count: number;
  percentage: number; // of total spending
  /** True iff this row aggregates transactions whose `merchant` is empty
   *  or whitespace-only. Display name is "Unknown" — but that name is
   *  ambiguous with a legitimate merchant literally named "Unknown", so
   *  consumers that need to route by identity (drilldowns, filters)
   *  should branch on this flag rather than on the display string. */
  isUnknown: boolean;
}

/** Synthetic group key for empty/whitespace-only merchant. Distinct from
 *  any normalized merchant name (which is lowercased and can never start
 *  with `__`). */
const UNKNOWN_KEY = "__unknown__";

/** Top merchants by spending amount. Expenses only, excludes transfers. */
export function getTopMerchants(
  transactions: Transaction[],
  limit: number = 15,
): MerchantSpending[] {
  const expenses = transactions.filter((t) => t.type === "expense");

  // Group by normalized merchant name (lowercase trimmed), keep first-seen original case
  const groups = new Map<string, { displayName: string; total: number; count: number }>();

  for (const t of expenses) {
    const raw = t.merchant.trim();
    const key = raw === "" ? UNKNOWN_KEY : raw.toLowerCase();
    const entry = groups.get(key) ?? { displayName: raw === "" ? "Unknown" : raw, total: 0, count: 0 };
    entry.total += Math.abs(t.amount);
    entry.count += 1;
    groups.set(key, entry);
  }

  const grandTotal = [...groups.values()].reduce((s, g) => s + g.total, 0);

  const result: MerchantSpending[] = [];
  for (const [key, { displayName, total, count }] of groups) {
    result.push({
      merchant: displayName,
      total,
      count,
      percentage: grandTotal > 0 ? (total / grandTotal) * 100 : 0,
      isUnknown: key === UNKNOWN_KEY,
    });
  }

  result.sort((a, b) => b.total - a.total);
  return result.slice(0, limit);
}

// ── Category Trends ─────

export interface TrendPoint {
  date: string;    // ISO date string (period start: first of month or Monday of week)
  month: string;   // display label, e.g. "Apr 2026" or "Jan 6"
  byCategory: Record<string, number>;  // categoryId → absolute cents
}

export interface TrendSeries {
  categoryId: string;
  categoryName: string;
  total: number;  // total across all periods (for ranking)
}

export interface CategoryTrendsResult {
  /** Chronologically sorted buckets (monthly or weekly depending on granularity). */
  points: TrendPoint[];
  /** In `categoryIds` mode: the requested categories, deduped, in caller order
   *  (unknown ids silently dropped). In `limit` mode: top-N categories sorted by total desc. */
  series: TrendSeries[];
}

function getWeekStart(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay(); // 0=Sun
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return d;
}

/** Calendar-month bucket key (`YYYY-MM`) for a date. The canonical month
 *  bucketing used across analytics — keep producers (trends, historical
 *  stats) on this single helper so their buckets line up. */
function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** Spending per category over a date range, bucketed monthly or weekly. Excludes transfers.
 *
 * Two selection modes:
 *  - `categoryIds` (explicit): include exactly these categories, in the order given,
 *    deduplicated. Unknown ids (not in `categories` and not the `""` Uncategorized
 *    pseudo-id) are silently dropped to avoid misleading "Uncategorized"-labelled
 *    series. Passing an empty array short-circuits to an empty result.
 *    Use empty string `""` to refer to the synthetic Uncategorized bucket.
 *  - `limit` (default 8): pick top-N categories by total in the range, sorted desc.
 *
 * `categoryIds` takes precedence over `limit` when provided.
 */
export function getCategoryTrends(
  transactions: Transaction[],
  categories: Category[],
  range: DateRange,
  options?: { type?: "expense" | "income"; limit?: number; categoryIds?: string[]; granularity?: "month" | "week" },
): CategoryTrendsResult {
  const type = options?.type ?? "expense";
  const limit = options?.limit ?? 8;
  const explicitIds = options?.categoryIds;
  const granularity = options?.granularity ?? "month";

  // Empty explicit list = no series requested. Nothing to compute.
  if (explicitIds && explicitIds.length === 0) {
    return { points: [], series: [] };
  }

  const catMap = new Map(categories.map((c) => [c.id, c]));

  const startMs = range.start.getTime();
  const endMs = range.end.getTime();

  // bucketKey → categoryId → absolute cents
  const buckets = new Map<string, Map<string, number>>();
  // categoryId → total across all periods
  const categoryTotals = new Map<string, number>();

  for (const t of transactions) {
    if (t.type !== type) continue;
    const ms = new Date(t.datetime).getTime();
    if (ms < startMs || ms >= endMs) continue;

    const d = new Date(t.datetime);
    let bucketKey: string;
    if (granularity === "week") {
      const ws = getWeekStart(d);
      bucketKey = `${ws.getFullYear()}-${String(ws.getMonth() + 1).padStart(2, "0")}-${String(ws.getDate()).padStart(2, "0")}`;
    } else {
      bucketKey = monthKey(d);
    }
    const catId = t.categoryId || "__uncategorized__";
    const amt = Math.abs(t.amount);

    if (!buckets.has(bucketKey)) buckets.set(bucketKey, new Map());
    const bucket = buckets.get(bucketKey)!;
    bucket.set(catId, (bucket.get(catId) ?? 0) + amt);

    categoryTotals.set(catId, (categoryTotals.get(catId) ?? 0) + amt);
  }

  // Pick which categories to surface.
  let selectedIds: string[];
  if (explicitIds) {
    // Normalize uncategorized pseudo-id, drop unknown ids, dedupe — preserve caller order.
    const seen = new Set<string>();
    selectedIds = [];
    for (const raw of explicitIds) {
      const id = raw === "" ? "__uncategorized__" : raw;
      if (id !== "__uncategorized__" && !catMap.has(id)) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      selectedIds.push(id);
    }
  } else {
    selectedIds = [...categoryTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id]) => id);
  }

  if (selectedIds.length === 0) {
    return { points: [], series: [] };
  }

  const series: TrendSeries[] = selectedIds.map((id) => {
    const cat = id === "__uncategorized__" ? undefined : catMap.get(id);
    return {
      categoryId: id === "__uncategorized__" ? "" : id,
      categoryName: cat?.name ?? "Uncategorized",
      total: categoryTotals.get(id) ?? 0,
    };
  });

  // Build chronologically sorted points covering every period in the range
  const points: TrendPoint[] = [];

  if (granularity === "week") {
    const cursor = getWeekStart(range.start);
    if (cursor < range.start) cursor.setDate(cursor.getDate() + 7);
    while (cursor < range.end) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
      const catBuckets = buckets.get(key);
      const byCategory: Record<string, number> = {};
      for (const id of selectedIds) {
        const extKey = id === "__uncategorized__" ? "" : id;
        byCategory[extKey] = catBuckets?.get(id) ?? 0;
      }
      points.push({
        date: new Date(cursor).toISOString(),
        month: `${MONTH_LABELS[cursor.getMonth()]} ${cursor.getDate()}`,
        byCategory,
      });
      cursor.setDate(cursor.getDate() + 7);
    }
  } else {
    const cursor = new Date(range.start.getFullYear(), range.start.getMonth(), 1);
    while (cursor < range.end) {
      const year = cursor.getFullYear();
      const month = cursor.getMonth();
      const catBuckets = buckets.get(monthKey(cursor));
      const byCategory: Record<string, number> = {};
      for (const id of selectedIds) {
        const extKey = id === "__uncategorized__" ? "" : id;
        byCategory[extKey] = catBuckets?.get(id) ?? 0;
      }
      points.push({
        date: new Date(year, month, 1).toISOString(),
        month: `${MONTH_LABELS[month]} ${year}`,
        byCategory,
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }

  return { points, series };
}

// ── Category Historical Stats ─────

/** The calendar months a basis selects, relative to a viewed month
 *  (first-of-month boundary). Returned newest-first as `YYYY-MM` keys.
 *
 *  - `trailing{3,6,12}` → the N full calendar months immediately before
 *    `viewedMonth`.
 *  - `sameMonthLastYear` → the single month exactly 12 months before
 *    `viewedMonth` (a one-element set). */
export function basisMonths(basis: BudgetBasis, viewedMonth: Date): string[] {
  const y = viewedMonth.getFullYear();
  const m = viewedMonth.getMonth();
  if (basis === "sameMonthLastYear") {
    return [monthKey(new Date(y, m - 12, 1))];
  }
  const n = basis === "trailing6" ? 6 : basis === "trailing12" ? 12 : 3;
  const keys: string[] = [];
  for (let i = 1; i <= n; i++) keys.push(monthKey(new Date(y, m - i, 1)));
  return keys;
}

/** Human label for a basis, resolved against the viewed month. The trailing
 *  bases are fixed strings; `sameMonthLastYear` resolves to the actual month
 *  it points at (e.g. "Dec 2024" when viewing Dec 2025). */
export function basisLabel(basis: BudgetBasis, viewedMonth: Date): string {
  switch (basis) {
    case "trailing3":
      return "3-mo avg";
    case "trailing6":
      return "6-mo avg";
    case "trailing12":
      return "12-mo avg";
    case "sameMonthLastYear": {
      const d = new Date(viewedMonth.getFullYear() - 1, viewedMonth.getMonth(), 1);
      return `${MONTH_LABELS[d.getMonth()]} ${d.getFullYear()}`;
    }
  }
}

/** Mean over the active (non-zero) months only — the divisor is the count of
 *  months that actually had spend, so an inactive ($0) month neither adds to
 *  the sum nor dilutes the average. `0` when no month was active. Rounded to
 *  integer cents. */
function averageActiveMonths(spends: number[]): number {
  const active = spends.filter((v) => v > 0);
  if (active.length === 0) return 0;
  return Math.round(active.reduce((s, v) => s + v, 0) / active.length);
}

export interface CategoryHistoricalStats {
  categoryId: string;
  /** Expense spend (abs cents) in the full calendar month immediately
   *  before the viewed month. `0` if that month had no spend. */
  lastMonth: number;
  /** Average active-month expense spend (abs cents) over the month-set the
   *  configured `BudgetBasis` selects — the divisor is the count of those
   *  months with non-zero spend, so an inactive month doesn't drag the
   *  average down. `0` when none of the basis's months had spend. */
  reference: number;
  /** Implicit monthly target: `max(lastMonth, reference)`, or `null` when
   *  that max is 0 — a category with no spend in the trailing window has no
   *  basis for a target. The UI treats a null target as neutral, never over,
   *  which keeps dormant and brand-new categories calm on first open. */
  implicitTarget: number | null;
}

export interface CategoryHistoricalStatsResult {
  /** One entry per eligible (non-archived, non-Income) category. */
  byCategory: Map<string, CategoryHistoricalStats>;
}

/** Per-category historical spend stats, computed relative to a viewed month.
 *
 *  The viewed month is `range.start` (a first-of-month boundary, exactly as
 *  `getMonthlyBudgetSummary` receives it); history is the full calendar
 *  months strictly *before* it. Viewing a past month therefore looks back
 *  from that month, never from today.
 *
 *  `basis` selects which months feed the `reference` average — see
 *  `basisMonths`. `lastMonth` is always the single month immediately before
 *  the viewed one, independent of `basis`. Defaults to `"trailing3"`, which
 *  reproduces the original 3-month behaviour exactly.
 *
 *  Same filtering as `getMonthlyBudgetSummary`: `expense` type only, Income
 *  group and archived categories excluded, `Math.abs(amount)`, uncategorized
 *  skipped. Money is integer cents throughout. */
export function getCategoryHistoricalStats(
  transactions: Transaction[],
  categories: Category[],
  range: DateRange,
  basis: BudgetBasis = "trailing3",
): CategoryHistoricalStatsResult {
  const eligible = categories.filter((c) => !c.archived && c.group !== "Income");
  const eligibleIds = new Set(eligible.map((c) => c.id));

  const viewed = new Date(range.start.getFullYear(), range.start.getMonth(), 1);
  const referenceKeys = basisMonths(basis, viewed);
  // `lastMonth` is basis-independent: always the month right before viewed.
  const lastKey = monthKey(new Date(viewed.getFullYear(), viewed.getMonth() - 1, 1));
  const viewedMs = viewed.getTime();

  // categoryId → monthKey → abs cents, for eligible categorized expenses
  // strictly before the viewed month.
  const byCatMonth = new Map<string, Map<string, number>>();
  for (const t of transactions) {
    if (t.type !== "expense") continue;
    if (!t.categoryId || !eligibleIds.has(t.categoryId)) continue;
    const d = new Date(t.datetime);
    if (d.getTime() >= viewedMs) continue; // exclude the viewed month and everything after
    const key = monthKey(d);
    let months = byCatMonth.get(t.categoryId);
    if (!months) {
      months = new Map();
      byCatMonth.set(t.categoryId, months);
    }
    months.set(key, (months.get(key) ?? 0) + Math.abs(t.amount));
  }

  const byCategory = new Map<string, CategoryHistoricalStats>();
  for (const c of eligible) {
    const months = byCatMonth.get(c.id);
    const lastMonth = months?.get(lastKey) ?? 0;
    const reference = averageActiveMonths(referenceKeys.map((k) => months?.get(k) ?? 0));
    // A category with no spend in the trailing window has no basis for a
    // target — `max` is 0, so `implicitTarget` is null. This folds the
    // dormant, brand-new, and no-history-at-all cases into one neutral
    // "untargeted" state rather than a $0 target that turns red on the
    // first dollar spent.
    const target = Math.max(lastMonth, reference);
    byCategory.set(c.id, {
      categoryId: c.id,
      lastMonth,
      reference,
      implicitTarget: target === 0 ? null : target,
    });
  }

  return { byCategory };
}

// ── Monthly Budget ─────

export interface CategoryMonthSummary {
  categoryId: string;
  /** Monthly target in cents. `null` = untracked. */
  assigned: number | null;
  /** Absolute cents spent in the month for this category. */
  spent: number;
}

export interface MonthlyBudgetSummary {
  /** Per-category aggregate for the month. One entry per non-archived
   *  expense-side category (Income excluded). */
  rows: CategoryMonthSummary[];
}

/** Aggregate transactions for the Monthly Budget tab.
 *
 *  Income categories are excluded entirely — budgeting earned income vs.
 *  expected income is a different mental model than tracking spend against
 *  a monthly target.
 *
 *  Spend is summed from `expense` transactions only (transfers and income
 *  are ignored). The amount is taken as `Math.abs(t.amount)` so the result
 *  is always non-negative cents.
 *
 *  Archived categories are dropped — they don't show on the tab. */
export function getMonthlyBudgetSummary(
  transactions: Transaction[],
  categories: Category[],
  range: DateRange,
): MonthlyBudgetSummary {
  const startMs = range.start.getTime();
  const endMs = range.end.getTime();

  // categoryId -> spent cents in range
  const spentByCategory = new Map<string, number>();
  for (const t of transactions) {
    if (t.type !== "expense") continue;
    if (!t.categoryId) continue; // uncategorized lives outside the budget
    const ms = new Date(t.datetime).getTime();
    if (ms < startMs || ms >= endMs) continue;
    spentByCategory.set(
      t.categoryId,
      (spentByCategory.get(t.categoryId) ?? 0) + Math.abs(t.amount),
    );
  }

  const eligible = categories.filter((c) => !c.archived && c.group !== "Income");

  const rows: CategoryMonthSummary[] = eligible.map((c) => ({
    categoryId: c.id,
    assigned: c.assigned,
    spent: spentByCategory.get(c.id) ?? 0,
  }));

  return { rows };
}
