import { describe, it, expect } from "vitest";
import { findDuplicates, findRecurring, getBudgetStats } from "./patterns";
import type { Account, Category, Transaction } from "./types";

const txn = (
  overrides: Partial<Transaction> & Pick<Transaction, "id" | "amount" | "accountId">,
): Transaction => ({
  datetime: "2026-03-15T12:00:00.000Z",
  type: "expense",
  categoryId: "",
  transferPairId: "",
  merchant: "",
  note: "",
  createdAt: "2026-03-15T00:00:00.000Z",
  ...overrides,
});

const ACCOUNTS: Account[] = [
  { id: "acc-checking", name: "Checking", type: "checking", archived: false, excludeFromNetWorth: false, sortOrder: 0, createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "acc-savings", name: "Savings", type: "savings", archived: false, excludeFromNetWorth: false, sortOrder: 1, createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "acc-archived", name: "Old", type: "checking", archived: true, excludeFromNetWorth: false, sortOrder: 2, createdAt: "2025-01-01T00:00:00.000Z" },
];

const CATEGORIES: Category[] = [
  { id: "cat-groceries", name: "Groceries", group: "Daily Living", archived: false, sortOrder: 0, assigned: null },
  { id: "cat-rent", name: "Rent", group: "Fixed", archived: false, sortOrder: 1, assigned: null },
  { id: "cat-salary", name: "Salary", group: "Income", archived: false, sortOrder: 0, assigned: null },
];

// ── findDuplicates ─────

