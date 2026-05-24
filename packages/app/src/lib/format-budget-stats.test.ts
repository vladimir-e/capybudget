import { describe, it, expect } from "vitest";
import { formatBudgetStatsBlock } from "./format-budget-stats";
import type { Account, Category, Transaction } from "@capybudget/core";

const account: Account = {
  id: "acc-1",
  name: "Checking",
  type: "checking",
  archived: false,
  excludeFromNetWorth: false,
  sortOrder: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const groceries: Category = {
  id: "cat-groceries",
  name: "Groceries",
  group: "Daily Living",
  archived: false,
  sortOrder: 0,
  assigned: null,
};

function txn(overrides: Partial<Transaction>): Transaction {
  return {
    id: "t-1",
    datetime: "2026-03-15T12:00:00.000Z",
    type: "expense",
    amount: -1000,
    categoryId: "cat-groceries",
    accountId: "acc-1",
    transferPairId: "",
    merchant: "Whole Foods",
    note: "",
    createdAt: "2026-03-15T00:00:00.000Z",
    ...overrides,
  };
}

describe("formatBudgetStatsBlock", () => {
  it("returns undefined for an empty budget", () => {
    expect(formatBudgetStatsBlock([], [], [])).toBeUndefined();
  });

  it("formats span and counts for a realistic budget", () => {
    const block = formatBudgetStatsBlock(
      [
        txn({ id: "t1", datetime: "2026-01-10T10:00:00.000Z" }),
        txn({ id: "t2", datetime: "2026-05-20T10:00:00.000Z" }),
      ],
      [account],
      [groceries],
    );
    expect(block).toBeDefined();
    expect(block?.headline).toContain("2 transactions");
    expect(block?.headline).toContain("1 account");
    expect(block?.headline).toContain("Jan 2026");
    expect(block?.headline).toContain("May 2026");
    expect(block?.netWorth).toContain("-$20.00");
    expect(block?.topCategories).toContain("Groceries");
  });

  it("falls back to the raw month string on malformed dates — never 'NaN'", () => {
    // Force getBudgetStats's slice(0, 10) to produce an unparseable month
    // by handing it a datetime whose YYYY-MM-DD slice is "2026-13-01".
    const block = formatBudgetStatsBlock(
      [
        txn({ id: "t1", datetime: "2026-13-01T10:00:00.000Z" }),
        txn({ id: "t2", datetime: "2026-13-15T10:00:00.000Z" }),
      ],
      [account],
      [groceries],
    );
    expect(block).toBeDefined();
    expect(block?.headline).not.toContain("NaN");
    // Raw month string survives — "13" instead of a real month name.
    expect(block?.headline).toContain("13");
  });
});
