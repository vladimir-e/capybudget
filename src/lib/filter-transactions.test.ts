import { describe, expect, it } from "vitest";
import { filterTransactions, type TransactionFilterCriteria } from "@/lib/filter-transactions";
import type { Account, Category, Transaction } from "@/lib/types";

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
