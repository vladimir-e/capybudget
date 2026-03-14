import { describe, expect, it } from "vitest";
import { filterTransactions, sortTransactions, type TransactionFilterCriteria, type SortConfig } from "@/lib/filter-transactions";
import type { Account, Category, Transaction } from "@capybudget/core";

const accounts: Account[] = [
  { id: "acc-1", name: "Checking", type: "checking", archived: false, sortOrder: 0, createdAt: "" },
  { id: "acc-2", name: "Savings", type: "savings", archived: false, sortOrder: 0, createdAt: "" },
];

const categories: Category[] = [
  { id: "cat-1", name: "Groceries", group: "Daily Living", archived: false, sortOrder: 0 },
  { id: "cat-2", name: "Housing", group: "Fixed", archived: false, sortOrder: 0 },
];

const txns: Transaction[] = [
  { id: "t1", datetime: "2026-02-10T12:00:00.000Z", type: "expense", amount: -5000, categoryId: "cat-1", accountId: "acc-1", transferPairId: "", merchant: "Trader Joe's", note: "weekly shop", createdAt: "" },
  { id: "t2", datetime: "2026-02-15T12:00:00.000Z", type: "expense", amount: -185000, categoryId: "cat-2", accountId: "acc-1", transferPairId: "", merchant: "Landlord", note: "February rent", createdAt: "" },
  { id: "t3", datetime: "2026-03-01T12:00:00.000Z", type: "income", amount: 420000, categoryId: "", accountId: "acc-2", transferPairId: "", merchant: "Acme Corp", note: "", createdAt: "" },
];

const noFilter: TransactionFilterCriteria = { search: "", categoryId: null, dateRange: null };

