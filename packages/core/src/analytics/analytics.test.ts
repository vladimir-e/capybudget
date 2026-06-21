import { describe, it, expect } from "vitest";
import {
  ensureMinMonths,
  filterTransactionsByDateRange,
  getSpendingByCategory,
  getIncomeByCategory,
  getNetWorthOverTime,
  getPeriodSummary,
  getCashFlow,
  getTopMerchants,
  getCategoryTrends,
  getMonthlyBudgetSummary,
  getCategoryHistoricalStats,
  basisMonths,
} from "./analytics";
import type { Transaction, Category, Account, BudgetBasis } from "../entities/types";
import type { DateRange } from "./analytics";

// ── Test fixtures ─────

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

const CATEGORIES: Category[] = [
  { id: "cat-food", name: "Groceries", group: "Daily Living", archived: false, sortOrder: 0, assigned: null },
  { id: "cat-rent", name: "Rent", group: "Fixed", archived: false, sortOrder: 1, assigned: null },
  { id: "cat-salary", name: "Salary", group: "Income", archived: false, sortOrder: 0, assigned: null },
  { id: "cat-freelance", name: "Freelance", group: "Income", archived: false, sortOrder: 1, assigned: null },
];

const ACCOUNTS: Account[] = [
  { id: "acc-checking", name: "Checking", type: "checking", archived: false, excludeFromNetWorth: false, sortOrder: 0, createdAt: "2026-01-01T00:00:00.000Z", currency: "USD" },
  { id: "acc-savings", name: "Savings", type: "savings", archived: false, excludeFromNetWorth: false, sortOrder: 1, createdAt: "2026-01-01T00:00:00.000Z", currency: "USD" },
  { id: "acc-archived", name: "Old Account", type: "checking", archived: true, excludeFromNetWorth: false, sortOrder: 2, createdAt: "2025-01-01T00:00:00.000Z", currency: "USD" },
];

const TRANSACTIONS: Transaction[] = [
  // January income
  txn({ id: "t1", type: "income", amount: 500000, accountId: "acc-checking", categoryId: "cat-salary", datetime: "2026-01-15T10:00:00.000Z" }),
  // January expenses
  txn({ id: "t2", amount: -120000, accountId: "acc-checking", categoryId: "cat-rent", datetime: "2026-01-01T10:00:00.000Z" }),
  txn({ id: "t3", amount: -15000, accountId: "acc-checking", categoryId: "cat-food", datetime: "2026-01-10T10:00:00.000Z" }),
  // February income
  txn({ id: "t4", type: "income", amount: 500000, accountId: "acc-checking", categoryId: "cat-salary", datetime: "2026-02-15T10:00:00.000Z" }),
  txn({ id: "t5", type: "income", amount: 50000, accountId: "acc-checking", categoryId: "cat-freelance", datetime: "2026-02-20T10:00:00.000Z" }),
  // February expenses
  txn({ id: "t6", amount: -120000, accountId: "acc-checking", categoryId: "cat-rent", datetime: "2026-02-01T10:00:00.000Z" }),
  txn({ id: "t7", amount: -22000, accountId: "acc-checking", categoryId: "cat-food", datetime: "2026-02-12T10:00:00.000Z" }),
  txn({ id: "t8", amount: -5000, accountId: "acc-checking", categoryId: "", datetime: "2026-02-18T10:00:00.000Z" }), // uncategorized
  // Transfer (should be excluded from spending/income)
  txn({ id: "t9", type: "transfer", amount: -100000, accountId: "acc-checking", transferPairId: "t10", datetime: "2026-02-25T10:00:00.000Z" }),
  txn({ id: "t10", type: "transfer", amount: 100000, accountId: "acc-savings", transferPairId: "t9", datetime: "2026-02-25T10:00:00.000Z" }),
  // March expense
  txn({ id: "t11", amount: -8000, accountId: "acc-savings", categoryId: "cat-food", datetime: "2026-03-05T10:00:00.000Z" }),
];

// ── ensureMinMonths ─────

describe("ensureMinMonths", () => {
  it("returns the original range when already >= minMonths", () => {
    const range = { start: new Date(2026, 0, 1), end: new Date(2027, 0, 1) };
    expect(ensureMinMonths(range, 12)).toBe(range);
  });

  it("extends a short range to minMonths", () => {
    const range = { start: new Date(2026, 0, 1), end: new Date(2026, 3, 1) };
    const result = ensureMinMonths(range, 12);
    expect(result.start).toEqual(new Date(2026, 0, 1));
    expect(result.end).toEqual(new Date(2027, 0, 1));
  });

  it("handles year boundaries", () => {
    const range = { start: new Date(2025, 9, 1), end: new Date(2025, 11, 1) };
    const result = ensureMinMonths(range, 12);
    expect(result.end).toEqual(new Date(2026, 9, 1));
  });
});

// ── filterTransactionsByDateRange ─────

describe("filterTransactionsByDateRange", () => {
  it("filters transactions within [start, end)", () => {
    const result = filterTransactionsByDateRange(TRANSACTIONS, {
      start: new Date("2026-02-01T00:00:00.000Z"),
      end: new Date("2026-03-01T00:00:00.000Z"),
    });
    const ids = result.map((t) => t.id).sort();
    expect(ids).toEqual(["t10", "t4", "t5", "t6", "t7", "t8", "t9"]);
  });

  it("includes start boundary, excludes end boundary", () => {
    // t2 has datetime exactly at 2026-01-01T10:00:00.000Z
    const result = filterTransactionsByDateRange(TRANSACTIONS, {
      start: new Date("2026-01-01T10:00:00.000Z"),
      end: new Date("2026-01-10T10:00:00.000Z"),
    });
    const ids = result.map((t) => t.id);
    expect(ids).toContain("t2"); // exactly at start → included
    expect(ids).not.toContain("t3"); // exactly at end → excluded
  });

  it("returns empty for empty transactions", () => {
    const result = filterTransactionsByDateRange([], {
      start: new Date("2026-01-01T00:00:00.000Z"),
      end: new Date("2026-12-31T00:00:00.000Z"),
    });
    expect(result).toEqual([]);
  });

  it("returns empty when range matches nothing", () => {
    const result = filterTransactionsByDateRange(TRANSACTIONS, {
      start: new Date("2020-01-01T00:00:00.000Z"),
      end: new Date("2020-02-01T00:00:00.000Z"),
    });
    expect(result).toEqual([]);
  });
});

// ── getSpendingByCategory ─────

describe("getSpendingByCategory", () => {
  const expenses = TRANSACTIONS.filter((t) => t.type === "expense");

  it("groups expenses by category with correct totals", () => {
    const result = getSpendingByCategory(expenses, CATEGORIES);
    const rent = result.find((r) => r.categoryId === "cat-rent");
    expect(rent).toBeDefined();
    // Two rent payments: 120000 + 120000
    expect(rent!.total).toBe(240000);
    expect(rent!.count).toBe(2);
    expect(rent!.categoryName).toBe("Rent");
    expect(rent!.group).toBe("Fixed");
  });

  it("sorts by total descending", () => {
    const result = getSpendingByCategory(expenses, CATEGORIES);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].total).toBeGreaterThanOrEqual(result[i].total);
    }
  });

  it("calculates correct percentages", () => {
    const result = getSpendingByCategory(expenses, CATEGORIES);
    const totalPct = result.reduce((s, r) => s + r.percentage, 0);
    expect(totalPct).toBeCloseTo(100, 5);
  });

  it("handles uncategorized transactions", () => {
    const result = getSpendingByCategory(expenses, CATEGORIES);
    const uncat = result.find((r) => r.categoryId === "");
    expect(uncat).toBeDefined();
    expect(uncat!.categoryName).toBe("Uncategorized");
    expect(uncat!.group).toBe("");
    expect(uncat!.total).toBe(5000);
  });

  it("excludes transfers", () => {
    // Pass ALL transactions including transfers — only expenses should appear
    const result = getSpendingByCategory(TRANSACTIONS, CATEGORIES);
    // Transfers have categoryId "" but type "transfer" — should not be counted
    // If transfers leaked in, the uncategorized total would be higher
    const uncat = result.find((r) => r.categoryId === "");
    expect(uncat!.total).toBe(5000); // only the one uncategorized expense
  });

  it("returns empty for no expenses", () => {
    const result = getSpendingByCategory([], CATEGORIES);
    expect(result).toEqual([]);
  });
});

