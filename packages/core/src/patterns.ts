/**
 * Pattern intelligence — pure functions shared by the chat tools
 * (find_duplicates / find_recurring) and the Patterns analytics tab.
 */

import type { Account, Category, Transaction } from "./types";
import { getNetWorth } from "./queries";

// ── findDuplicates ────────────────────────────────────────────────

export interface DuplicateGroup {
  /** Stable hash of the member transaction IDs, sorted. Identical input
   *  yields identical id, so consumers can React-key off it safely. */
  id: string;
  /** Two or more transaction IDs in this group. */
  transactionIds: string[];
  confidence: "high" | "possible";
  reason: string;
  /** Representative amount (the cents value of the first member). */
  amount: number;
  /** Representative merchant (the first member's merchant, possibly empty). */
  merchant: string;
  /** Representative ISO date (YYYY-MM-DD) of the first member. */
  date: string;
}

/** Find duplicate transactions within a single budget.
 *
 *  Detection rules:
 *   - **high**: exact match on `accountId + amount + datetime[:10] +
 *     normalized(merchant)` with ≥2 rows.
 *   - **possible**: same `amount + accountId`, dates within ±1 day,
 *     merchants fuzzy-equal (normalized substring or both empty),
 *     not already in a high group.
 *
 *  Transfers are excluded entirely — both legs share the same amount and
 *  account-adjacent shape, which would generate noise without value.
 *
 *  Grouping is greedy: a transaction appears in at most one group. High
 *  takes precedence over possible. */
export function findDuplicates(transactions: Transaction[]): DuplicateGroup[] {
  const eligible = transactions.filter((t) => t.type !== "transfer");
  const claimed = new Set<string>();
  const groups: DuplicateGroup[] = [];

  // Bucket by exact (account|amount|date|merchant) signature; any
  // bucket with ≥2 members is a high group.
  const highBuckets = new Map<string, Transaction[]>();
  for (const t of eligible) {
    const key = highKey(t);
    const bucket = highBuckets.get(key);
    if (bucket) bucket.push(t);
    else highBuckets.set(key, [t]);
  }

  for (const bucket of highBuckets.values()) {
    if (bucket.length < 2) continue;
    for (const t of bucket) claimed.add(t.id);
    groups.push(makeGroup(bucket, "high", "Same date, amount, merchant, account"));
  }

  // Union-find over unclaimed rows that share (account|amount). Inside
  // each such bucket, two rows merge if their dates are within ±1 day
  // and their merchants fuzzy-match.
  const possibleBuckets = new Map<string, Transaction[]>();
  for (const t of eligible) {
    if (claimed.has(t.id)) continue;
    const key = `${t.accountId}|${t.amount}`;
    const bucket = possibleBuckets.get(key);
    if (bucket) bucket.push(t);
    else possibleBuckets.set(key, [t]);
  }

  for (const bucket of possibleBuckets.values()) {
    if (bucket.length < 2) continue;
    const components = unionByPredicate(bucket, (a, b) => {
      const days = Math.abs(daysBetween(a.datetime, b.datetime));
      if (days > 1) return false;
      return fuzzyMerchantMatch(a.merchant, b.merchant);
    });
    for (const component of components) {
      if (component.length < 2) continue;
      for (const t of component) claimed.add(t.id);
      groups.push(
        makeGroup(component, "possible", "Same amount and account, close dates"),
      );
    }
  }

  return groups;
}

function highKey(t: Transaction): string {
  return [
    t.accountId,
    t.amount,
    t.datetime.slice(0, 10),
    normalizeMerchant(t.merchant),
  ].join("|");
}

function normalizeMerchant(m: string): string {
  return m.toLowerCase().trim().replace(/\s+/g, " ");
}

function fuzzyMerchantMatch(a: string, b: string): boolean {
  const na = normalizeMerchant(a);
  const nb = normalizeMerchant(b);
  if (na === "" || nb === "") return na === nb;
  if (na === nb) return true;
  return na.includes(nb) || nb.includes(na);
}

function daysBetween(aIso: string, bIso: string): number {
  const a = new Date(aIso.slice(0, 10) + "T12:00:00Z").getTime();
  const b = new Date(bIso.slice(0, 10) + "T12:00:00Z").getTime();
  return Math.round((a - b) / (24 * 60 * 60 * 1000));
}

/** Connected components on a list under an undirected predicate.
 *  O(n²) in the bucket size — fine because buckets are already keyed by
 *  account|amount, which is highly selective. */
