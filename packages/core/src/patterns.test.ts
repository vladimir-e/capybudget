import { describe, it, expect } from "vitest";
import { findDuplicates, findRecurring, getBudgetStats } from "./patterns";
import type { Transaction, Account, Category } from "./types";

// ── Test fixture helper ────────────────────────────────────

const txn = (
  overrides: Partial<Transaction> & Pick<Transaction, "id" | "amount" | "accountId">,
): Transaction => ({
  datetime: "2026-03-15T12:00:00.000Z",
  type: "expense",
  categoryId: "cat-food",
  transferPairId: "",
  merchant: "",
  note: "",
  createdAt: "2026-03-15T00:00:00.000Z",
  ...overrides,
});

// ── findDuplicates ─────────────────────────────────────────

describe("findDuplicates", () => {
  it("detects high-confidence duplicates (exact match)", () => {
    const transactions = [
      txn({ id: "t1", amount: -1500, accountId: "acc-1", merchant: "Starbucks", datetime: "2026-03-10T08:00:00.000Z" }),
      txn({ id: "t2", amount: -1500, accountId: "acc-1", merchant: "Starbucks", datetime: "2026-03-10T17:00:00.000Z" }),
      txn({ id: "t3", amount: -2000, accountId: "acc-1", merchant: "Target", datetime: "2026-03-10T12:00:00.000Z" }),
    ];

    const groups = findDuplicates(transactions);
    expect(groups).toHaveLength(1);
    expect(groups[0].confidence).toBe("high");
    expect(groups[0].transactionIds).toEqual(["t1", "t2"]);
    expect(groups[0].amount).toBe(-1500);
  });

  it("detects possible duplicates (fuzzy merchant, ±1 day)", () => {
    const transactions = [
      txn({ id: "t1", amount: -3000, accountId: "acc-1", merchant: "Amazon", datetime: "2026-03-10T10:00:00.000Z" }),
      txn({ id: "t2", amount: -3000, accountId: "acc-1", merchant: "Amazon Prime", datetime: "2026-03-11T10:00:00.000Z" }),
    ];

    const groups = findDuplicates(transactions);
    expect(groups).toHaveLength(1);
    expect(groups[0].confidence).toBe("possible");
    expect(groups[0].transactionIds).toContain("t1");
    expect(groups[0].transactionIds).toContain("t2");
  });

  it("excludes transfers", () => {
    const transactions = [
      txn({ id: "t1", type: "transfer", amount: -5000, accountId: "acc-1", merchant: "Internal", datetime: "2026-03-10T10:00:00.000Z" }),
      txn({ id: "t2", type: "transfer", amount: -5000, accountId: "acc-1", merchant: "Internal", datetime: "2026-03-10T10:00:00.000Z" }),
    ];

    const groups = findDuplicates(transactions);
    expect(groups).toHaveLength(0);
  });

  it("assigns each transaction to at most one group (high takes precedence)", () => {
    const transactions = [
      txn({ id: "t1", amount: -1500, accountId: "acc-1", merchant: "Starbucks", datetime: "2026-03-10T08:00:00.000Z" }),
      txn({ id: "t2", amount: -1500, accountId: "acc-1", merchant: "Starbucks", datetime: "2026-03-10T17:00:00.000Z" }),
      txn({ id: "t3", amount: -1500, accountId: "acc-1", merchant: "Starbucks Coffee", datetime: "2026-03-11T09:00:00.000Z" }),
    ];

    const groups = findDuplicates(transactions);
    const allIds = groups.flatMap((g) => g.transactionIds);
    const unique = new Set(allIds);
    expect(unique.size).toBe(allIds.length);

    const highGroup = groups.find((g) => g.confidence === "high")!;
    expect(highGroup.transactionIds).toEqual(["t1", "t2"]);
  });

  it("sorts groups by date descending", () => {
    const transactions = [
      txn({ id: "t1", amount: -1000, accountId: "acc-1", merchant: "A", datetime: "2026-01-10T10:00:00.000Z" }),
      txn({ id: "t2", amount: -1000, accountId: "acc-1", merchant: "A", datetime: "2026-01-10T10:00:00.000Z" }),
      txn({ id: "t3", amount: -2000, accountId: "acc-1", merchant: "B", datetime: "2026-03-15T10:00:00.000Z" }),
      txn({ id: "t4", amount: -2000, accountId: "acc-1", merchant: "B", datetime: "2026-03-15T10:00:00.000Z" }),
    ];

    const groups = findDuplicates(transactions);
    expect(groups).toHaveLength(2);
    expect(groups[0].date).toBe("2026-03-15");
    expect(groups[1].date).toBe("2026-01-10");
  });

  it("returns empty for no duplicates", () => {
    const transactions = [
      txn({ id: "t1", amount: -1000, accountId: "acc-1", merchant: "A", datetime: "2026-03-10T10:00:00.000Z" }),
      txn({ id: "t2", amount: -2000, accountId: "acc-1", merchant: "B", datetime: "2026-03-10T10:00:00.000Z" }),
    ];

    expect(findDuplicates(transactions)).toHaveLength(0);
  });
});