// ── getIncomeByCategory ─────

describe("getIncomeByCategory", () => {
  it("groups income by category", () => {
    const result = getIncomeByCategory(TRANSACTIONS, CATEGORIES);
    const salary = result.find((r) => r.categoryId === "cat-salary");
    expect(salary).toBeDefined();
    // Two salary txns: 500000 + 500000
    expect(salary!.total).toBe(1000000);
    expect(salary!.count).toBe(2);
  });

  it("excludes transfers from income", () => {
    const result = getIncomeByCategory(TRANSACTIONS, CATEGORIES);
    // Transfer t10 has positive amount but type "transfer" — should not appear
    const totalCount = result.reduce((s, r) => s + r.count, 0);
    // Only income transactions: t1, t4, t5 = 3
    expect(totalCount).toBe(3);
  });

  it("returns empty for no income", () => {
    const onlyExpenses = TRANSACTIONS.filter((t) => t.type === "expense");
    const result = getIncomeByCategory(onlyExpenses, CATEGORIES);
    expect(result).toEqual([]);
  });
});

// ── getNetWorthOverTime ─────

describe("getNetWorthOverTime", () => {
  it("returns one point per month-end within the range", () => {
    const result = getNetWorthOverTime(ACCOUNTS, TRANSACTIONS, {
      start: new Date(2026, 0, 1),
      end: new Date(2026, 3, 1),
    });
    // One point per month whose first day is < end (Apr 1): Jan, Feb, Mar.
    expect(result.length).toBe(3);
    expect(result.map((p) => new Date(p.date).getMonth())).toEqual([0, 1, 2]);
  });

  it("labels each point by the month it closes, reflecting that month's transactions", () => {
    const result = getNetWorthOverTime(ACCOUNTS, TRANSACTIONS, {
      start: new Date(2026, 0, 1),
      end: new Date(2026, 3, 1),
    });

    // Jan (Jan 31): all January transactions included.
    // acc-checking: 500000 - 120000 - 15000 = 365000
    expect(new Date(result[0].date).getMonth()).toBe(0);
    expect(result[0].byAccount["acc-checking"]).toBe(365000);
    expect(result[0].byAccount["acc-savings"]).toBe(0);
    expect(result[0].netWorth).toBe(365000);

    // Feb (Feb 28): Jan + Feb transactions.
    // acc-checking: 365000 + 500000 + 50000 - 120000 - 22000 - 5000 - 100000 = 668000
    // acc-savings: 100000
    expect(new Date(result[1].date).getMonth()).toBe(1);
    expect(result[1].byAccount["acc-checking"]).toBe(668000);
    expect(result[1].byAccount["acc-savings"]).toBe(100000);
    expect(result[1].netWorth).toBe(768000);

    // Mar (Mar 31): Jan + Feb + Mar transactions.
    // acc-checking: 668000 (no new checking txns in March)
    // acc-savings: 100000 - 8000 = 92000
    expect(new Date(result[2].date).getMonth()).toBe(2);
    expect(result[2].byAccount["acc-savings"]).toBe(92000);
    expect(result[2].netWorth).toBe(668000 + 92000);
  });

  // The whole point of the month-end fix: a transaction in month M lands on M's
  // bar, never on M+1's.
  it("reflects a transaction in the SAME month's point, not the next month's", () => {
    const accounts: Account[] = [
      { id: "acc-checking", name: "Checking", type: "checking", archived: false, excludeFromNetWorth: false, sortOrder: 0, createdAt: "2023-01-01T00:00:00.000Z", currency: "USD" },
    ];
    // A single deposit in August 2023.
    const transactions: Transaction[] = [
      txn({ id: "aug", type: "income", amount: 250000, accountId: "acc-checking", datetime: "2023-08-12T10:00:00.000Z" }),
    ];
    const result = getNetWorthOverTime(accounts, transactions, {
      start: new Date(2023, 6, 1), // Jul 2023
      end: new Date(2023, 9, 1), // Oct 2023 (exclusive)
    });
    // Points: Jul, Aug, Sep.
    const jul = result.find((p) => new Date(p.date).getMonth() === 6)!;
    const aug = result.find((p) => new Date(p.date).getMonth() === 7)!;
    const sep = result.find((p) => new Date(p.date).getMonth() === 8)!;

    // July (before the deposit) is still 0 — the deposit must NOT bleed back.
    expect(jul.netWorth).toBe(0);
    // August's own bar carries the deposit.
    expect(aug.netWorth).toBe(250000);
    // September simply carries it forward (no double-count, no shift).
    expect(sep.netWorth).toBe(250000);
  });

  // For an All-Time range (end = first-of-month-after-latest, mirroring
  // computeBounds), the final point is the latest month WITH data and carries
  // the full cumulative total — no phantom trailing future-month bar.
  it("ends on the latest data month with the full total, no trailing future-month point", () => {
    const accounts: Account[] = [
      { id: "acc-checking", name: "Checking", type: "checking", archived: false, excludeFromNetWorth: false, sortOrder: 0, createdAt: "2024-01-01T00:00:00.000Z", currency: "USD" },
    ];
    const transactions: Transaction[] = [
      txn({ id: "p1", type: "income", amount: 100000, accountId: "acc-checking", datetime: "2024-05-10T10:00:00.000Z" }),
      txn({ id: "p2", type: "income", amount: 40000, accountId: "acc-checking", datetime: "2024-06-20T10:00:00.000Z" }),
    ];
    // computeBounds: start = first of earliest month, end = first-of-month-after-latest.
    const latest = new Date(2024, 5, 20); // June 2024
    const range = {
      start: new Date(2024, 4, 1), // May 2024
      end: new Date(latest.getFullYear(), latest.getMonth() + 1, 1), // Jul 1, 2024
    };
    const result = getNetWorthOverTime(accounts, transactions, range);

    // Last point is June (the latest month with data), NOT July.
    const last = result[result.length - 1];
    expect(new Date(last.date).getMonth()).toBe(5); // June
    // and it carries the full cumulative total.
    expect(last.netWorth).toBe(140000);
    // No point labeled a month after June.
    expect(result.every((p) => new Date(p.date).getMonth() <= 5)).toBe(true);
  });

  it("produces points monotonically increasing in date", () => {
    const result = getNetWorthOverTime(ACCOUNTS, TRANSACTIONS, {
      start: new Date(2026, 0, 1),
      end: new Date(2026, 3, 1),
    });
    for (let i = 1; i < result.length; i++) {
      expect(new Date(result[i].date).getTime()).toBeGreaterThan(
        new Date(result[i - 1].date).getTime(),
      );
    }
  });

  // Archiving requires a zero derived balance (DATA_MODEL referential integrity),
  // so an archived account can only ever sum to $0 across its whole history. That
  // makes it safe to include in the historical series: it shifts past points where
  // it carried a balance, but contributes nothing to the latest point. This mirrors
  // Vlad's real budget — a credit card that ran negative years ago, was paid off,
  // and then closed should pull early net worth down without touching today's total.
  it("counts an archived account's historical balance while leaving the latest point unchanged", () => {
    const accounts: Account[] = [
      { id: "acc-checking", name: "Checking", type: "checking", archived: false, excludeFromNetWorth: false, sortOrder: 0, createdAt: "2019-01-01T00:00:00.000Z", currency: "USD" },
      { id: "acc-card", name: "Old Credit Card", type: "credit_card", archived: true, excludeFromNetWorth: false, sortOrder: 1, createdAt: "2019-01-01T00:00:00.000Z", currency: "USD" },
    ];
    const transactions: Transaction[] = [
      // Card runs -500000 in January, then is paid back to zero in March.
      txn({ id: "c1", type: "expense", amount: -500000, accountId: "acc-card", datetime: "2019-01-10T10:00:00.000Z" }),
      txn({ id: "c2", type: "income", amount: 500000, accountId: "acc-card", datetime: "2019-03-10T10:00:00.000Z" }),
      // A little checking income so the latest point is non-trivially positive.
      txn({ id: "k1", type: "income", amount: 200000, accountId: "acc-checking", datetime: "2019-01-05T10:00:00.000Z" }),
    ];
    const result = getNetWorthOverTime(accounts, transactions, {
      start: new Date(2019, 0, 1),
      end: new Date(2019, 3, 1),
    });
    // Month-end points: Jan, Feb, Mar.
    const jan = result.find((p) => new Date(p.date).getMonth() === 0)!;
    const feb = result.find((p) => new Date(p.date).getMonth() === 1)!;
    const mar = result.find((p) => new Date(p.date).getMonth() === 2)!;

    // Jan-end — both Jan transactions already applied: card is live at -500000.
    // 200000 checking - 500000 card = -300000.
    expect(jan.byAccount["acc-card"]).toBe(-500000);
    expect(jan.netWorth).toBe(-300000);
    // Feb-end — nothing changed in February, still live.
    expect(feb.byAccount["acc-card"]).toBe(-500000);
    expect(feb.netWorth).toBe(-300000);
    // Mar-end — card paid off (balance $0) before being archived; total is just checking.
    expect(mar.byAccount["acc-card"]).toBe(0);
    expect(mar.netWorth).toBe(200000);
  });

  it("excludes accounts with excludeFromNetWorth=true", () => {
    const accounts = ACCOUNTS.map((a) =>
      a.id === "acc-savings" ? { ...a, excludeFromNetWorth: true } : a,
    );
    const result = getNetWorthOverTime(accounts, TRANSACTIONS, {
      start: new Date(2026, 0, 1),
      end: new Date(2026, 3, 1),
    });
    const lastPoint = result[result.length - 1];
    expect(lastPoint.byAccount["acc-savings"]).toBeUndefined();
    // Without savings, net worth at March-end is just checking's balance: 668000
    expect(lastPoint.netWorth).toBe(668000);
  });

  // The transient analytics filter passes an explicit include-set that is the
  // sole source of truth: an account the caller chose to count is counted even
  // when it carries excludeFromNetWorth.
  it("counts an excludeFromNetWorth account when it is in the include set", () => {
    const accounts: Account[] = [
      { id: "acc-checking", name: "Checking", type: "checking", archived: false, excludeFromNetWorth: false, sortOrder: 0, createdAt: "2026-01-01T00:00:00.000Z", currency: "USD" },
      { id: "acc-vault", name: "Vault", type: "asset", archived: false, excludeFromNetWorth: true, sortOrder: 1, createdAt: "2026-01-01T00:00:00.000Z", currency: "USD" },
    ];
    const transactions: Transaction[] = [
      txn({ id: "k1", type: "income", amount: 200000, accountId: "acc-checking", datetime: "2026-01-05T10:00:00.000Z" }),
      txn({ id: "v1", type: "income", amount: 50000, accountId: "acc-vault", datetime: "2026-01-10T10:00:00.000Z" }),
    ];
    const result = getNetWorthOverTime(
      accounts,
      transactions,
      { start: new Date(2026, 0, 1), end: new Date(2026, 1, 1) },
      new Set(["acc-checking", "acc-vault"]),
    );
    const jan = result[result.length - 1];
    expect(jan.byAccount["acc-vault"]).toBe(50000);
    expect(jan.netWorth).toBe(250000);
  });

  // The include-set also subtracts: an account that would otherwise be counted
  // is dropped when the caller leaves it out of the set.
  it("drops an otherwise-includable account when it is absent from the include set", () => {
    const accounts: Account[] = [
      { id: "acc-checking", name: "Checking", type: "checking", archived: false, excludeFromNetWorth: false, sortOrder: 0, createdAt: "2026-01-01T00:00:00.000Z", currency: "USD" },
      { id: "acc-savings", name: "Savings", type: "savings", archived: false, excludeFromNetWorth: false, sortOrder: 1, createdAt: "2026-01-01T00:00:00.000Z", currency: "USD" },
    ];
    const transactions: Transaction[] = [
      txn({ id: "k1", type: "income", amount: 200000, accountId: "acc-checking", datetime: "2026-01-05T10:00:00.000Z" }),
      txn({ id: "s1", type: "income", amount: 80000, accountId: "acc-savings", datetime: "2026-01-10T10:00:00.000Z" }),
    ];
    const result = getNetWorthOverTime(
      accounts,
      transactions,
      { start: new Date(2026, 0, 1), end: new Date(2026, 1, 1) },
      new Set(["acc-checking"]),
    );
    const jan = result[result.length - 1];
    expect(jan.byAccount["acc-savings"]).toBeUndefined();
    expect(jan.netWorth).toBe(200000);
  });

  // An empty include-set is "count NOTHING" — distinct from omitting the arg,
  // which is "count the default accounts". Points still emit across the range.
  it("treats an empty include set as including nothing, not as a default", () => {
    const result = getNetWorthOverTime(ACCOUNTS, TRANSACTIONS, {
      start: new Date(2026, 0, 1),
      end: new Date(2026, 3, 1),
    }, new Set());
    expect(result.length).toBe(3);
    for (const point of result) {
      expect(point.netWorth).toBe(0);
      expect(point.byAccount).toEqual({});
    }
  });

  it("returns no points for a sub-monthly range with no qualifying month", () => {
    const result = getNetWorthOverTime(ACCOUNTS, TRANSACTIONS, {
      start: new Date(2026, 1, 15),
      end: new Date(2026, 1, 16),
    });
    // cursor = Feb 1 < start (Feb 15) → advances to Mar 1, which is not < Feb 16.
    // No month qualifies → no points.
    expect(result.length).toBe(0);
  });

  it("handles empty transactions", () => {
    const result = getNetWorthOverTime(ACCOUNTS, [], {
      start: new Date(2026, 0, 1),
      end: new Date(2026, 2, 1),
    });
    expect(result.length).toBeGreaterThan(0);
    for (const point of result) {
      expect(point.netWorth).toBe(0);
    }
  });
});

