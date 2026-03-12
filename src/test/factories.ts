import type { Account, Category, Transaction } from "@/lib/types";

/** Create a test account with sensible defaults. Override any field. */
export function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: crypto.randomUUID(),
    name: "Test Account",
    type: "checking",
    archived: false,
    sortOrder: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** Create a test category with sensible defaults. Override any field. */
export function makeCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: crypto.randomUUID(),
    name: "Groceries",
    group: "Daily Living",
    archived: false,
    sortOrder: 1,
    ...overrides,
  };
}

/** Create a test transaction with sensible defaults. Override any field. */
export function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: crypto.randomUUID(),
    datetime: "2026-01-15T12:00:00.000Z",
    type: "expense",
    amount: -5000,
    categoryId: "cat-1",
    accountId: "acc-1",
    transferPairId: "",
    merchant: "Store",
    note: "",
    createdAt: "2026-01-15T00:00:00.000Z",
    ...overrides,
  };
}