// ── findRecurring ──────────────────────────────────────────

describe("findRecurring", () => {
  const monthlySubscription = (id: string, month: number) =>
    txn({
      id,
      amount: -999,
      accountId: "acc-1",
      merchant: "Netflix",
      datetime: `2026-${String(month).padStart(2, "0")}-01T10:00:00.000Z`,
    });

  it("detects monthly subscriptions", () => {
    const transactions = [
      monthlySubscription("n1", 1),
      monthlySubscription("n2", 2),
      monthlySubscription("n3", 3),
      monthlySubscription("n4", 4),
    ];

    const patterns = findRecurring(transactions);
    expect(patterns).toHaveLength(1);
    expect(patterns[0].merchant).toBe("Netflix");
    expect(patterns[0].cadence).toBe("monthly");
    expect(patterns[0].avgAmount).toBe(999);
    expect(patterns[0].variance).toBe("stable");
    expect(patterns[0].transactionCount).toBe(4);
    expect(patterns[0].totalSpent).toBe(3996);
    expect(patterns[0].firstSeen).toBe("2026-01-01");
    expect(patterns[0].lastSeen).toBe("2026-04-01");
  });

  it("detects weekly patterns", () => {
    const transactions = Array.from({ length: 5 }, (_, i) =>
      txn({
        id: `w${i}`,
        amount: -500,
        accountId: "acc-1",
        merchant: "Gym",
        datetime: `2026-03-${String(1 + i * 7).padStart(2, "0")}T10:00:00.000Z`,
      }),
    );

    const patterns = findRecurring(transactions);
    expect(patterns).toHaveLength(1);
    expect(patterns[0].cadence).toBe("weekly");
  });

  it("detects yearly patterns", () => {
    const transactions = [
      txn({ id: "y1", amount: -12000, accountId: "acc-1", merchant: "Domain Renewal", datetime: "2023-06-15T10:00:00.000Z" }),
      txn({ id: "y2", amount: -12000, accountId: "acc-1", merchant: "Domain Renewal", datetime: "2024-06-14T10:00:00.000Z" }),
      txn({ id: "y3", amount: -12000, accountId: "acc-1", merchant: "Domain Renewal", datetime: "2025-06-15T10:00:00.000Z" }),
    ];

    const patterns = findRecurring(transactions, { lookbackDays: 1100 });
    expect(patterns).toHaveLength(1);
    expect(patterns[0].cadence).toBe("yearly");
  });

  it("respects minimum transaction threshold", () => {
    const transactions = [
      txn({ id: "t1", amount: -999, accountId: "acc-1", merchant: "One-Off", datetime: "2026-01-01T10:00:00.000Z" }),
      txn({ id: "t2", amount: -999, accountId: "acc-1", merchant: "One-Off", datetime: "2026-02-01T10:00:00.000Z" }),
    ];

    expect(findRecurring(transactions)).toHaveLength(0);
    expect(findRecurring(transactions, { minTransactions: 2 })).toHaveLength(1);
  });

  it("filters by lookback window", () => {
    const transactions = [
      txn({ id: "old1", amount: -500, accountId: "acc-1", merchant: "OldSub", datetime: "2023-01-01T10:00:00.000Z" }),
      txn({ id: "old2", amount: -500, accountId: "acc-1", merchant: "OldSub", datetime: "2023-02-01T10:00:00.000Z" }),
      txn({ id: "old3", amount: -500, accountId: "acc-1", merchant: "OldSub", datetime: "2023-03-01T10:00:00.000Z" }),
      txn({ id: "new1", amount: -999, accountId: "acc-1", merchant: "NewSub", datetime: "2026-01-01T10:00:00.000Z" }),
      txn({ id: "new2", amount: -999, accountId: "acc-1", merchant: "NewSub", datetime: "2026-02-01T10:00:00.000Z" }),
      txn({ id: "new3", amount: -999, accountId: "acc-1", merchant: "NewSub", datetime: "2026-03-01T10:00:00.000Z" }),
    ];

    const patterns = findRecurring(transactions, { lookbackDays: 120 });
    expect(patterns).toHaveLength(1);
    expect(patterns[0].merchant).toBe("NewSub");
  });

  it("filters by cadence option", () => {
    const weekly = Array.from({ length: 4 }, (_, i) =>
      txn({
        id: `w${i}`,
        amount: -500,
        accountId: "acc-1",
        merchant: "Gym",
        datetime: `2026-03-${String(1 + i * 7).padStart(2, "0")}T10:00:00.000Z`,
      }),
    );
    const monthly = [1, 2, 3, 4].map((m) =>
      txn({
        id: `m${m}`,
        amount: -999,
        accountId: "acc-1",
        merchant: "Netflix",
        datetime: `2026-${String(m).padStart(2, "0")}-01T10:00:00.000Z`,
      }),
    );

    const all = [...weekly, ...monthly];
    const monthlyOnly = findRecurring(all, { cadence: "monthly" });
    expect(monthlyOnly).toHaveLength(1);
    expect(monthlyOnly[0].merchant).toBe("Netflix");
  });

  it("skips transactions with blank merchant", () => {
    const transactions = [
      txn({ id: "t1", amount: -100, accountId: "acc-1", merchant: "", datetime: "2026-01-01T10:00:00.000Z" }),
      txn({ id: "t2", amount: -100, accountId: "acc-1", merchant: "", datetime: "2026-02-01T10:00:00.000Z" }),
      txn({ id: "t3", amount: -100, accountId: "acc-1", merchant: "", datetime: "2026-03-01T10:00:00.000Z" }),
    ];

    expect(findRecurring(transactions)).toHaveLength(0);
  });

  it("sorts by total spent descending", () => {
    const cheap = [1, 2, 3].map((m) =>
      txn({
        id: `c${m}`,
        amount: -100,
        accountId: "acc-1",
        merchant: "Cheap",
        datetime: `2026-${String(m).padStart(2, "0")}-01T10:00:00.000Z`,
      }),
    );
    const expensive = [1, 2, 3].map((m) =>
      txn({
        id: `e${m}`,
        amount: -5000,
        accountId: "acc-1",
        merchant: "Expensive",
        datetime: `2026-${String(m).padStart(2, "0")}-15T10:00:00.000Z`,
      }),
    );

    const patterns = findRecurring([...cheap, ...expensive]);
    expect(patterns[0].merchant).toBe("Expensive");
    expect(patterns[1].merchant).toBe("Cheap");
  });

  it("computes nextExpected from last date + median interval", () => {
    const transactions = [
      txn({ id: "n1", amount: -999, accountId: "acc-1", merchant: "Sub", datetime: "2026-01-01T10:00:00.000Z" }),
      txn({ id: "n2", amount: -999, accountId: "acc-1", merchant: "Sub", datetime: "2026-01-31T10:00:00.000Z" }),
      txn({ id: "n3", amount: -999, accountId: "acc-1", merchant: "Sub", datetime: "2026-03-02T10:00:00.000Z" }),
    ];

    const patterns = findRecurring(transactions);
    expect(patterns[0].nextExpected).toBeDefined();
    expect(patterns[0].nextExpected > patterns[0].lastSeen).toBe(true);
  });

  it("returns empty for empty input", () => {
    expect(findRecurring([])).toHaveLength(0);
  });
});