// ── getPeriodSummary ─────

describe("getPeriodSummary", () => {
  it("sums income and expenses separately", () => {
    const result = getPeriodSummary(TRANSACTIONS);
    // Income: 500000 + 500000 + 50000 = 1050000
    expect(result.totalIncome).toBe(1050000);
    // Expenses: -120000 - 15000 - 120000 - 22000 - 5000 - 8000 = -290000
    expect(result.totalExpenses).toBe(-290000);
    expect(result.net).toBe(1050000 + -290000);
  });

  it("excludes transfers", () => {
    const transferOnly = TRANSACTIONS.filter((t) => t.type === "transfer");
    const result = getPeriodSummary(transferOnly);
    expect(result.totalIncome).toBe(0);
    expect(result.totalExpenses).toBe(0);
    expect(result.net).toBe(0);
  });

  it("handles empty transactions", () => {
    const result = getPeriodSummary([]);
    expect(result.totalIncome).toBe(0);
    expect(result.totalExpenses).toBe(0);
    expect(result.net).toBe(0);
  });

  it("handles single income transaction", () => {
    const single = [txn({ id: "s1", type: "income", amount: 100000, accountId: "acc-checking" })];
    const result = getPeriodSummary(single);
    expect(result.totalIncome).toBe(100000);
    expect(result.totalExpenses).toBe(0);
    expect(result.net).toBe(100000);
  });

  it("handles single expense transaction", () => {
    const single = [txn({ id: "s1", type: "expense", amount: -5000, accountId: "acc-checking" })];
    const result = getPeriodSummary(single);
    expect(result.totalIncome).toBe(0);
    expect(result.totalExpenses).toBe(-5000);
    expect(result.net).toBe(-5000);
  });
});

// ── getCashFlow ─────

