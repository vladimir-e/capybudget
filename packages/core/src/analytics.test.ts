import { describe, it, expect } from "vitest";
import {
  filterTransactionsByDateRange,
  getSpendingByCategory,
  getIncomeByCategory,
  getNetWorthOverTime,
  getPeriodSummary,
  getCashFlow,
  getTopMerchants,
  getCategoryTrends,
  getMonthlyBudgetSummary,
} from "./analytics";
import type { Transaction, Category, Account } from "./types";

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
  { id: "acc-checking", name: "Checking", type: "checking", archived: false, excludeFromNetWorth: false, sortOrder: 0, createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "acc-savings", name: "Savings", type: "savings", archived: false, excludeFromNetWorth: false, sortOrder: 1, createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "acc-archived", name: "Old Account", type: "checking", archived: true, excludeFromNetWorth: false, sortOrder: 2, createdAt: "2025-01-01T00:00:00.000Z" },
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
  // Transaction on archived account (for net worth test)
  txn({ id: "t12", type: "income", amount: 99999, accountId: "acc-archived", categoryId: "cat-salary", datetime: "2026-01-01T10:00:00.000Z" }),
];

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
    // Three salary txns: 500000 + 500000 + 99999
    expect(salary!.total).toBe(1099999);
    expect(salary!.count).toBe(3);
  });

  it("excludes transfers from income", () => {
    const result = getIncomeByCategory(TRANSACTIONS, CATEGORIES);
    // Transfer t10 has positive amount but type "transfer" — should not appear
    const totalCount = result.reduce((s, r) => s + r.count, 0);
    // Only income transactions: t1, t4, t5, t12 = 4
    expect(totalCount).toBe(4);
  });

  it("returns empty for no income", () => {
    const onlyExpenses = TRANSACTIONS.filter((t) => t.type === "expense");
    const result = getIncomeByCategory(onlyExpenses, CATEGORIES);
    expect(result).toEqual([]);
  });
});

// ── getNetWorthOverTime ─────