// ── getBudgetStats ─────────────────────────────────────────

describe("getBudgetStats", () => {
  const accounts: Account[] = [
    { id: "acc-1", name: "Checking", type: "checking", archived: false, excludeFromNetWorth: false, sortOrder: 0, createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "acc-2", name: "Savings", type: "savings", archived: false, excludeFromNetWorth: false, sortOrder: 1, createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "acc-old", name: "Old Account", type: "checking", archived: true, excludeFromNetWorth: false, sortOrder: 2, createdAt: "2025-01-01T00:00:00.000Z" },
  ];

  const categories: Category[] = [
    { id: "cat-1", name: "Food", group: "Daily Living", archived: false, sortOrder: 0, assigned: 50000 },
    { id: "cat-2", name: "Rent", group: "Fixed", archived: false, sortOrder: 1, assigned: 150000 },
    { id: "cat-old", name: "Obsolete", group: "Personal", archived: true, sortOrder: 2, assigned: null },
  ];

  const transactions: Transaction[] = [
    txn({ id: "t1", type: "income", amount: 500000, accountId: "acc-1", datetime: "2026-01-15T10:00:00.000Z" }),
    txn({ id: "t2", amount: -3000, accountId: "acc-1", datetime: "2026-02-10T10:00:00.000Z" }),
    txn({ id: "t3", amount: -1500, accountId: "acc-2", datetime: "2026-03-20T10:00:00.000Z" }),
  ];

  it("computes basic stats", () => {
    const stats = getBudgetStats(transactions, accounts, categories);
    expect(stats.transactionCount).toBe(3);
    expect(stats.activeAccountCount).toBe(2);
    expect(stats.categoryCount).toBe(2);
    expect(stats.dateRange).toEqual({ from: "2026-01-15", to: "2026-03-20" });
    expect(stats.netWorth).toBe(500000 - 3000 - 1500);
  });

  it("returns null dateRange for empty transactions", () => {
    const stats = getBudgetStats([], accounts, categories);
    expect(stats.transactionCount).toBe(0);
    expect(stats.dateRange).toBeNull();
    expect(stats.netWorth).toBe(0);
  });

  it("excludes archived accounts and categories from counts", () => {
    const stats = getBudgetStats([], accounts, categories);
    expect(stats.activeAccountCount).toBe(2);
    expect(stats.categoryCount).toBe(2);
  });
});