describe("getCashFlow", () => {
  it("groups income and expenses by month", () => {
    const result = getCashFlow(TRANSACTIONS, {
      start: new Date(2026, 0, 1),
      end: new Date(2026, 3, 1),
    });
    // Should have Jan, Feb, Mar
    expect(result.length).toBe(3);

    // January (t1: salary 500000)
    const jan = result.find((p) => p.month === "Jan 2026")!;
    expect(jan).toBeDefined();
    expect(jan.income).toBe(500000); // t1: 500000
    expect(jan.expenses).toBe(135000); // t2: 120000 + t3: 15000
    expect(jan.net).toBe(500000 - 135000);

    // February (excludes transfers)
    const feb = result.find((p) => p.month === "Feb 2026")!;
    expect(feb).toBeDefined();
    expect(feb.income).toBe(550000); // t4: 500000 + t5: 50000
    expect(feb.expenses).toBe(147000); // t6: 120000 + t7: 22000 + t8: 5000
    expect(feb.net).toBe(550000 - 147000);

    // March
    const mar = result.find((p) => p.month === "Mar 2026")!;
    expect(mar).toBeDefined();
    expect(mar.income).toBe(0);
    expect(mar.expenses).toBe(8000); // t11
    expect(mar.net).toBe(-8000);
  });

  it("returns results sorted chronologically", () => {
    const result = getCashFlow(TRANSACTIONS, {
      start: new Date(2026, 0, 1),
      end: new Date(2026, 3, 1),
    });
    for (let i = 1; i < result.length; i++) {
      expect(new Date(result[i - 1].date).getTime()).toBeLessThan(
        new Date(result[i].date).getTime(),
      );
    }
  });

  it("returns single month when range covers one month", () => {
    const result = getCashFlow(TRANSACTIONS, {
      start: new Date(2026, 0, 1),
      end: new Date(2026, 1, 1),
    });
    expect(result.length).toBe(1);
    expect(result[0].month).toBe("Jan 2026");
  });

  it("emits zero-valued points for empty transactions", () => {
    const result = getCashFlow([], {
      start: new Date(2026, 0, 1),
      end: new Date(2027, 0, 1),
    });
    expect(result.length).toBe(12);
    for (const point of result) {
      expect(point.income).toBe(0);
      expect(point.expenses).toBe(0);
      expect(point.net).toBe(0);
    }
  });

  it("excludes transfers", () => {
    // Use only Feb range which contains transfers t9/t10
    const result = getCashFlow(TRANSACTIONS, {
      start: new Date(2026, 1, 1),
      end: new Date(2026, 2, 1),
    });
    expect(result.length).toBe(1);
    const feb = result[0];
    // Income should not include t10 (transfer +100000)
    expect(feb.income).toBe(550000);
    // Expenses should not include t9 (transfer -100000)
    expect(feb.expenses).toBe(147000);
  });

  it("only includes months within range", () => {
    const result = getCashFlow(TRANSACTIONS, {
      start: new Date(2026, 1, 1),
      end: new Date(2026, 2, 1),
    });
    // Should only have February, even though transactions exist in Jan and Mar
    expect(result.length).toBe(1);
    expect(result[0].month).toBe("Feb 2026");
  });
});

// ── getTopMerchants ─────

describe("getTopMerchants", () => {
  const merchantTxns: Transaction[] = [
    txn({ id: "m1", amount: -50000, accountId: "acc-checking", merchant: "Whole Foods" }),
    txn({ id: "m2", amount: -30000, accountId: "acc-checking", merchant: "whole foods" }), // same merchant, different case
    txn({ id: "m3", amount: -20000, accountId: "acc-checking", merchant: "Target" }),
    txn({ id: "m4", amount: -15000, accountId: "acc-checking", merchant: "Target" }),
    txn({ id: "m5", amount: -10000, accountId: "acc-checking", merchant: "" }), // empty merchant
    txn({ id: "m6", amount: -5000, accountId: "acc-checking", merchant: "  " }), // whitespace-only
    txn({ id: "m7", type: "transfer", amount: -100000, accountId: "acc-checking", merchant: "Bank Transfer", transferPairId: "m8" }),
    txn({ id: "m8", type: "transfer", amount: 100000, accountId: "acc-savings", merchant: "Bank Transfer", transferPairId: "m7" }),
    txn({ id: "m9", type: "income", amount: 500000, accountId: "acc-checking", merchant: "Employer Inc" }),
    txn({ id: "m10", amount: -8000, accountId: "acc-checking", merchant: "Starbucks" }),
  ];

  it("ranks merchants by total spending descending", () => {
    const result = getTopMerchants(merchantTxns);
    expect(result[0].merchant).toBe("Whole Foods"); // 50000 + 30000 = 80000
    expect(result[0].total).toBe(80000);
    expect(result[1].merchant).toBe("Target"); // 20000 + 15000 = 35000
    expect(result[1].total).toBe(35000);
  });

  it("merges merchants case-insensitively", () => {
    const result = getTopMerchants(merchantTxns);
    const wf = result.find((m) => m.merchant.toLowerCase() === "whole foods")!;
    expect(wf).toBeDefined();
    expect(wf.total).toBe(80000);
    expect(wf.count).toBe(2);
  });

  it("groups empty merchant as Unknown", () => {
    const result = getTopMerchants(merchantTxns);
    const unknown = result.find((m) => m.merchant === "Unknown")!;
    expect(unknown).toBeDefined();
    // Empty string + whitespace-only both become unknown
    expect(unknown.total).toBe(15000); // 10000 + 5000
    expect(unknown.count).toBe(2);
    // Flagged so consumers can route by identity rather than display string
    expect(unknown.isUnknown).toBe(true);
  });

  it("does not collide a real merchant named 'Unknown' with the empty-merchant bucket", () => {
    // Both empty AND a literal "Unknown" merchant in the same dataset
    const mixed: Transaction[] = [
      txn({ id: "x1", amount: -10000, accountId: "acc-checking", merchant: "" }),
      txn({ id: "x2", amount: -7000, accountId: "acc-checking", merchant: "Unknown" }),
      txn({ id: "x3", amount: -3000, accountId: "acc-checking", merchant: "unknown" }), // same as above (case-merge)
    ];
    const result = getTopMerchants(mixed);
    // Two separate rows: synthetic empty bucket + the real "Unknown" merchant
    const rows = result.filter((m) => m.merchant === "Unknown");
    expect(rows.length).toBe(2);

    const empty = rows.find((m) => m.isUnknown)!;
    const real = rows.find((m) => !m.isUnknown)!;
    expect(empty).toBeDefined();
    expect(real).toBeDefined();

    expect(empty.total).toBe(10000);
    expect(empty.count).toBe(1);
    // Real "Unknown" + "unknown" merge case-insensitively into one bucket
    expect(real.total).toBe(10000);
    expect(real.count).toBe(2);
  });

  it("non-empty merchants get isUnknown=false", () => {
    const result = getTopMerchants(merchantTxns);
    const wf = result.find((m) => m.merchant === "Whole Foods")!;
    expect(wf.isUnknown).toBe(false);
  });

  it("excludes transfers", () => {
    const result = getTopMerchants(merchantTxns);
    const transfer = result.find((m) => m.merchant === "Bank Transfer");
    expect(transfer).toBeUndefined();
  });

  it("excludes income", () => {
    const result = getTopMerchants(merchantTxns);
    const employer = result.find((m) => m.merchant === "Employer Inc");
    expect(employer).toBeUndefined();
  });

  it("respects the limit parameter", () => {
    const result = getTopMerchants(merchantTxns, 2);
    expect(result.length).toBe(2);
    expect(result[0].merchant).toBe("Whole Foods");
    expect(result[1].merchant).toBe("Target");
  });

  it("calculates correct percentages", () => {
    const result = getTopMerchants(merchantTxns);
    // Grand total of expenses: 50000 + 30000 + 20000 + 15000 + 10000 + 5000 + 8000 = 138000
    const grandTotal = 138000;
    const wf = result.find((m) => m.merchant.toLowerCase() === "whole foods")!;
    expect(wf.percentage).toBeCloseTo((80000 / grandTotal) * 100, 5);

    // All percentages should sum to 100
    const totalPct = result.reduce((s, r) => s + r.percentage, 0);
    expect(totalPct).toBeCloseTo(100, 5);
  });

  it("returns empty for no expenses", () => {
    const incomeOnly = merchantTxns.filter((t) => t.type === "income");
    const result = getTopMerchants(incomeOnly);
    expect(result).toEqual([]);
  });

  it("returns empty for empty transactions", () => {
    const result = getTopMerchants([]);
    expect(result).toEqual([]);
  });
});

// ── getCategoryTrends ─────