describe("getNetWorthOverTime", () => {
  it("returns one point per month plus end date", () => {
    const result = getNetWorthOverTime(ACCOUNTS, TRANSACTIONS, {
      start: new Date("2026-01-01T00:00:00.000Z"),
      end: new Date("2026-04-01T00:00:00.000Z"),
    });
    // Month boundaries: Jan 1, Feb 1, Mar 1, Apr 1 (which is also end)
    // Since start is exactly Jan 1 and end is Apr 1, we get: Feb 1, Mar 1, Apr 1
    // Actually start IS a month boundary, so cursor starts at Jan 1, advances to Feb 1
    // Dates: Feb 1, Mar 1, Apr 1 (end date)
    // Wait — cursor starts at Jan 1 (first of month of start). Jan 1 >= Jan 1? No, not <.
    // cursor = Jan 1, start = Jan 1. cursor < start? No (equal). So no advance.
    // cursor < end? Jan 1 < Apr 1 → yes. Push Jan 1, advance to Feb 1.
    // Feb 1 < Apr 1 → push Feb 1, advance to Mar 1.
    // Mar 1 < Apr 1 → push Mar 1, advance to Apr 1.
    // Apr 1 < Apr 1 → no. Push end = Apr 1 → dedup removes it since already not pushed.
    // Actually Apr 1 was NOT pushed in the loop, so end adds it. Total: Jan 1, Feb 1, Mar 1, Apr 1.
    expect(result.length).toBe(4);
  });

  it("calculates cumulative balances up to each point", () => {
    const result = getNetWorthOverTime(ACCOUNTS, TRANSACTIONS, {
      start: new Date("2026-01-01T00:00:00.000Z"),
      end: new Date("2026-04-01T00:00:00.000Z"),
    });

    // At Jan 1: no transactions before Jan 1 → net worth 0
    expect(result[0].netWorth).toBe(0);

    // At Feb 1: all Jan transactions included
    // acc-checking: 500000 - 120000 - 15000 = 365000
    // acc-savings: 0
    // (acc-archived excluded because archived)
    expect(result[1].byAccount["acc-checking"]).toBe(365000);
    expect(result[1].byAccount["acc-savings"]).toBe(0);
    expect(result[1].netWorth).toBe(365000);

    // At Mar 1: Jan + Feb transactions
    // acc-checking: 365000 + 500000 + 50000 - 120000 - 22000 - 5000 - 100000 = 668000
    // acc-savings: 100000
    expect(result[2].byAccount["acc-checking"]).toBe(668000);
    expect(result[2].byAccount["acc-savings"]).toBe(100000);
    expect(result[2].netWorth).toBe(768000);

    // At Apr 1: Jan + Feb + Mar transactions
    // acc-checking: 668000 (no new checking txns in March)
    // acc-savings: 100000 - 8000 = 92000
    expect(result[3].byAccount["acc-savings"]).toBe(92000);
    expect(result[3].netWorth).toBe(668000 + 92000);
  });

  it("excludes archived accounts from net worth", () => {
    const result = getNetWorthOverTime(ACCOUNTS, TRANSACTIONS, {
      start: new Date("2026-01-01T00:00:00.000Z"),
      end: new Date("2026-02-01T00:00:00.000Z"),
    });
    // Archived account should not appear in byAccount
    const lastPoint = result[result.length - 1];
    expect(lastPoint.byAccount["acc-archived"]).toBeUndefined();
  });

  it("excludes accounts with excludeFromNetWorth=true", () => {
    const accounts = ACCOUNTS.map((a) =>
      a.id === "acc-savings" ? { ...a, excludeFromNetWorth: true } : a,
    );
    const result = getNetWorthOverTime(accounts, TRANSACTIONS, {
      start: new Date("2026-01-01T00:00:00.000Z"),
      end: new Date("2026-04-01T00:00:00.000Z"),
    });
    const lastPoint = result[result.length - 1];
    expect(lastPoint.byAccount["acc-savings"]).toBeUndefined();
    // Without savings, net worth at Apr 1 is just checking's balance: 668000
    expect(lastPoint.netWorth).toBe(668000);
  });

  it("returns single point for very short range", () => {
    const result = getNetWorthOverTime(ACCOUNTS, TRANSACTIONS, {
      start: new Date("2026-02-15T00:00:00.000Z"),
      end: new Date("2026-02-16T00:00:00.000Z"),
    });
    // No month boundaries between Feb 15 and Feb 16. Just the end date.
    // cursor = Feb 1, which is < start (Feb 15), so advance to Mar 1.
    // Mar 1 < Feb 16? No. So only end date point.
    expect(result.length).toBe(1);
  });

  it("handles empty transactions", () => {
    const result = getNetWorthOverTime(ACCOUNTS, [], {
      start: new Date("2026-01-01T00:00:00.000Z"),
      end: new Date("2026-03-01T00:00:00.000Z"),
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
    // Income: 500000 + 500000 + 50000 + 99999 = 1149999
    expect(result.totalIncome).toBe(1149999);
    // Expenses: -120000 - 15000 - 120000 - 22000 - 5000 - 8000 = -290000
    expect(result.totalExpenses).toBe(-290000);
    expect(result.net).toBe(1149999 + -290000);
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

    // January (t1: salary 500000, t12: salary 99999 on archived account)
    const jan = result.find((p) => p.month === "Jan 2026")!;
    expect(jan).toBeDefined();
    expect(jan.income).toBe(599999); // t1: 500000 + t12: 99999
    expect(jan.expenses).toBe(135000); // t2: 120000 + t3: 15000
    expect(jan.net).toBe(599999 - 135000);

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
    // No category id matches a transfer, but make sure no spurious entries leaked in
    for (const point of result.points) {
      for (const amt of Object.values(point.byCategory)) {
        expect(amt).toBeGreaterThan(0);
      }
    }
    const total = result.series.reduce((s, x) => s + x.total, 0);
    expect(total).toBe(240000 + 45000 + 5000);
  });

  it("supports income mode", () => {
    const result = getCategoryTrends(TRANSACTIONS, CATEGORIES, range, { type: "income" });
    const salary = result.series.find((s) => s.categoryId === "cat-salary")!;
    expect(salary).toBeDefined();
    // Salary income within range: t1 (500000) + t4 (500000) + t12 (99999) = 1099999
    expect(salary.total).toBe(1099999);
  });

  it("returns empty for periods with no matching transactions", () => {
    const result = getCategoryTrends(TRANSACTIONS, CATEGORIES, {
      start: new Date("2020-01-01T00:00:00.000Z"),
      end: new Date("2020-12-31T00:00:00.000Z"),
    });
    expect(result.points).toEqual([]);
    expect(result.series).toEqual([]);
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

    it("returns no points when no in-range transactions match selected categories", () => {
      // Pick a real category that has no data in 2020
      const result = getCategoryTrends(TRANSACTIONS, CATEGORIES, {
        start: new Date("2020-01-01T00:00:00.000Z"),
        end: new Date("2020-12-31T00:00:00.000Z"),
      }, { categoryIds: ["cat-rent"] });
      expect(result.points).toEqual([]);
      expect(result.series.length).toBe(1);
      expect(result.series[0].total).toBe(0);
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

  it("computes top KPI totals — assigned, tracked spent, other spending", () => {
    const result = getMonthlyBudgetSummary(txns, cats, FEB);

    // Tracked categories: rent (200000) + utils (15000) + food (60000) + fun (0)
    expect(result.totalAssigned).toBe(275000);
    // Tracked spent: rent (200000) + food (70000) + fun (5000)
    expect(result.totalSpentTracked).toBe(275000);
    // Other spending = untracked, non-Income spend: coffee (3500) + clothing (8000)
    expect(result.totalOtherSpending).toBe(11500);
    expect(result.trackedCount).toBe(4);
    expect(result.totalCount).toBe(6);
  });

  it("ignores income transactions, transfers, and out-of-range entries", () => {
    const result = getMonthlyBudgetSummary(txns, cats, FEB);
    // If income (f7), transfers (f8/f9), or January expense (j1) leaked through,
    // these numbers would shift — they don't.
    expect(result.totalSpentTracked).toBe(275000);
    expect(result.totalOtherSpending).toBe(11500);
  });

  it("ignores uncategorized expenses (no categoryId)", () => {
    // The uncategorized $12.34 in February must NOT appear under "Other Spending"
    // — Other Spending is for *known* untracked categories, not uncategorized rows.
    const result = getMonthlyBudgetSummary(txns, cats, FEB);
    expect(result.totalOtherSpending).toBe(11500); // would be 12734 if it leaked
  });

  it("returns zero totals when no transactions in range", () => {
    const result = getMonthlyBudgetSummary([], cats, FEB);
    expect(result.totalAssigned).toBe(275000); // assigned is independent of txns
    expect(result.totalSpentTracked).toBe(0);
    expect(result.totalOtherSpending).toBe(0);
    for (const r of result.rows) {
      expect(r.spent).toBe(0);
    }
  });

  it("counts categories the toggle label depends on", () => {
    const result = getMonthlyBudgetSummary(txns, cats, FEB);
    // 4 of 6 — matches the "X of N tracked" label
    expect(result.trackedCount).toBe(4);
    expect(result.totalCount).toBe(6);
  });
});
