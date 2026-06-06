import { describe, it, expect } from "vitest";
import {
  buildDuplicateView,
  readySummary,
  sortImportTransactions,
  filterImportTransactions,
} from "@/components/import/import-table-utils";
import type { ImportTransaction, Transaction } from "@capybudget/core";

describe("readySummary", () => {
  it("includes the dimmed-duplicate count when there are duplicates", () => {
    expect(readySummary({ ready: 47, duplicates: 3 })).toBe(
      "47 ready, 3 duplicates dimmed.",
    );
  });

  it("uses singular phrasing for one duplicate", () => {
    expect(readySummary({ ready: 9, duplicates: 1 })).toBe(
      "9 ready, 1 duplicate dimmed.",
    );
  });

  it("omits the duplicate clause when there are none", () => {
    expect(readySummary({ ready: 12, duplicates: 0 })).toBe("12 ready.");
  });
});

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
    merchant: "",
    accountId: "",
    targetAccountId: "",
    categoryId: "",
    categoryConfidence: "",
    duplicate: false,
    duplicateOf: "",
    duplicateConfidence: "",
    ...overrides,
  };
}

describe("sortImportTransactions", () => {
  const txns = [
    txn({ id: "a", date: "2026-01-15", description: "Beta", merchant: "Beta", amount: -200 }),
    txn({ id: "b", date: "2026-01-10", description: "Alpha", merchant: "Alpha", amount: -500 }),
    txn({ id: "c", date: "2026-01-20", description: "Gamma", merchant: "Gamma", amount: 1000 }),
  ];

  it("sorts by date ascending", () => {
    const result = sortImportTransactions(txns, { column: "date", direction: "asc" });
    expect(result.map((t) => t.id)).toEqual(["b", "a", "c"]);
  });

  it("sorts by date descending", () => {
    const result = sortImportTransactions(txns, { column: "date", direction: "desc" });
    expect(result.map((t) => t.id)).toEqual(["c", "a", "b"]);
  });

  it("sorts by merchant ascending", () => {
    const result = sortImportTransactions(txns, { column: "merchant", direction: "asc" });
    expect(result.map((t) => t.id)).toEqual(["b", "a", "c"]);
  });

  it("sorts by merchant falling back to description when merchant is empty", () => {
    const mixed = [
      txn({ id: "a", description: "Beta Store", merchant: "" }),
      txn({ id: "b", description: "Zeta Corp", merchant: "Alpha Inc" }),
      txn({ id: "c", description: "Gamma LLC", merchant: "" }),
    ];
    const result = sortImportTransactions(mixed, { column: "merchant", direction: "asc" });
    // "Alpha Inc", "Beta Store" (from description), "Gamma LLC" (from description)
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
    txn({ id: "a", description: "Coffee Shop", merchant: "Coffee Shop", sourceAccount: "Checking", sourceCategory: "Food" }),
    txn({ id: "b", description: "Payroll", merchant: "Payroll", sourceAccount: "Savings", sourceCategory: "Income" }),
    txn({ id: "c", description: "Transfer", merchant: "Transfer", sourceAccount: "Checking", sourceCategory: "", memo: "monthly" }),
  ];

  it("returns all when search is empty", () => {
    expect(filterImportTransactions(txns, "")).toEqual(txns);
  });

  it("filters by merchant", () => {
    const result = filterImportTransactions(txns, "coffee");
    expect(result.map((t) => t.id)).toEqual(["a"]);
  });

  it("filters by merchant when description differs", () => {
    const withMerchant = [
      txn({ id: "a", description: "POS TXN 8832 CARD", merchant: "Starbucks" }),
      txn({ id: "b", description: "ACH DEBIT 1234", merchant: "Netflix" }),
    ];
    const result = filterImportTransactions(withMerchant, "starbucks");
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

describe("buildDuplicateView", () => {
  function existing(overrides: Partial<Transaction> = {}): Transaction {
    return {
      id: "ex-1",
      datetime: "2026-01-15T00:00:00.000",
      type: "expense",
      amount: -450,
      categoryId: "cat-1",
      accountId: "acct-1",
      transferPairId: "",
      merchant: "Coffee Shop",
      note: "Coffee Shop",
      createdAt: "",
      ...overrides,
    };
  }

  it("includes only rows flagged duplicate, keyed by staging id", () => {
    const rows = [
      txn({ id: "a", duplicate: true, duplicateOf: "ex-1", duplicateConfidence: "high" }),
      txn({ id: "b", duplicate: false }),
    ];
    const view = buildDuplicateView(rows, []);
    expect([...view.keys()]).toEqual(["a"]);
    expect(view.get("a")?.confidence).toBe("high");
  });

  it("resolves the matched original from duplicateOf when present in the budget", () => {
    const rows = [txn({ id: "a", duplicate: true, duplicateOf: "ex-1", duplicateConfidence: "low" })];
    const view = buildDuplicateView(rows, [existing({ id: "ex-1", amount: -999 })]);
    expect(view.get("a")?.matched?.id).toBe("ex-1");
    expect(view.get("a")?.matched?.amount).toBe(-999);
  });

  it("leaves matched null when duplicateOf no longer resolves", () => {
    const rows = [txn({ id: "a", duplicate: true, duplicateOf: "gone", duplicateConfidence: "high" })];
    const view = buildDuplicateView(rows, []);
    expect(view.get("a")?.matched).toBeNull();
  });
});