describe("getCategoryTrends", () => {
  const range = {
    start: new Date("2026-01-01T00:00:00.000Z"),
    end: new Date("2026-04-01T00:00:00.000Z"),
  };

  it("returns top-N expense categories sorted by total when no categoryIds given", () => {
    const result = getCategoryTrends(TRANSACTIONS, CATEGORIES, range, { limit: 5 });
    // Expense totals in range:
    //   cat-rent   = 240000 (Jan + Feb)
    //   cat-food   =  45000 (Jan + Feb + Mar)
    //   uncat ("") =   5000 (Feb)
    expect(result.series.map((s) => s.categoryName)).toEqual(["Rent", "Groceries", "Uncategorized"]);
    expect(result.series[0].total).toBe(240000);
    expect(result.series[1].total).toBe(45000);
    expect(result.series[2].total).toBe(5000);
  });

  it("respects the limit parameter for top-N mode", () => {
    const result = getCategoryTrends(TRANSACTIONS, CATEGORIES, range, { limit: 1 });
    expect(result.series.length).toBe(1);
    expect(result.series[0].categoryId).toBe("cat-rent");
  });

  it("excludes transfers from totals and points", () => {
    const result = getCategoryTrends(TRANSACTIONS, CATEGORIES, range);
    // No category id matches a transfer, but make sure no spurious entries leaked in.
    // Zero-valued entries are normal (continuous X-axis fills empty periods).
    for (const point of result.points) {
      for (const amt of Object.values(point.byCategory)) {
        expect(amt).toBeGreaterThanOrEqual(0);
      }
    }
    const total = result.series.reduce((s, x) => s + x.total, 0);
    expect(total).toBe(240000 + 45000 + 5000);
  });

  it("supports income mode", () => {
    const result = getCategoryTrends(TRANSACTIONS, CATEGORIES, range, { type: "income" });
    const salary = result.series.find((s) => s.categoryId === "cat-salary")!;
    expect(salary).toBeDefined();
    // Salary income within range: t1 (500000) + t4 (500000) = 1000000
    expect(salary.total).toBe(1000000);
  });

  it("returns empty series for periods with no matching transactions", () => {
    const result = getCategoryTrends(TRANSACTIONS, CATEGORIES, {
      start: new Date("2020-01-01T00:00:00.000Z"),
      end: new Date("2020-12-31T00:00:00.000Z"),
    });
    // No transactions in range → no categories selected → no series, no points
    expect(result.series).toEqual([]);
    expect(result.points).toEqual([]);
  });

  it("orders points chronologically", () => {
    const result = getCategoryTrends(TRANSACTIONS, CATEGORIES, range);
    for (let i = 1; i < result.points.length; i++) {
      expect(new Date(result.points[i - 1].date).getTime()).toBeLessThan(
        new Date(result.points[i].date).getTime(),
      );
    }
  });

  describe("with explicit categoryIds", () => {
    it("returns exactly the requested categories in the given order", () => {
      const result = getCategoryTrends(TRANSACTIONS, CATEGORIES, range, {
        categoryIds: ["cat-food", "cat-rent"],
      });
      expect(result.series.map((s) => s.categoryId)).toEqual(["cat-food", "cat-rent"]);
      expect(result.series[0].categoryName).toBe("Groceries");
      expect(result.series[1].categoryName).toBe("Rent");
    });

    it("includes categories with zero spending in range as series entries", () => {
      // cat-freelance is income, not expense — zero in expense mode
      const result = getCategoryTrends(TRANSACTIONS, CATEGORIES, range, {
        type: "expense",
        categoryIds: ["cat-rent", "cat-freelance"],
      });
      expect(result.series.length).toBe(2);
      const freelance = result.series.find((s) => s.categoryId === "cat-freelance")!;
      expect(freelance).toBeDefined();
      expect(freelance.total).toBe(0);
    });

    it("ignores categories not in the requested list when building points", () => {
      const result = getCategoryTrends(TRANSACTIONS, CATEGORIES, range, {
        categoryIds: ["cat-rent"],
      });
      for (const point of result.points) {
        const keys = Object.keys(point.byCategory);
        // Only cat-rent should ever appear as a key
        for (const k of keys) {
          expect(k).toBe("cat-rent");
        }
      }
    });

    it("supports the uncategorized pseudo-id (empty string)", () => {
      const result = getCategoryTrends(TRANSACTIONS, CATEGORIES, range, {
        categoryIds: [""],
      });
      expect(result.series.length).toBe(1);
      expect(result.series[0].categoryId).toBe("");
      expect(result.series[0].categoryName).toBe("Uncategorized");
      expect(result.series[0].total).toBe(5000);
      // The point for Feb should carry the uncategorized amount under the "" key
      const feb = result.points.find((p) => p.month === "Feb 2026")!;
      expect(feb.byCategory[""]).toBe(5000);
    });

    it("emits zero-filled points when no in-range transactions match selected categories", () => {
      const result = getCategoryTrends(TRANSACTIONS, CATEGORIES, {
        start: new Date(2020, 0, 1),
        end: new Date(2020, 12, 1),
      }, { categoryIds: ["cat-rent"] });
      // Series present (explicitly requested) but with zero total
      expect(result.series.length).toBe(1);
      expect(result.series[0].total).toBe(0);
      // Continuous X-axis: one point per month, all zero-filled
      expect(result.points.length).toBe(12);
      for (const point of result.points) {
        expect(point.byCategory["cat-rent"]).toBe(0);
      }
    });

    it("takes precedence over limit when both are provided", () => {
      const result = getCategoryTrends(TRANSACTIONS, CATEGORIES, range, {
        limit: 1,
        categoryIds: ["cat-food", "cat-rent"],
      });
      // limit is ignored — both requested categories are returned
      expect(result.series.map((s) => s.categoryId)).toEqual(["cat-food", "cat-rent"]);
    });

    // T1: empty list short-circuit — no work, no series, no points.
    it("short-circuits to empty result when categoryIds is empty", () => {
      const result = getCategoryTrends(TRANSACTIONS, CATEGORIES, range, {
        categoryIds: [],
      });
      expect(result.points).toEqual([]);
      expect(result.series).toEqual([]);
    });

    // T2: unknown ids dropped silently — better than emitting a bogus
    // "Uncategorized"-labelled series for an id that simply doesn't exist.
    it("silently drops unknown category ids", () => {
      const result = getCategoryTrends(TRANSACTIONS, CATEGORIES, range, {
        categoryIds: ["cat-rent", "cat-does-not-exist", "cat-food"],
      });
      expect(result.series.map((s) => s.categoryId)).toEqual(["cat-rent", "cat-food"]);
      // Make sure no synthetic Uncategorized leaked in.
      expect(result.series.find((s) => s.categoryId === "")).toBeUndefined();
    });

    // T3: dedupe duplicates — caller order preserved, only first occurrence kept.
    it("deduplicates repeated category ids", () => {
      const result = getCategoryTrends(TRANSACTIONS, CATEGORIES, range, {
        categoryIds: ["cat-rent", "cat-food", "cat-rent", "cat-food"],
      });
      expect(result.series.map((s) => s.categoryId)).toEqual(["cat-rent", "cat-food"]);
      // And the byCategory points should also carry one entry per series.
      for (const point of result.points) {
        const keys = Object.keys(point.byCategory);
        expect(new Set(keys).size).toBe(keys.length);
      }
    });
  });

  describe("weekly granularity", () => {
    // 3-month range: Jan–Mar 2026, ~13 weeks
    const weekRange = {
      start: new Date(2026, 0, 1),
      end: new Date(2026, 3, 1),
    };

    it("produces weekly labels like 'Jan 5' instead of 'Jan 2026'", () => {
      const result = getCategoryTrends(TRANSACTIONS, CATEGORIES, weekRange, {
        categoryIds: ["cat-food"],
        granularity: "week",
      });
      expect(result.points.length).toBeGreaterThan(3);
      for (const p of result.points) {
        expect(p.month).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
      }
    });

    it("produces more points than monthly for the same range", () => {
      const monthly = getCategoryTrends(TRANSACTIONS, CATEGORIES, weekRange, {
        categoryIds: ["cat-food"],
        granularity: "month",
      });
      const weekly = getCategoryTrends(TRANSACTIONS, CATEGORIES, weekRange, {
        categoryIds: ["cat-food"],
        granularity: "week",
      });
      expect(weekly.points.length).toBeGreaterThan(monthly.points.length);
    });

    it("totals match between monthly and weekly", () => {
      const monthly = getCategoryTrends(TRANSACTIONS, CATEGORIES, weekRange, {
        categoryIds: ["cat-food"],
        granularity: "month",
      });
      const weekly = getCategoryTrends(TRANSACTIONS, CATEGORIES, weekRange, {
        categoryIds: ["cat-food"],
        granularity: "week",
      });
      const monthlySum = monthly.points.reduce((s, p) => s + (p.byCategory["cat-food"] ?? 0), 0);
      const weeklySum = weekly.points.reduce((s, p) => s + (p.byCategory["cat-food"] ?? 0), 0);
      expect(weeklySum).toBe(monthlySum);
    });
  });
});