function unionByPredicate<T>(
  items: T[],
  related: (a: T, b: T) => boolean,
): T[][] {
  const parent = items.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (i: number, j: number) => {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[ri] = rj;
  };

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (related(items[i], items[j])) union(i, j);
    }
  }

  const groups = new Map<number, T[]>();
  for (let i = 0; i < items.length; i++) {
    const root = find(i);
    const g = groups.get(root);
    if (g) g.push(items[i]);
    else groups.set(root, [items[i]]);
  }
  return [...groups.values()];
}

function makeGroup(
  members: Transaction[],
  confidence: "high" | "possible",
  reason: string,
): DuplicateGroup {
  const ids = members.map((m) => m.id).sort();
  const rep = members[0];
  return {
    id: `dup-${hashStringList(ids)}`,
    transactionIds: ids,
    confidence,
    reason,
    amount: rep.amount,
    merchant: rep.merchant,
    date: rep.datetime.slice(0, 10),
  };
}

function hashStringList(parts: string[]): string {
  // Tiny non-cryptographic hash — stable for any given input list. The
  // ID only needs to be unique within a single findDuplicates() result
  // and stable across runs on the same data, both of which this gives.
  let h = 5381;
  const joined = parts.join("\0");
  for (let i = 0; i < joined.length; i++) {
    h = ((h << 5) + h + joined.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

// ── findRecurring ─────────────────────────────────────────────────

export interface RecurringPattern {
  /** Stable hash of the normalized merchant. */
  id: string;
  /** Canonical merchant name — the most-recent non-empty form. */
  merchant: string;
  cadence: "weekly" | "monthly" | "yearly" | "irregular";
  /** Mean of transaction amounts, in cents. Sign matches the underlying
   *  transactions (negative for expenses, positive for income). */
  averageAmount: number;
  amountVariance: "stable" | "variable";
  /** Transaction IDs sorted by datetime descending (newest first). */
  transactionIds: string[];
  firstSeen: string;
  lastSeen: string;
  /** Projected next occurrence. Omitted for irregular cadence. */
  nextExpected?: string;
  /** Sum of magnitudes, in cents — income negated so totals always
   *  represent gross spend on this merchant for ranking. */
  totalSpent: number;
}

export interface RecurringOptions {
  /** Lookback window in days. Defaults to ~18 months. */
  lookbackDays?: number;
  /** Minimum transactions to qualify as a pattern. Default 3. */
  minTransactions?: number;
}

const DEFAULT_LOOKBACK_DAYS = 540;

export function findRecurring(
  transactions: Transaction[],
  opts: RecurringOptions = {},
): RecurringPattern[] {
  const lookbackDays = opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const minTxns = opts.minTransactions ?? 3;

  const eligible = transactions.filter(
    (t) => t.type !== "transfer" && t.merchant.trim() !== "",
  );

  // Time cutoff: lookbackDays before the latest transaction. Using
  // latest-tx-date instead of "now" keeps demo data and historical
  // datasets analyzable.
  if (eligible.length === 0) return [];
  const latestMs = Math.max(
    ...eligible.map((t) => new Date(t.datetime).getTime()),
  );
  const cutoffMs = latestMs - lookbackDays * 24 * 60 * 60 * 1000;
  const inWindow = eligible.filter(
    (t) => new Date(t.datetime).getTime() >= cutoffMs,
  );

  // Group by normalized merchant.
  const byMerchant = new Map<string, Transaction[]>();
  for (const t of inWindow) {
    const key = normalizeMerchant(t.merchant);
    const list = byMerchant.get(key);
    if (list) list.push(t);
    else byMerchant.set(key, [t]);
  }

  const patterns: RecurringPattern[] = [];

  for (const [key, group] of byMerchant) {
    if (group.length < minTxns) continue;

    const sortedAsc = [...group].sort((a, b) =>
      a.datetime.localeCompare(b.datetime),
    );

    const deltas: number[] = [];
    for (let i = 1; i < sortedAsc.length; i++) {
      deltas.push(daysBetween(sortedAsc[i].datetime, sortedAsc[i - 1].datetime));
    }

    const median = medianOf(deltas);
    const cadence = classifyCadence(deltas);

    const amounts = sortedAsc.map((t) => t.amount);
    const meanAmount = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    const variance = isStableAmount(amounts, meanAmount) ? "stable" : "variable";

    const sortedDesc = [...sortedAsc].reverse();
    const canonicalMerchant = sortedDesc[0].merchant;

    const firstSeen = sortedAsc[0].datetime.slice(0, 10);
    const lastSeen = sortedDesc[0].datetime.slice(0, 10);

    let nextExpected: string | undefined;
    if (cadence !== "irregular") {
      nextExpected = addDays(lastSeen, Math.round(median));
    }

    // totalSpent is gross magnitude — income merchants (positive amounts)
    // contribute their face value, expense merchants contribute their
    // absolute. This lets the analytics tab rank patterns by impact.
    const totalSpent = amounts.reduce((s, a) => s + Math.abs(a), 0);

    patterns.push({
      id: `rec-${hashStringList([key])}`,
      merchant: canonicalMerchant,
      cadence,
      averageAmount: Math.round(meanAmount),
      amountVariance: variance,
      transactionIds: sortedDesc.map((t) => t.id),
      firstSeen,
      lastSeen,
      nextExpected,
      totalSpent,
    });
  }

  return patterns.sort((a, b) => b.totalSpent - a.totalSpent);
}

function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** Bucket each interval and pick the dominant cadence — when ≥70% of
 *  intervals land in a single bucket, that's the pattern. Otherwise
 *  "irregular". */
function classifyCadence(
  deltas: number[],
): "weekly" | "monthly" | "yearly" | "irregular" {
  if (deltas.length === 0) return "irregular";
  let weekly = 0;
  let monthly = 0;
  let yearly = 0;
  for (const d of deltas) {
    if (d >= 5 && d <= 9) weekly++;
    else if (d >= 25 && d <= 35) monthly++;
    else if (d >= 330 && d <= 400) yearly++;
  }
  const threshold = deltas.length * 0.7;
  if (monthly >= threshold) return "monthly";
  if (weekly >= threshold) return "weekly";
  if (yearly >= threshold) return "yearly";
  return "irregular";
}

function isStableAmount(amounts: number[], mean: number): boolean {
  if (mean === 0) return amounts.every((a) => a === 0);
  const tolerance = Math.abs(mean) * 0.1;
  return amounts.every((a) => Math.abs(a - mean) <= tolerance);
}

function addDays(dateYmd: string, days: number): string {
  const d = new Date(dateYmd + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── getBudgetStats ────────────────────────────────────────────────

export interface BudgetStats {
  transactionCount: number;
  activeAccountCount: number;
  categoryCount: number;
  earliestDate: string | null;
  latestDate: string | null;
  netWorth: number;
  topExpenseCategoriesYtd: { categoryName: string; amount: number }[];
}

/** One-shot summary used to bootstrap chat context. "YTD" runs from
 *  Jan 1 of the latest tx's year to the latest tx date, so it stays
 *  meaningful for demo data and historical imports — not just data
 *  where "today" matches the calendar. */
export function getBudgetStats(
  transactions: Transaction[],
  accounts: Account[],
  categories: Category[],
): BudgetStats {
  const activeAccountCount = accounts.filter((a) => !a.archived).length;
  const categoryCount = categories.filter((c) => !c.archived).length;
  const netWorth = getNetWorth(accounts, transactions);

  if (transactions.length === 0) {
    return {
      transactionCount: 0,
      activeAccountCount,
      categoryCount,
      earliestDate: null,
      latestDate: null,
      netWorth,
      topExpenseCategoriesYtd: [],
    };
  }

  let minDt = transactions[0].datetime;
  let maxDt = transactions[0].datetime;
  for (const t of transactions) {
    if (t.datetime < minDt) minDt = t.datetime;
    if (t.datetime > maxDt) maxDt = t.datetime;
  }

  const latestYear = Number(maxDt.slice(0, 4));
  const ytdStart = `${latestYear}-01-01`;
  const ytdEnd = maxDt.slice(0, 10);

  const categoryNames = new Map(categories.map((c) => [c.id, c.name]));
  const sumByCategory = new Map<string, number>();
  for (const t of transactions) {
    if (t.type !== "expense") continue;
    const date = t.datetime.slice(0, 10);
    if (date < ytdStart || date > ytdEnd) continue;
    const key = t.categoryId || "__uncategorized__";
    sumByCategory.set(key, (sumByCategory.get(key) ?? 0) + Math.abs(t.amount));
  }

  const topExpenseCategoriesYtd = [...sumByCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id, amount]) => ({
      categoryName:
        id === "__uncategorized__"
          ? "Uncategorized"
          : (categoryNames.get(id) ?? "Uncategorized"),
      amount,
    }));

  return {
    transactionCount: transactions.length,
    activeAccountCount,
    categoryCount,
    earliestDate: minDt.slice(0, 10),
    latestDate: maxDt.slice(0, 10),
    netWorth,
    topExpenseCategoriesYtd,
  };
}