describe("filterTransactions", () => {
  it("returns all when no filters applied", () => {
    expect(filterTransactions(txns, noFilter, accounts, categories)).toEqual(txns);
  });

  it("filters by categoryId", () => {
    const result = filterTransactions(txns, { ...noFilter, categoryId: "cat-1" }, accounts, categories);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("t1");
  });

  it("filters by date range", () => {
    const result = filterTransactions(
      txns,
      { ...noFilter, dateRange: { from: new Date("2026-02-01"), to: new Date("2026-02-28T23:59:59.999Z") } },
      accounts,
      categories,
    );
    expect(result).toHaveLength(2);
    expect(result.map((t) => t.id)).toEqual(["t1", "t2"]);
  });

  it("searches by merchant (case-insensitive)", () => {
    const result = filterTransactions(txns, { ...noFilter, search: "trader" }, accounts, categories);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("t1");
  });

  it("searches by note", () => {
    const result = filterTransactions(txns, { ...noFilter, search: "rent" }, accounts, categories);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("t2");
  });

  it("searches by category name", () => {
    const result = filterTransactions(txns, { ...noFilter, search: "groceries" }, accounts, categories);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("t1");
  });

  it("searches by account name", () => {
    const result = filterTransactions(txns, { ...noFilter, search: "savings" }, accounts, categories);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("t3");
  });

  it("searches by formatted amount", () => {
    const result = filterTransactions(txns, { ...noFilter, search: "4,200" }, accounts, categories);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("t3");
  });

  it("searches amount without commas", () => {
    const result = filterTransactions(txns, { ...noFilter, search: "1850" }, accounts, categories);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("t2");
  });

  it("searches amount without dollar sign", () => {
    const result = filterTransactions(txns, { ...noFilter, search: "4200" }, accounts, categories);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("t3");
  });

  it("searches negative amount by formatted amount substring", () => {
    // "50.00" matches both -$50.00 (t1) and -$1,850.00 (t2) because we search the formatted string, not by absolute value
    const result = filterTransactions(txns, { ...noFilter, search: "50.00" }, accounts, categories);
    expect(result).toHaveLength(2);
    expect(result.map((t) => t.id)).toEqual(["t1", "t2"]);
    // A more specific search narrows it down
    const exact = filterTransactions(txns, { ...noFilter, search: "$50.00" }, accounts, categories);
    expect(exact).toHaveLength(1);
    expect(exact[0].id).toBe("t1");
  });

  it("searches negative amount with minus sign", () => {
    const result = filterTransactions(txns, { ...noFilter, search: "-50" }, accounts, categories);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("t1");
  });

  it("searches partial decimal amount", () => {
    const result = filterTransactions(txns, { ...noFilter, search: "1850.0" }, accounts, categories);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("t2");
  });

  it("combines multiple filters", () => {
    const result = filterTransactions(
      txns,
      { search: "landlord", categoryId: "cat-2", dateRange: { from: new Date("2026-02-01"), to: new Date("2026-02-28T23:59:59.999Z") } },
      accounts,
      categories,
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("t2");
  });

  it("returns empty when no match", () => {
    const result = filterTransactions(txns, { ...noFilter, search: "nonexistent" }, accounts, categories);
    expect(result).toHaveLength(0);
  });
});

describe("sortTransactions", () => {
  const sortAccounts: Account[] = [
    { id: "acc-a", name: "Alpha", type: "checking", archived: false, sortOrder: 0, createdAt: "" },
    { id: "acc-b", name: "Beta", type: "savings", archived: false, sortOrder: 0, createdAt: "" },
  ];

  const sortCategories: Category[] = [
    { id: "cat-g", name: "Groceries", group: "Daily Living", archived: false, sortOrder: 0 },
    { id: "cat-h", name: "Housing", group: "Fixed", archived: false, sortOrder: 0 },
  ];

  const sortTxns: Transaction[] = [
    { id: "s1", datetime: "2026-02-15T12:00:00.000Z", type: "expense", amount: -5000, categoryId: "cat-g", accountId: "acc-a", transferPairId: "", merchant: "Bakery", note: "", createdAt: "2026-02-15T00:00:00.000Z" },
    { id: "s2", datetime: "2026-02-10T12:00:00.000Z", type: "expense", amount: -185000, categoryId: "cat-h", accountId: "acc-b", transferPairId: "", merchant: "Landlord", note: "", createdAt: "2026-02-10T00:00:00.000Z" },
    { id: "s3", datetime: "2026-03-01T12:00:00.000Z", type: "income", amount: 420000, categoryId: "cat-g", accountId: "acc-a", transferPairId: "", merchant: "Acme Corp", note: "", createdAt: "2026-03-01T00:00:00.000Z" },
  ];

  it("sorts by date ascending", () => {
    const sort: SortConfig = { column: "date", direction: "asc" };
    const result = sortTransactions(sortTxns, sort, sortAccounts, sortCategories);
    expect(result.map((t) => t.id)).toEqual(["s2", "s1", "s3"]);
  });

  it("sorts by date descending", () => {
    const sort: SortConfig = { column: "date", direction: "desc" };
    const result = sortTransactions(sortTxns, sort, sortAccounts, sortCategories);
    expect(result.map((t) => t.id)).toEqual(["s3", "s1", "s2"]);
  });

  it("sorts by amount ascending", () => {
    const sort: SortConfig = { column: "amount", direction: "asc" };
    const result = sortTransactions(sortTxns, sort, sortAccounts, sortCategories);
    expect(result.map((t) => t.id)).toEqual(["s2", "s1", "s3"]);
  });

  it("sorts by amount descending", () => {
    const sort: SortConfig = { column: "amount", direction: "desc" };
    const result = sortTransactions(sortTxns, sort, sortAccounts, sortCategories);
    expect(result.map((t) => t.id)).toEqual(["s3", "s1", "s2"]);
  });

  it("sorts by merchant ascending", () => {
    const sort: SortConfig = { column: "merchant", direction: "asc" };
    const result = sortTransactions(sortTxns, sort, sortAccounts, sortCategories);
    expect(result.map((t) => t.id)).toEqual(["s3", "s1", "s2"]);
  });

  it("sorts by account name ascending", () => {
    const sort: SortConfig = { column: "account", direction: "asc" };
    const result = sortTransactions(sortTxns, sort, sortAccounts, sortCategories);
    // Alpha (acc-a) has s1, s3; Beta (acc-b) has s2
    // Within Alpha, tiebreaker is createdAt desc → s3 before s1
    expect(result[0].accountId).toBe("acc-a");
    expect(result[2].accountId).toBe("acc-b");
  });

  it("sorts by category name ascending", () => {
    const sort: SortConfig = { column: "category", direction: "asc" };
    const result = sortTransactions(sortTxns, sort, sortAccounts, sortCategories);
    // Groceries (cat-g) has s1, s3; Housing (cat-h) has s2
    expect(result[0].categoryId).toBe("cat-g");
    expect(result[2].categoryId).toBe("cat-h");
  });

  it("does not mutate the original array", () => {
    const original = [...sortTxns];
    sortTransactions(sortTxns, { column: "amount", direction: "asc" }, sortAccounts, sortCategories);
    expect(sortTxns.map((t) => t.id)).toEqual(original.map((t) => t.id));
  });

  it("uses createdAt descending as tiebreaker", () => {
    const tied: Transaction[] = [
      { id: "t-old", datetime: "2026-03-01T12:00:00.000Z", type: "expense", amount: -5000, categoryId: "cat-g", accountId: "acc-a", transferPairId: "", merchant: "Same", note: "", createdAt: "2026-03-01T00:00:00.000Z" },
      { id: "t-new", datetime: "2026-03-01T12:00:00.000Z", type: "expense", amount: -5000, categoryId: "cat-g", accountId: "acc-a", transferPairId: "", merchant: "Same", note: "", createdAt: "2026-03-01T12:00:00.000Z" },
    ];
    const result = sortTransactions(tied, { column: "date", direction: "asc" }, sortAccounts, sortCategories);
    expect(result[0].id).toBe("t-new"); // newer createdAt first
  });

  it("handles empty transactions", () => {
    const result = sortTransactions([], { column: "date", direction: "asc" }, sortAccounts, sortCategories);
    expect(result).toEqual([]);
  });

  it("handles missing account gracefully", () => {
    const txnUnknownAccount: Transaction[] = [
      { id: "u1", datetime: "2026-02-15T12:00:00.000Z", type: "expense", amount: -5000, categoryId: "cat-g", accountId: "nonexistent", transferPairId: "", merchant: "Store", note: "", createdAt: "" },
      ...sortTxns.slice(0, 1),
    ];
    // Should not throw
    const result = sortTransactions(txnUnknownAccount, { column: "account", direction: "asc" }, sortAccounts, sortCategories);
    expect(result).toHaveLength(2);
  });
});