// ── getMonthlyBudgetSummary ─────

describe("getMonthlyBudgetSummary", () => {
  // Fixtures local to this suite — the global ones are tuned for other tests.
  const FEB: { start: Date; end: Date } = {
    start: new Date("2026-02-01T00:00:00.000Z"),
    end: new Date("2026-03-01T00:00:00.000Z"),
  };

  const cats: Category[] = [
    // Income (excluded entirely)
    { id: "income-pay", name: "Paycheck", group: "Income", archived: false, sortOrder: 0, assigned: 500000 },
    // Tracked
    { id: "fixed-rent", name: "Rent", group: "Fixed", archived: false, sortOrder: 0, assigned: 200000 },
    { id: "fixed-utils", name: "Utilities", group: "Fixed", archived: false, sortOrder: 1, assigned: 15000 },
    { id: "daily-food", name: "Groceries", group: "Daily Living", archived: false, sortOrder: 0, assigned: 60000 },
    // Tracked-at-zero
    { id: "personal-fun", name: "Fun", group: "Personal", archived: false, sortOrder: 0, assigned: 0 },
    // Untracked (assigned: null)
    { id: "daily-coffee", name: "Coffee", group: "Daily Living", archived: false, sortOrder: 1, assigned: null },
    { id: "personal-clothing", name: "Clothing", group: "Personal", archived: false, sortOrder: 1, assigned: null },
    // Archived — must be excluded from rows entirely
    { id: "old", name: "Legacy", group: "Personal", archived: true, sortOrder: 99, assigned: 50000 },
  ];

  const txns: Transaction[] = [
    // February expenses — tracked
    { id: "f1", datetime: "2026-02-01T10:00:00.000Z", type: "expense", amount: -200000, categoryId: "fixed-rent", accountId: "acc-1", transferPairId: "", merchant: "", note: "", createdAt: "" },
    { id: "f2", datetime: "2026-02-10T10:00:00.000Z", type: "expense", amount: -45000, categoryId: "daily-food", accountId: "acc-1", transferPairId: "", merchant: "", note: "", createdAt: "" },
    { id: "f3", datetime: "2026-02-20T10:00:00.000Z", type: "expense", amount: -25000, categoryId: "daily-food", accountId: "acc-1", transferPairId: "", merchant: "", note: "", createdAt: "" },
    // Tracked-at-zero with spend → should show in tracked totals as overage
    { id: "f4", datetime: "2026-02-15T10:00:00.000Z", type: "expense", amount: -5000, categoryId: "personal-fun", accountId: "acc-1", transferPairId: "", merchant: "", note: "", createdAt: "" },
    // Untracked spend — counts toward "Other Spending" only
    { id: "f5", datetime: "2026-02-05T10:00:00.000Z", type: "expense", amount: -3500, categoryId: "daily-coffee", accountId: "acc-1", transferPairId: "", merchant: "", note: "", createdAt: "" },
    { id: "f6", datetime: "2026-02-22T10:00:00.000Z", type: "expense", amount: -8000, categoryId: "personal-clothing", accountId: "acc-1", transferPairId: "", merchant: "", note: "", createdAt: "" },
    // Income — excluded from spent totals
    { id: "f7", datetime: "2026-02-15T10:00:00.000Z", type: "income", amount: 500000, categoryId: "income-pay", accountId: "acc-1", transferPairId: "", merchant: "", note: "", createdAt: "" },
    // Transfer — excluded
    { id: "f8", datetime: "2026-02-25T10:00:00.000Z", type: "transfer", amount: -100000, categoryId: "", accountId: "acc-1", transferPairId: "f9", merchant: "", note: "", createdAt: "" },
    { id: "f9", datetime: "2026-02-25T10:00:00.000Z", type: "transfer", amount: 100000, categoryId: "", accountId: "acc-2", transferPairId: "f8", merchant: "", note: "", createdAt: "" },
    // Out-of-range expense (January) — excluded
    { id: "j1", datetime: "2026-01-15T10:00:00.000Z", type: "expense", amount: -999999, categoryId: "fixed-rent", accountId: "acc-1", transferPairId: "", merchant: "", note: "", createdAt: "" },
    // Uncategorized expense — excluded from rows (no categoryId)
    { id: "u1", datetime: "2026-02-12T10:00:00.000Z", type: "expense", amount: -1234, categoryId: "", accountId: "acc-1", transferPairId: "", merchant: "", note: "", createdAt: "" },
  ];

  it("returns rows for every non-archived, non-Income category", () => {
    const result = getMonthlyBudgetSummary(txns, cats, FEB);
    const ids = result.rows.map((r) => r.categoryId).sort();
    expect(ids).toEqual([
      "daily-coffee",
      "daily-food",
      "fixed-rent",
      "fixed-utils",
      "personal-clothing",
      "personal-fun",
    ]);
  });

  it("excludes Income group entirely", () => {
    const result = getMonthlyBudgetSummary(txns, cats, FEB);
    expect(result.rows.find((r) => r.categoryId === "income-pay")).toBeUndefined();
  });

  it("excludes archived categories", () => {
    const result = getMonthlyBudgetSummary(txns, cats, FEB);
    expect(result.rows.find((r) => r.categoryId === "old")).toBeUndefined();
  });

  it("sums spent per category from expense transactions only, in range", () => {
    const result = getMonthlyBudgetSummary(txns, cats, FEB);
    const byId = new Map(result.rows.map((r) => [r.categoryId, r.spent]));

    expect(byId.get("fixed-rent")).toBe(200000); // out-of-range January excluded
    expect(byId.get("daily-food")).toBe(70000); // 45000 + 25000
    expect(byId.get("daily-coffee")).toBe(3500);
    expect(byId.get("personal-clothing")).toBe(8000);
    expect(byId.get("personal-fun")).toBe(5000); // tracked-at-zero with spend
    expect(byId.get("fixed-utils")).toBe(0); // no spend in Feb
  });

  it("preserves the assigned value through to rows (null and integer)", () => {
    const result = getMonthlyBudgetSummary(txns, cats, FEB);
    const byId = new Map(result.rows.map((r) => [r.categoryId, r.assigned]));

    expect(byId.get("fixed-rent")).toBe(200000);
    expect(byId.get("personal-fun")).toBe(0); // tracked-at-zero
    expect(byId.get("daily-coffee")).toBeNull(); // untracked
  });

  it("ignores income transactions, transfers, and out-of-range entries", () => {
    const result = getMonthlyBudgetSummary(txns, cats, FEB);
    const byId = new Map(result.rows.map((r) => [r.categoryId, r.spent]));
    // If income (f7), transfers (f8/f9), or the January expense (j1) leaked
    // through, these per-category sums would shift — they don't.
    expect(byId.get("fixed-rent")).toBe(200000); // j1's January -999999 excluded
    expect(byId.get("daily-coffee")).toBe(3500);
    expect(byId.get("personal-clothing")).toBe(8000);
  });

  it("ignores uncategorized expenses (no categoryId)", () => {
    // The uncategorized $12.34 in February must not surface anywhere — there is
    // no row for it, and it must not be folded into any categorized row's spend.
    const result = getMonthlyBudgetSummary(txns, cats, FEB);
    expect(result.rows.find((r) => r.categoryId === "")).toBeUndefined();
    const totalSpent = result.rows.reduce((s, r) => s + r.spent, 0);
    expect(totalSpent).toBe(286500); // 200000 + 70000 + 5000 + 3500 + 8000, no 1234
  });

  it("returns zero spend for every row when no transactions in range", () => {
    const result = getMonthlyBudgetSummary([], cats, FEB);
    for (const r of result.rows) {
      expect(r.spent).toBe(0);
    }
  });
});

