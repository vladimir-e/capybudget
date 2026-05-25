import type { Transaction, Account, Category } from "./types";
import { getNetWorth } from "./queries";

// ── Types ──────────────────────────────────────────────────

export interface DuplicateGroup {
  confidence: "high" | "possible";
  transactionIds: string[];
  amount: number;
  merchant: string;
  date: string;
  reason: string;
}

export interface RecurringOptions {
  lookbackDays?: number;
  minTransactions?: number;
  cadence?: "weekly" | "monthly" | "yearly" | "irregular";
}

export interface RecurringPattern {
  merchant: string;
  cadence: "weekly" | "monthly" | "yearly" | "irregular";
  avgAmount: number;
  variance: "stable" | "variable";
  transactionIds: string[];
  firstSeen: string;
  lastSeen: string;
  nextExpected: string;
  totalSpent: number;
  transactionCount: number;
}

export interface BudgetStats {
  transactionCount: number;
  activeAccountCount: number;
  categoryCount: number;
  dateRange: { from: string; to: string } | null;
  netWorth: number;
}

// ── Helpers ────────────────────────────────────────────────

function extractDate(t: Transaction): string {
  return t.datetime.slice(0, 10);
}

function normalizeMerchant(m: string): string {
  return m.toLowerCase().trim();
}

function offsetDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysBetween(a: string, b: string): number {
  const msA = new Date(a + "T12:00:00").getTime();
  const msB = new Date(b + "T12:00:00").getTime();
  return Math.round(Math.abs(msB - msA) / 86_400_000);
}

