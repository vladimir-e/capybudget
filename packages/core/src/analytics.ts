import type { Transaction, Category, Account } from "./types";

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
  date: string; // ISO date string (first of month)
  netWorth: number; // cents
  byAccount: Record<string, number>; // accountId → balance at that point
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

/** Calculate net worth at each month boundary within the range, plus the end date.
 *  Single-pass O(transactions log transactions + points) algorithm. */
export function getNetWorthOverTime(
  accounts: Account[],
  transactions: Transaction[],
  range: DateRange,
): NetWorthPoint[] {
  const activeAccountIds = new Set(
    accounts.filter((a) => !a.archived).map((a) => a.id),
  );

  // Sort transactions by datetime once
  const sorted = [...transactions].sort(
    (a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime(),
  );

  // Pre-compute timestamps to avoid repeated Date construction
  const txTimestamps = sorted.map((t) => new Date(t.datetime).getTime());

  // Build list of unique month boundaries within range
  const dates: Date[] = [];
  const cursor = new Date(range.start.getFullYear(), range.start.getMonth(), 1);
  if (cursor < range.start) {
    cursor.setMonth(cursor.getMonth() + 1);
  }
  while (cursor < range.end) {
    dates.push(new Date(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  // Include end date, deduplicated
  const lastDate = dates[dates.length - 1];
  if (!lastDate || range.end.getTime() !== lastDate.getTime()) {
    dates.push(new Date(range.end));
  }

  // Single pass: walk transactions and emit points at each boundary
  const balances: Record<string, number> = {};
  for (const id of activeAccountIds) {
    balances[id] = 0;
  }

  let txIdx = 0;
  const points: NetWorthPoint[] = [];

  for (const date of dates) {
    const dateMs = date.getTime();

    // Advance through transactions up to this boundary
    while (txIdx < sorted.length && txTimestamps[txIdx] < dateMs) {
      const t = sorted[txIdx];
      if (activeAccountIds.has(t.accountId)) {
        balances[t.accountId] = (balances[t.accountId] ?? 0) + t.amount;
      }
      txIdx++;
    }

    const byAccount: Record<string, number> = { ...balances };
    points.push({
      date: date.toISOString(),
      netWorth: Object.values(byAccount).reduce((s, v) => s + v, 0),
      byAccount,
    });
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
  for (const [key, { income, expenses }] of buckets) {
    const [yearStr, monthStr] = key.split("-");
    const year = Number(yearStr);
    const month = Number(monthStr) - 1; // 0-indexed
    const firstOfMonth = new Date(year, month, 1);

    points.push({
      date: firstOfMonth.toISOString(),
      month: `${MONTH_LABELS[month]} ${year}`,
      income,
      expenses,
      net: income - expenses,
    });
  }

  points.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  return points;
}

// ── Top Merchants ─────

export interface MerchantSpending {
  merchant: string;
  total: number; // absolute cents
  count: number;
  percentage: number; // of total spending
}

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
    const key = raw === "" ? "__unknown__" : raw.toLowerCase();
    const entry = groups.get(key) ?? { displayName: raw === "" ? "Unknown" : raw, total: 0, count: 0 };
    entry.total += Math.abs(t.amount);
    entry.count += 1;
    groups.set(key, entry);
  }

  const grandTotal = [...groups.values()].reduce((s, g) => s + g.total, 0);

  const result: MerchantSpending[] = [];
  for (const [, { displayName, total, count }] of groups) {
    result.push({
      merchant: displayName,
      total,
      count,
      percentage: grandTotal > 0 ? (total / grandTotal) * 100 : 0,
    });
  }

  result.sort((a, b) => b.total - a.total);
  return result.slice(0, limit);
}

// ── Category Trends ─────

export interface TrendPoint {
  date: string;    // ISO date string (first of month)
  month: string;   // display label, e.g. "Apr 2026"
  byCategory: Record<string, number>;  // categoryId → absolute cents
}

export interface TrendSeries {
  categoryId: string;
  categoryName: string;
  total: number;  // total across all months (for ranking)
}

export interface CategoryTrendsResult {
  points: TrendPoint[];
  series: TrendSeries[];  // top N categories sorted by total desc
}

/** Monthly spending per category over a date range. Excludes transfers. */
export function getCategoryTrends(
  transactions: Transaction[],
  categories: Category[],
  range: DateRange,
  options?: { type?: "expense" | "income"; limit?: number },
): CategoryTrendsResult {
  const type = options?.type ?? "expense";
  const limit = options?.limit ?? 8;
  const catMap = new Map(categories.map((c) => [c.id, c]));

  const startMs = range.start.getTime();
  const endMs = range.end.getTime();

  // monthKey → categoryId → absolute cents
  const buckets = new Map<string, Map<string, number>>();
  // categoryId → total across all months
  const categoryTotals = new Map<string, number>();

  for (const t of transactions) {
    if (t.type !== type) continue;
    const ms = new Date(t.datetime).getTime();
    if (ms < startMs || ms >= endMs) continue;

    const d = new Date(t.datetime);
    const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const catId = t.categoryId || "__uncategorized__";
    const amt = Math.abs(t.amount);

    if (!buckets.has(monthKey)) buckets.set(monthKey, new Map());
    const monthBucket = buckets.get(monthKey)!;
    monthBucket.set(catId, (monthBucket.get(catId) ?? 0) + amt);

    categoryTotals.set(catId, (categoryTotals.get(catId) ?? 0) + amt);
  }

  // Rank categories by total, take top N
  const ranked = [...categoryTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

  const topCatIds = new Set(ranked.map(([id]) => id));

  const series: TrendSeries[] = ranked.map(([id, total]) => {
    const cat = id === "__uncategorized__" ? undefined : catMap.get(id);
    return {
      categoryId: id === "__uncategorized__" ? "" : id,
      categoryName: cat?.name ?? "Uncategorized",
      total,
    };
  });

  // Build chronologically sorted points
  const points: TrendPoint[] = [];
  for (const [monthKey, catBuckets] of buckets) {
    const [yearStr, monthStr] = monthKey.split("-");
    const year = Number(yearStr);
    const month = Number(monthStr) - 1; // 0-indexed
    const firstOfMonth = new Date(year, month, 1);

    const byCategory: Record<string, number> = {};
    for (const [catId, amt] of catBuckets) {
      if (topCatIds.has(catId)) {
        const key = catId === "__uncategorized__" ? "" : catId;
        byCategory[key] = amt;
      }
    }

    points.push({
      date: firstOfMonth.toISOString(),
      month: `${MONTH_LABELS[month]} ${year}`,
      byCategory,
    });
  }

  points.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  return { points, series };
}