// ── getCategoryHistoricalStats ─────

describe("getCategoryHistoricalStats", () => {
  // Viewed month = April 2026. History is Jan/Feb/Mar; the immediately
  // preceding month is March.
  //
  // Ranges and datetimes use *local* constructors (`new Date(y, m, d)`),
  // matching how the analytics store builds month ranges in production
  // (`new Date(now.getFullYear(), now.getMonth(), 1)`). A UTC literal like
  // `"2026-04-01T00:00:00Z"` would not round-trip through `.getMonth()` in a
  // non-UTC timezone, shifting the viewed month — a test-only artifact the
  // real app never hits.
  const APRIL: DateRange = {
    start: new Date(2026, 3, 1),
    end: new Date(2026, 4, 1),
  };
  const iso = (y: number, m: number, d: number) =>
    new Date(y, m, d, 10, 0, 0).toISOString();

  const cats: Category[] = [
    { id: "food", name: "Groceries", group: "Daily Living", archived: false, sortOrder: 0, assigned: null },
    { id: "rent", name: "Rent", group: "Fixed", archived: false, sortOrder: 0, assigned: null },
    { id: "fun", name: "Fun", group: "Personal", archived: false, sortOrder: 0, assigned: null },
    // Income — excluded entirely
    { id: "pay", name: "Paycheck", group: "Income", archived: false, sortOrder: 0, assigned: null },
    // Archived — excluded entirely
    { id: "old", name: "Legacy", group: "Personal", archived: true, sortOrder: 9, assigned: null },
  ];

  const expense = (
    o: Pick<Transaction, "id" | "amount" | "categoryId" | "datetime"> & Partial<Transaction>,
  ): Transaction => ({
    type: "expense",
    accountId: "acc-1",
    transferPairId: "",
    merchant: "",
    note: "",
    createdAt: "",
    ...o,
  });

  const txns: Transaction[] = [
    // food: Jan 10000, Feb 20000, Mar 30000  → last=30000, avg3=(60000)/3=20000
    expense({ id: "a", amount: -10000, categoryId: "food", datetime: iso(2026, 0, 15) }),
    expense({ id: "b", amount: -20000, categoryId: "food", datetime: iso(2026, 1, 15) }),
    expense({ id: "c", amount: -30000, categoryId: "food", datetime: iso(2026, 2, 15) }),
    // rent: only Jan 120000 → last(Mar)=0, avg3=120000/1 active=120000 → implicit=max(0,120000)=120000
    expense({ id: "d", amount: -120000, categoryId: "rent", datetime: iso(2026, 0, 1) }),
    // fun: only the viewed month (April) — must be excluded from history
    expense({ id: "e", amount: -50000, categoryId: "fun", datetime: iso(2026, 3, 5) }),
    // income + archived-category spend in history — must be ignored
    expense({ id: "f", amount: 500000, categoryId: "pay", datetime: iso(2026, 2, 1), type: "income" }),
    expense({ id: "g", amount: -9999, categoryId: "old", datetime: iso(2026, 2, 1) }),
    // uncategorized expense in history — must be ignored
    expense({ id: "h", amount: -1234, categoryId: "", datetime: iso(2026, 2, 2) }),
  ];

  it("computes lastMonth from the full calendar month before the viewed month", () => {
    const { byCategory } = getCategoryHistoricalStats(txns, cats, APRIL);
    expect(byCategory.get("food")!.lastMonth).toBe(30000); // March
    expect(byCategory.get("rent")!.lastMonth).toBe(0); // no March spend
  });

  it("averages reference over the active (non-zero) months only", () => {
    const { byCategory } = getCategoryHistoricalStats(txns, cats, APRIL);
    expect(byCategory.get("food")!.reference).toBe(20000); // (10000+20000+30000)/3 active
    expect(byCategory.get("rent")!.reference).toBe(120000); // 120000/1 active month
  });

  it("sets implicitTarget to max(lastMonth, reference)", () => {
    const { byCategory } = getCategoryHistoricalStats(txns, cats, APRIL);
    expect(byCategory.get("food")!.implicitTarget).toBe(30000); // max(30000, 20000)
    expect(byCategory.get("rent")!.implicitTarget).toBe(120000); // max(0, 120000)
  });

  it("excludes the viewed month and later from history", () => {
    const { byCategory } = getCategoryHistoricalStats(txns, cats, APRIL);
    // `fun` only has April (viewed) spend — no history, so it tracks at the
    // dataset's history depth but reads 0 / 0.
    const fun = byCategory.get("fun")!;
    expect(fun.lastMonth).toBe(0);
    expect(fun.reference).toBe(0);
  });

  it("gives a dormant category (no trailing-window spend) a null target even when the dataset has history", () => {
    // `fun` only spent in the viewed month; food & rent give the dataset
    // plenty of prior history. `fun` still has no basis for a target → null,
    // so its bar stays neutral rather than going red on the first dollar.
    const { byCategory } = getCategoryHistoricalStats(txns, cats, APRIL);
    const fun = byCategory.get("fun")!;
    expect(fun.lastMonth).toBe(0);
    expect(fun.reference).toBe(0);
    expect(fun.implicitTarget).toBeNull();
  });

  it("excludes a zero-spend prior month from the average divisor", () => {
    // rent spent only in January; Feb and Mar are inactive, so the average is
    // over the one active month (120000/1), not the whole window (120000/3).
    const { byCategory } = getCategoryHistoricalStats(txns, cats, APRIL);
    expect(byCategory.get("rent")!.reference).toBe(120000);
  });

  it("averages Vlad's worked examples over active months", () => {
    // Single category viewed in April; vary spend across Jan/Feb/Mar.
    const c: Category[] = [
      { id: "x", name: "X", group: "Fixed", archived: false, sortOrder: 0, assigned: null },
    ];
    const mar = (n: number) => expense({ id: "m", amount: -n, categoryId: "x", datetime: iso(2026, 2, 12) });
    const feb = (n: number) => expense({ id: "f", amount: -n, categoryId: "x", datetime: iso(2026, 1, 12) });
    const jan = (n: number) => expense({ id: "j", amount: -n, categoryId: "x", datetime: iso(2026, 0, 12) });

    // $400, 0, 0 → one active month → $400.
    expect(
      getCategoryHistoricalStats([mar(40000)], c, APRIL).byCategory.get("x")!.reference,
    ).toBe(40000);
    // $200, $400, 0 → two active months → $600 / 2 = $300.
    expect(
      getCategoryHistoricalStats([feb(20000), mar(40000)], c, APRIL).byCategory.get("x")!.reference,
    ).toBe(30000);
    // All three $0 (no spend at all) → 0 → null target, untargeted.
    const empty = getCategoryHistoricalStats([], c, APRIL).byCategory.get("x")!;
    expect(empty.reference).toBe(0);
    expect(empty.implicitTarget).toBeNull();
    // Guard the divisor isn't a fixed 3: $200 + $400 over two active months
    // would be $200 under /3, but is $300 under /activeCount.
    expect(
      getCategoryHistoricalStats([jan(20000), feb(40000)], c, APRIL).byCategory.get("x")!.reference,
    ).not.toBe(20000);
  });

  it("rounds reference to integer cents", () => {
    // Three active months summing to 30001 → 30001/3 = 10000.33.
    const c: Category[] = [{ id: "x", name: "X", group: "Fixed", archived: false, sortOrder: 0, assigned: null }];
    const t = [
      expense({ id: "x1", amount: -10000, categoryId: "x", datetime: iso(2026, 0, 10) }),
      expense({ id: "x2", amount: -10000, categoryId: "x", datetime: iso(2026, 1, 10) }),
      expense({ id: "x3", amount: -10001, categoryId: "x", datetime: iso(2026, 2, 10) }),
    ];
    const { byCategory } = getCategoryHistoricalStats(t, c, APRIL);
    expect(byCategory.get("x")!.reference).toBe(10000); // round(10000.33)
    expect(Number.isInteger(byCategory.get("x")!.reference)).toBe(true);
  });

  it("excludes Income and archived categories from the result", () => {
    const { byCategory } = getCategoryHistoricalStats(txns, cats, APRIL);
    expect(byCategory.has("pay")).toBe(false);
    expect(byCategory.has("old")).toBe(false);
    expect([...byCategory.keys()].sort()).toEqual(["food", "fun", "rent"]);
  });

  it("ignores income, archived-category, and uncategorized spend in history", () => {
    const { byCategory } = getCategoryHistoricalStats(txns, cats, APRIL);
    // If any of those leaked, food/rent targets would shift — assert the
    // clean values hold.
    expect(byCategory.get("food")!.implicitTarget).toBe(30000);
    expect(byCategory.get("rent")!.implicitTarget).toBe(120000);
  });

  it("returns null implicitTarget for every row when there is no history", () => {
    // Only the viewed month has spend → no trailing-window basis for any
    // category, so every target is null.
    const onlyViewed = [
      expense({ id: "v1", amount: -50000, categoryId: "food", datetime: iso(2026, 3, 10) }),
    ];
    const { byCategory } = getCategoryHistoricalStats(onlyViewed, cats, APRIL);
    for (const stat of byCategory.values()) {
      expect(stat.lastMonth).toBe(0);
      expect(stat.reference).toBe(0);
      expect(stat.implicitTarget).toBeNull();
    }
  });

  it("returns null targets when there are no transactions at all", () => {
    const { byCategory } = getCategoryHistoricalStats([], cats, APRIL);
    expect(byCategory.get("food")!.implicitTarget).toBeNull();
  });

  it("looks back from the viewed month, not from today, when viewing a past month", () => {
    // View February 2026. History is the months before Feb → only January
    // counts; March (which is AFTER Feb) must be excluded even though it has
    // food spend in the fixture.
    const FEB: DateRange = {
      start: new Date(2026, 1, 1),
      end: new Date(2026, 2, 1),
    };
    const { byCategory } = getCategoryHistoricalStats(txns, cats, FEB);
    const food = byCategory.get("food")!;
    expect(food.lastMonth).toBe(10000); // January, not March
    expect(food.reference).toBe(10000); // 10000/1 active month (Mar excluded as post-Feb)
    expect(food.implicitTarget).toBe(10000); // max(10000, 10000)
  });

  describe("comparison basis", () => {
    // One category, viewed Jan 2026, with spend in each of the 12 prior
    // months (Jan–Dec 2025). Picking distinct values lets each window's
    // average pin down exactly which months it summed.
    const oneCat: Category[] = [
      { id: "x", name: "X", group: "Fixed", archived: false, sortOrder: 0, assigned: null },
    ];
    const JAN_2026: DateRange = {
      start: new Date(2026, 0, 1),
      end: new Date(2026, 1, 1),
    };
    // monthIndex 0..11 → spend (1000 * (monthIndex + 1)) cents in 2025.
    const trailingYear: Transaction[] = Array.from({ length: 12 }, (_, m) =>
      expense({
        id: `m${m}`,
        amount: -((m + 1) * 1000),
        categoryId: "x",
        datetime: iso(2025, m, 15),
      }),
    );
    const ref = (basis: BudgetBasis | undefined, t: Transaction[] = trailingYear) =>
      getCategoryHistoricalStats(t, oneCat, JAN_2026, basis).byCategory.get("x")!.reference;

    it("defaults to trailing3 — omitting basis equals passing it explicitly", () => {
      // Dec/Nov/Oct 2025 = 12000/11000/10000 → mean 11000.
      expect(ref(undefined)).toBe(11000);
      expect(ref(undefined)).toBe(ref("trailing3"));
    });

    it("trailing6 averages the six full months before the viewed month", () => {
      // Jul–Dec 2025 = 7000..12000 → (7+8+9+10+11+12)*1000/6 = 9500.
      expect(ref("trailing6")).toBe(9500);
    });

    it("trailing12 averages the twelve full months before the viewed month", () => {
      // Jan–Dec 2025 = 1000..12000 → sum 78000 / 12 = 6500.
      expect(ref("trailing12")).toBe(6500);
    });

    it("sameMonthLastYear uses the single month exactly 12 months back", () => {
      // Viewed Jan 2026 → Jan 2025 only = 1000.
      expect(ref("sameMonthLastYear")).toBe(1000);
    });

    it("sameMonthLastYear is seasonal: viewing Dec 2025 references Dec 2024", () => {
      const DEC_2025: DateRange = {
        start: new Date(2025, 11, 1),
        end: new Date(2026, 0, 1),
      };
      const t = [
        expense({ id: "dec24", amount: -77000, categoryId: "x", datetime: iso(2024, 11, 10) }),
        // A nearer month that the trailing windows would catch but the
        // seasonal basis must ignore.
        expense({ id: "nov25", amount: -5000, categoryId: "x", datetime: iso(2025, 10, 10) }),
      ];
      const stats = getCategoryHistoricalStats(t, oneCat, DEC_2025, "sameMonthLastYear");
      expect(stats.byCategory.get("x")!.reference).toBe(77000); // Dec 2024, not Nov 2025
    });

    it("sameMonthLastYear yields 0 when that one month had no spend", () => {
      // Use a dataset whose only spend is adjacent to the target month, so the
      // target month itself is $0.
      const t = [
        expense({ id: "near", amount: -9000, categoryId: "x", datetime: iso(2025, 1, 10) }), // Feb 2025
      ];
      // Viewed Jan 2026 → references Jan 2025, which is empty here.
      const stat = getCategoryHistoricalStats(t, oneCat, JAN_2026, "sameMonthLastYear").byCategory.get("x")!;
      expect(stat.reference).toBe(0);
      expect(stat.implicitTarget).toBeNull();
    });

    it("applies the active-months rule within a longer window", () => {
      // Spend in only two of the trailing six months (Aug + Dec 2025); the
      // four silent months must not dilute the divisor.
      const t = [
        expense({ id: "aug", amount: -20000, categoryId: "x", datetime: iso(2025, 7, 10) }),
        expense({ id: "dec", amount: -40000, categoryId: "x", datetime: iso(2025, 11, 10) }),
      ];
      // (20000 + 40000) / 2 active = 30000, not /6 = 10000.
      expect(ref("trailing6", t)).toBe(30000);
    });

    it("leaves lastMonth basis-independent — always the month before viewed", () => {
      // Whatever the basis, lastMonth is Dec 2025 = 12000 here.
      const last = (basis: BudgetBasis) =>
        getCategoryHistoricalStats(trailingYear, oneCat, JAN_2026, basis).byCategory.get("x")!.lastMonth;
      expect(last("trailing3")).toBe(12000);
      expect(last("trailing12")).toBe(12000);
      expect(last("sameMonthLastYear")).toBe(12000);
    });
  });
});