function fuzzyMerchantMatch(a: string, b: string): boolean {
  const na = normalizeMerchant(a);
  const nb = normalizeMerchant(b);
  if (na === "" || nb === "") return false;
  return na.includes(nb) || nb.includes(na);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function classifyCadence(
  medianDays: number,
): "weekly" | "monthly" | "yearly" | "irregular" {
  if (medianDays >= 5 && medianDays <= 9) return "weekly";
  if (medianDays >= 25 && medianDays <= 35) return "monthly";
  if (medianDays >= 330 && medianDays <= 400) return "yearly";
  return "irregular";
}

// ── findDuplicates ─────────────────────────────────────────

export function findDuplicates(transactions: Transaction[]): DuplicateGroup[] {
  const eligible = transactions.filter((t) => t.type !== "transfer");
  const claimed = new Set<string>();

  // High-confidence: exact accountId + amount + date + normalized merchant
  type Key = string;
  const exactGroups = new Map<Key, Transaction[]>();
  for (const t of eligible) {
    const key = `${t.accountId}|${t.amount}|${extractDate(t)}|${normalizeMerchant(t.merchant)}`;
    let group = exactGroups.get(key);
    if (!group) {
      group = [];
      exactGroups.set(key, group);
    }
    group.push(t);
  }

  const highGroups: DuplicateGroup[] = [];
  for (const group of exactGroups.values()) {
    if (group.length < 2) continue;
    for (const t of group) claimed.add(t.id);
    const rep = group[0];
    highGroups.push({
      confidence: "high",
      transactionIds: group.map((t) => t.id),
      amount: rep.amount,
      merchant: rep.merchant,
      date: extractDate(rep),
      reason: `Exact match: same account, amount, date, and merchant (${group.length} transactions)`,
    });
  }

  // Possible: same accountId + amount, dates within ±1 day, fuzzy merchant
  const unclaimed = eligible.filter((t) => !claimed.has(t.id));
  const byAccountAmount = new Map<string, Transaction[]>();
  for (const t of unclaimed) {
    const key = `${t.accountId}|${t.amount}`;
    let group = byAccountAmount.get(key);
    if (!group) {
      group = [];
      byAccountAmount.set(key, group);
    }
    group.push(t);
  }

  const possibleGroups: DuplicateGroup[] = [];
  for (const candidates of byAccountAmount.values()) {
    if (candidates.length < 2) continue;

    const sorted = [...candidates].sort(
      (a, b) => extractDate(a).localeCompare(extractDate(b)),
    );

    const used = new Set<string>();
    for (let i = 0; i < sorted.length; i++) {
      if (used.has(sorted[i].id)) continue;
      const cluster = [sorted[i]];
      for (let j = i + 1; j < sorted.length; j++) {
        if (used.has(sorted[j].id)) continue;
        const dateDiff = daysBetween(extractDate(sorted[i]), extractDate(sorted[j]));
        if (dateDiff > 1) break;
        if (fuzzyMerchantMatch(sorted[i].merchant, sorted[j].merchant)) {
          cluster.push(sorted[j]);
        }
      }
      if (cluster.length >= 2) {
        for (const t of cluster) {
          used.add(t.id);
          claimed.add(t.id);
        }
        const rep = cluster[0];
        possibleGroups.push({
          confidence: "possible",
          transactionIds: cluster.map((t) => t.id),
          amount: rep.amount,
          merchant: rep.merchant,
          date: extractDate(rep),
          reason: `Similar: same account and amount, dates within 1 day, similar merchant (${cluster.length} transactions)`,
        });
      }
    }
  }

  const all = [...highGroups, ...possibleGroups];
  all.sort((a, b) => b.date.localeCompare(a.date));
  return all;
}

// ── findRecurring ──────────────────────────────────────────

export function findRecurring(
  transactions: Transaction[],
  opts?: RecurringOptions,
): RecurringPattern[] {
  const lookbackDays = opts?.lookbackDays ?? 548;
  const minTransactions = opts?.minTransactions ?? 3;
  const cadenceFilter = opts?.cadence;

  if (transactions.length === 0) return [];

  const latestDate = transactions.reduce((latest, t) => {
    const d = extractDate(t);
    return d > latest ? d : latest;
  }, extractDate(transactions[0]));

  const cutoff = offsetDate(latestDate, -lookbackDays);

  const eligible = transactions.filter((t) => {
    const m = normalizeMerchant(t.merchant);
    return m !== "" && extractDate(t) >= cutoff;
  });

  const byMerchant = new Map<string, Transaction[]>();
  for (const t of eligible) {
    const key = normalizeMerchant(t.merchant);
    let group = byMerchant.get(key);
    if (!group) {
      group = [];
      byMerchant.set(key, group);
    }
    group.push(t);
  }

  const patterns: RecurringPattern[] = [];

  for (const [, group] of byMerchant) {
    if (group.length < minTransactions) continue;

    const sorted = [...group].sort((a, b) =>
      extractDate(a).localeCompare(extractDate(b)),
    );

    const dates = sorted.map(extractDate);
    const intervals: number[] = [];
    for (let i = 1; i < dates.length; i++) {
      intervals.push(daysBetween(dates[i - 1], dates[i]));
    }

    const medianInterval = median(intervals);
    const cadence = classifyCadence(medianInterval);

    if (cadenceFilter && cadence !== cadenceFilter) continue;

    const amounts = sorted.map((t) => Math.abs(t.amount));
    const totalSpent = amounts.reduce((s, a) => s + a, 0);
    const avgAmount = Math.round(totalSpent / amounts.length);

    const mean = avgAmount;
    const stddev = Math.sqrt(
      amounts.reduce((s, a) => s + (a - mean) ** 2, 0) / amounts.length,
    );
    const variance: "stable" | "variable" =
      mean > 0 && stddev / mean < 0.1 ? "stable" : "variable";

    const nextExpected = offsetDate(dates[dates.length - 1], Math.round(medianInterval));

    patterns.push({
      merchant: sorted[0].merchant,
      cadence,
      avgAmount,
      variance,
      transactionIds: sorted.map((t) => t.id),
      firstSeen: dates[0],
      lastSeen: dates[dates.length - 1],
      nextExpected,
      totalSpent,
      transactionCount: sorted.length,
    });
  }

  patterns.sort((a, b) => b.totalSpent - a.totalSpent);
  return patterns;
}

// ── getBudgetStats ─────────────────────────────────────────

export function getBudgetStats(
  transactions: Transaction[],
  accounts: Account[],
  categories: Category[],
): BudgetStats {
  const dates = transactions.map(extractDate).sort();
  const dateRange =
    dates.length > 0
      ? { from: dates[0], to: dates[dates.length - 1] }
      : null;

  return {
    transactionCount: transactions.length,
    activeAccountCount: accounts.filter((a) => !a.archived).length,
    categoryCount: categories.filter((c) => !c.archived).length,
    dateRange,
    netWorth: getNetWorth(accounts, transactions),
  };
}
