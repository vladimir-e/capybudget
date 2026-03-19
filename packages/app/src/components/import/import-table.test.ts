import { describe, it, expect } from "vitest";
import { sortImportTransactions, filterImportTransactions } from "./import-table";
import type { ImportTransaction } from "@capybudget/core";

function txn(overrides: Partial<ImportTransaction> = {}): ImportTransaction {
  return {
    id: "1",
    date: "2026-01-15",
    description: "Coffee Shop",
    amount: -450,
    type: "expense",
    sourceAccount: "Checking",
    sourceCategory: "Food",
    memo: "",
    ...overrides,
  };
}

describe("sortImportTransactions", () => {
  const txns = [
    txn({ id: "a", date: "2026-01-15", description: "Beta", amount: -200 }),
    txn({ id: "b", date: "2026-01-10", description: "Alpha", amount: -500 }),
    txn({ id: "c", date: "2026-01-20", description: "Gamma", amount: 1000 }),
  ];

  it("sorts by date ascending", () => {
    const result = sortImportTransactions(txns, { column: "date", direction: "asc" });
    expect(result.map((t) => t.id)).toEqual(["b", "a", "c"]);
  });

  it("sorts by date descending", () => {
    const result = sortImportTransactions(txns, { column: "date", direction: "desc" });
    expect(result.map((t) => t.id)).toEqual(["c", "a", "b"]);
  });

  it("sorts by description ascending", () => {
    const result = sortImportTransactions(txns, { column: "description", direction: "asc" });
    expect(result.map((t) => t.id)).toEqual(["b", "a", "c"]);
  });

  it("sorts by amount ascending", () => {
    const result = sortImportTransactions(txns, { column: "amount", direction: "asc" });
    expect(result.map((t) => t.id)).toEqual(["b", "a", "c"]);
  });

  it("does not mutate the original array", () => {
    const original = [...txns];
    sortImportTransactions(txns, { column: "date", direction: "desc" });
    expect(txns).toEqual(original);
  });
});

describe("filterImportTransactions", () => {
  const txns = [
    txn({ id: "a", description: "Coffee Shop", sourceAccount: "Checking", sourceCategory: "Food" }),
    txn({ id: "b", description: "Payroll", sourceAccount: "Savings", sourceCategory: "Income" }),
    txn({ id: "c", description: "Transfer", sourceAccount: "Checking", sourceCategory: "", memo: "monthly" }),
  ];

  it("returns all when search is empty", () => {
    expect(filterImportTransactions(txns, "")).toEqual(txns);
  });

  it("filters by description", () => {
    const result = filterImportTransactions(txns, "coffee");
    expect(result.map((t) => t.id)).toEqual(["a"]);
  });

  it("filters by source account", () => {
    const result = filterImportTransactions(txns, "savings");
    expect(result.map((t) => t.id)).toEqual(["b"]);
  });

  it("filters by source category", () => {
    const result = filterImportTransactions(txns, "income");
    expect(result.map((t) => t.id)).toEqual(["b"]);
  });

  it("filters by memo", () => {
    const result = filterImportTransactions(txns, "monthly");
    expect(result.map((t) => t.id)).toEqual(["c"]);
  });

  it("is case-insensitive", () => {
    const result = filterImportTransactions(txns, "PAYROLL");
    expect(result.map((t) => t.id)).toEqual(["b"]);
  });
});
