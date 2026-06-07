import type { Account, Category, Transaction } from "./entities/types";
import type { ImportTransaction } from "./import/import-types";

/** Create a test account with sensible defaults. Override any field. */
export function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: crypto.randomUUID(),
    name: "Test Account",
    type: "checking",
    archived: false,
    excludeFromNetWorth: false,
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
    assigned: null,
    ...overrides,
  };
}

/** Create a test transaction with sensible defaults. Override any field. */
export function makeTransaction(
  overrides: Partial<Transaction> = {},
): Transaction {
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

/** Create a staged import transaction with sensible defaults. Override any field. */
export function makeImportTransaction(
  overrides: Partial<ImportTransaction> = {},
): ImportTransaction {
  return {
    id: crypto.randomUUID(),
    date: "2026-01-15",
    description: "GROCERY STORE #123",
    amount: -2500,
    type: "expense",
    sourceAccount: "",
    sourceCategory: "",
    merchant: "",
    accountId: "",
    targetAccountId: "",
    categoryId: "",
    categoryConfidence: "",
    duplicate: false,
    ...overrides,
  };
}