describe("basisMonths", () => {
  const viewed = new Date(2026, 0, 1); // Jan 2026

  it("trailing3 → the three full months before viewed, newest first", () => {
    expect(basisMonths("trailing3", viewed)).toEqual(["2025-12", "2025-11", "2025-10"]);
  });

  it("trailing6 → six months before viewed", () => {
    expect(basisMonths("trailing6", viewed)).toEqual([
      "2025-12", "2025-11", "2025-10", "2025-09", "2025-08", "2025-07",
    ]);
  });

  it("trailing12 → twelve months before viewed, spanning the year boundary", () => {
    expect(basisMonths("trailing12", viewed)).toEqual([
      "2025-12", "2025-11", "2025-10", "2025-09", "2025-08", "2025-07",
      "2025-06", "2025-05", "2025-04", "2025-03", "2025-02", "2025-01",
    ]);
  });

  it("sameMonthLastYear → a single month exactly 12 months back", () => {
    expect(basisMonths("sameMonthLastYear", viewed)).toEqual(["2025-01"]);
  });

  it("handles a mid-year viewed month", () => {
    const may = new Date(2026, 4, 1); // May 2026
    expect(basisMonths("trailing3", may)).toEqual(["2026-04", "2026-03", "2026-02"]);
    expect(basisMonths("sameMonthLastYear", may)).toEqual(["2025-05"]);
  });
});
