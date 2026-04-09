import { describe, it, expect } from "vitest";
import {
  filterTransactionsByDateRange,
  getSpendingByCategory,
  getIncomeByCategory,
  getNetWorthOverTime,
  getPeriodSummary,
  getCashFlow,
  getTopMerchants,
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
  { id: "cat-food", name: "Groceries", group: "Daily Living", archived: false, sortOrder: 0 },
  { id: "cat-rent", name: "Rent", group: "Fixed", archived: false, sortOrder: 1 },
  { id: "cat-salary", name: "Salary", group: "Income", archived: false, sortOrder: 0 },
  { id: "cat-freelance", name: "Freelance", group: "Income", archived: false, sortOrder: 1 },
];

const ACCOUNTS: Account[] = [
  { id: "acc-checking", name: "Checking", type: "checking", archived: false, sortOrder: 0, createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "acc-savings", name: "Savings", type: "savings", archived: false, sortOrder: 1, createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "acc-archived", name: "Old Account", type: "checking", archived: true, sortOrder: 2, createdAt: "2025-01-01T00:00:00.000Z" },
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
      start: new Date("2026-01-01T00:00:00.000Z"),
      end: new Date("2026-04-01T00:00:00.000Z"),
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
      start: new Date("2026-01-01T00:00:00.000Z"),
      end: new Date("2026-04-01T00:00:00.000Z"),
    });
    for (let i = 1; i < result.length; i++) {
      expect(new Date(result[i - 1].date).getTime()).toBeLessThan(
        new Date(result[i].date).getTime(),
      );
    }
  });

  it("returns single month when range covers one month", () => {
    const result = getCashFlow(TRANSACTIONS, {
      start: new Date("2026-01-01T00:00:00.000Z"),
      end: new Date("2026-02-01T00:00:00.000Z"),
    });
    expect(result.length).toBe(1);
    expect(result[0].month).toBe("Jan 2026");
  });

  it("returns empty for empty transactions", () => {
    const result = getCashFlow([], {
      start: new Date("2026-01-01T00:00:00.000Z"),
      end: new Date("2026-12-31T00:00:00.000Z"),
    });
    expect(result).toEqual([]);
  });

  it("excludes transfers", () => {
    // Use only Feb range which contains transfers t9/t10
    const result = getCashFlow(TRANSACTIONS, {
      start: new Date("2026-02-01T00:00:00.000Z"),
      end: new Date("2026-03-01T00:00:00.000Z"),
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
      start: new Date("2026-02-01T00:00:00.000Z"),
      end: new Date("2026-03-01T00:00:00.000Z"),
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