describe("findDuplicates", () => {
  it("flags exact duplicates as high confidence", () => {
    const result = findDuplicates([
      txn({ id: "t1", amount: -1500, accountId: "acc-checking", merchant: "Starbucks", datetime: "2026-03-10T10:00:00.000Z" }),
      txn({ id: "t2", amount: -1500, accountId: "acc-checking", merchant: "Starbucks", datetime: "2026-03-10T14:00:00.000Z" }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe("high");
    expect(result[0].transactionIds.sort()).toEqual(["t1", "t2"]);
  });

  it("normalizes merchant whitespace and case for high match", () => {
    const result = findDuplicates([
      txn({ id: "t1", amount: -1500, accountId: "acc-checking", merchant: "Trader Joe's", datetime: "2026-03-10T10:00:00.000Z" }),
      txn({ id: "t2", amount: -1500, accountId: "acc-checking", merchant: "  trader  joe's  ", datetime: "2026-03-10T14:00:00.000Z" }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe("high");
  });

  it("excludes transfers entirely", () => {
    const result = findDuplicates([
      txn({ id: "t1", type: "transfer", amount: -10000, accountId: "acc-checking", transferPairId: "t2", datetime: "2026-03-10T10:00:00.000Z" }),
      txn({ id: "t2", type: "transfer", amount: 10000, accountId: "acc-savings", transferPairId: "t1", datetime: "2026-03-10T10:00:00.000Z" }),
      // A second matching pair on the same date — would be a duplicate transfer in shape, but transfers are ignored.
      txn({ id: "t3", type: "transfer", amount: -10000, accountId: "acc-checking", transferPairId: "t4", datetime: "2026-03-10T10:00:00.000Z" }),
      txn({ id: "t4", type: "transfer", amount: 10000, accountId: "acc-savings", transferPairId: "t3", datetime: "2026-03-10T10:00:00.000Z" }),
    ]);
    expect(result).toEqual([]);
  });

  it("flags ±1 day same-amount same-account as possible", () => {
    const result = findDuplicates([
      txn({ id: "t1", amount: -2200, accountId: "acc-checking", merchant: "Amazon", datetime: "2026-03-10T10:00:00.000Z" }),
      txn({ id: "t2", amount: -2200, accountId: "acc-checking", merchant: "Amazon Marketplace", datetime: "2026-03-11T10:00:00.000Z" }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe("possible");
  });

  it("does not flag legitimate twice-monthly grocery runs", () => {
    const result = findDuplicates([
      txn({ id: "t1", amount: -8500, accountId: "acc-checking", merchant: "Whole Foods", datetime: "2026-03-05T10:00:00.000Z" }),
      txn({ id: "t2", amount: -8500, accountId: "acc-checking", merchant: "Whole Foods", datetime: "2026-03-19T10:00:00.000Z" }),
    ]);
    // Same amount + merchant, but 14 days apart — not within ±1 day window.
    expect(result).toEqual([]);
  });

  it("high takes precedence over possible (a tx claimed by high stays out of possible)", () => {
    const result = findDuplicates([
      // High pair: same date, account, amount, merchant.
      txn({ id: "t1", amount: -1500, accountId: "acc-checking", merchant: "Starbucks", datetime: "2026-03-10T10:00:00.000Z" }),
      txn({ id: "t2", amount: -1500, accountId: "acc-checking", merchant: "Starbucks", datetime: "2026-03-10T11:00:00.000Z" }),
      // Possible-only neighbour: same amount/account, next day.
      txn({ id: "t3", amount: -1500, accountId: "acc-checking", merchant: "Coffee Shop", datetime: "2026-03-11T10:00:00.000Z" }),
    ]);
    // t1+t2 should form a single high group; t3 is alone (no other unclaimed
    // tx shares its amount/account within window).
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe("high");
    expect(result[0].transactionIds.sort()).toEqual(["t1", "t2"]);
  });

  it("returns stable group ids for the same input", () => {
    const a = findDuplicates([
      txn({ id: "t1", amount: -1500, accountId: "acc-checking", merchant: "Starbucks", datetime: "2026-03-10T10:00:00.000Z" }),
      txn({ id: "t2", amount: -1500, accountId: "acc-checking", merchant: "Starbucks", datetime: "2026-03-10T14:00:00.000Z" }),
    ]);
    const b = findDuplicates([
      txn({ id: "t2", amount: -1500, accountId: "acc-checking", merchant: "Starbucks", datetime: "2026-03-10T14:00:00.000Z" }),
      txn({ id: "t1", amount: -1500, accountId: "acc-checking", merchant: "Starbucks", datetime: "2026-03-10T10:00:00.000Z" }),
    ]);
    expect(a[0].id).toBe(b[0].id);
  });
});

// ── findRecurring ──────

describe("findRecurring", () => {
  function monthly(merchantName: string, amount: number, count: number): Transaction[] {
    const txns: Transaction[] = [];
    for (let i = 0; i < count; i++) {
      const month = ((i % 12) + 1).toString().padStart(2, "0");
      const year = 2025 + Math.floor(i / 12);
      txns.push(
        txn({
          id: `${merchantName}-${i}`,
          amount,
          accountId: "acc-checking",
          merchant: merchantName,
          datetime: `${year}-${month}-15T10:00:00.000Z`,
        }),
      );
    }
    return txns;
  }

  it("detects a stable monthly subscription", () => {
    const result = findRecurring(monthly("Netflix", -1599, 12));
    expect(result).toHaveLength(1);
    expect(result[0].merchant).toBe("Netflix");
    expect(result[0].cadence).toBe("monthly");
    expect(result[0].amountVariance).toBe("stable");
    expect(result[0].averageAmount).toBe(-1599);
    expect(result[0].nextExpected).toBeDefined();
  });

  it("detects a weekly coffee habit", () => {
    const txns: Transaction[] = [];
    for (let i = 0; i < 10; i++) {
      const date = new Date("2026-01-05T10:00:00.000Z");
      date.setUTCDate(date.getUTCDate() + i * 7);
      txns.push(
        txn({
          id: `coffee-${i}`,
          amount: -650,
          accountId: "acc-checking",
          merchant: "Blue Bottle",
          datetime: date.toISOString(),
        }),
      );
    }
    const result = findRecurring(txns);
    expect(result).toHaveLength(1);
    expect(result[0].cadence).toBe("weekly");
  });

  it("detects a yearly subscription", () => {
    const txns: Transaction[] = [
      txn({ id: "d1", amount: -1900, accountId: "acc-checking", merchant: "Domain", datetime: "2024-06-15T10:00:00.000Z" }),
      txn({ id: "d2", amount: -1900, accountId: "acc-checking", merchant: "Domain", datetime: "2025-06-15T10:00:00.000Z" }),
      txn({ id: "d3", amount: -1900, accountId: "acc-checking", merchant: "Domain", datetime: "2026-06-15T10:00:00.000Z" }),
    ];
    const result = findRecurring(txns, { lookbackDays: 365 * 3 });
    expect(result).toHaveLength(1);
    expect(result[0].cadence).toBe("yearly");
  });

  it("ignores merchants with fewer than minTransactions", () => {
    const result = findRecurring([
      txn({ id: "t1", amount: -1599, accountId: "acc-checking", merchant: "Netflix", datetime: "2026-01-15T10:00:00.000Z" }),
      txn({ id: "t2", amount: -1599, accountId: "acc-checking", merchant: "Netflix", datetime: "2026-02-15T10:00:00.000Z" }),
    ]);
    expect(result).toEqual([]);
  });

  it("ignores transactions older than the lookback window", () => {
    // Three ancient transactions + one recent one = no pattern within the
    // most-recent-data-anchored window.
    const result = findRecurring(
      [
        txn({ id: "t1", amount: -1599, accountId: "acc-checking", merchant: "Netflix", datetime: "2020-01-15T10:00:00.000Z" }),
        txn({ id: "t2", amount: -1599, accountId: "acc-checking", merchant: "Netflix", datetime: "2020-02-15T10:00:00.000Z" }),
        txn({ id: "t3", amount: -1599, accountId: "acc-checking", merchant: "Netflix", datetime: "2020-03-15T10:00:00.000Z" }),
        txn({ id: "t4", amount: -1599, accountId: "acc-checking", merchant: "Netflix", datetime: "2026-03-15T10:00:00.000Z" }),
      ],
      { lookbackDays: 540 },
    );
    expect(result).toEqual([]);
  });

  it("ignores empty merchants", () => {
    const result = findRecurring(monthly("", -1000, 12));
    expect(result).toEqual([]);
  });

  it("classifies wildly irregular intervals as irregular without nextExpected", () => {
    const txns = [
      txn({ id: "t1", amount: -5000, accountId: "acc-checking", merchant: "Random", datetime: "2026-01-05T10:00:00.000Z" }),
      txn({ id: "t2", amount: -5000, accountId: "acc-checking", merchant: "Random", datetime: "2026-01-15T10:00:00.000Z" }),
      txn({ id: "t3", amount: -5000, accountId: "acc-checking", merchant: "Random", datetime: "2026-04-22T10:00:00.000Z" }),
      txn({ id: "t4", amount: -5000, accountId: "acc-checking", merchant: "Random", datetime: "2026-04-25T10:00:00.000Z" }),
    ];
    const result = findRecurring(txns);
    expect(result).toHaveLength(1);
    expect(result[0].cadence).toBe("irregular");
    expect(result[0].nextExpected).toBeUndefined();
  });

  it("flags variable amounts when outside ±10%", () => {
    const txns = monthly("UtilityCo", -10000, 6);
    txns[0] = { ...txns[0], amount: -15000 };
    const result = findRecurring(txns);
    expect(result).toHaveLength(1);
    expect(result[0].amountVariance).toBe("variable");
  });

  it("sorts patterns by totalSpent descending", () => {
    const result = findRecurring([
      ...monthly("Cheap", -500, 6),
      ...monthly("Expensive", -10000, 6),
    ]);
    expect(result.map((p) => p.merchant)).toEqual(["Expensive", "Cheap"]);
  });

  it("excludes transfers", () => {
    const txns: Transaction[] = [];
    for (let i = 0; i < 6; i++) {
      const month = (i + 1).toString().padStart(2, "0");
      txns.push(
        txn({
          id: `tx-${i}`,
          type: "transfer",
          amount: -10000,
          accountId: "acc-checking",
          merchant: "To Savings",
          transferPairId: `pair-${i}`,
          datetime: `2026-${month}-15T10:00:00.000Z`,
        }),
      );
    }
    expect(findRecurring(txns)).toEqual([]);
  });
});

// ── getBudgetStats ─────

describe("getBudgetStats", () => {
  it("returns zeroed result for an empty budget", () => {
    const stats = getBudgetStats([], ACCOUNTS, CATEGORIES);
    expect(stats.transactionCount).toBe(0);
    expect(stats.earliestDate).toBeNull();
    expect(stats.latestDate).toBeNull();
    expect(stats.topExpenseCategoriesYtd).toEqual([]);
    expect(stats.activeAccountCount).toBe(2); // archived excluded
    expect(stats.netWorth).toBe(0);
  });

  it("handles a single transaction", () => {
    const stats = getBudgetStats(
      [txn({ id: "t1", amount: -1200, accountId: "acc-checking", merchant: "Coffee", categoryId: "cat-groceries", datetime: "2026-04-01T10:00:00.000Z" })],
      ACCOUNTS,
      CATEGORIES,
    );
    expect(stats.transactionCount).toBe(1);
    expect(stats.earliestDate).toBe("2026-04-01");
    expect(stats.latestDate).toBe("2026-04-01");
    expect(stats.netWorth).toBe(-1200);
    expect(stats.topExpenseCategoriesYtd).toEqual([{ categoryName: "Groceries", amount: 1200 }]);
  });

  it("computes top YTD expense categories anchored on latest tx year", () => {
    const txns: Transaction[] = [
      // 2025 expenses — should be excluded from "YTD"
      txn({ id: "t-old", amount: -50000, accountId: "acc-checking", categoryId: "cat-rent", datetime: "2025-12-15T10:00:00.000Z" }),
      // 2026 expenses
      txn({ id: "t1", amount: -120000, accountId: "acc-checking", categoryId: "cat-rent", datetime: "2026-01-01T10:00:00.000Z" }),
      txn({ id: "t2", amount: -25000, accountId: "acc-checking", categoryId: "cat-groceries", datetime: "2026-02-10T10:00:00.000Z" }),
      txn({ id: "t3", amount: -5000, accountId: "acc-checking", categoryId: "", datetime: "2026-03-05T10:00:00.000Z" }),
      // income — should be excluded from expense ranking
      txn({ id: "t4", type: "income", amount: 500000, accountId: "acc-checking", categoryId: "cat-salary", datetime: "2026-01-15T10:00:00.000Z" }),
    ];
    const stats = getBudgetStats(txns, ACCOUNTS, CATEGORIES);
    expect(stats.latestDate).toBe("2026-03-05");
    expect(stats.topExpenseCategoriesYtd).toEqual([
      { categoryName: "Rent", amount: 120000 },
      { categoryName: "Groceries", amount: 25000 },
      { categoryName: "Uncategorized", amount: 5000 },
    ]);
  });
});
