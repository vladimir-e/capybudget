import type { Account, BudgetMeta, Category, Transaction } from "@capybudget/core";
import type { DisposableRepository } from "./csv-repository";

export interface MemoryRepositoryData {
  accounts?: Account[];
  categories?: Category[];
  transactions?: Transaction[];
  meta?: BudgetMeta;
}

export interface InMemoryRepository extends DisposableRepository {
  /** Current in-memory state — useful for test assertions. */
  readonly data: Required<MemoryRepositoryData>;
}

const DEFAULT_META: BudgetMeta = {
  schemaVersion: 3,
  name: "Demo Budget",
  currency: "USD",
  createdAt: "2026-01-01T00:00:00.000Z",
  lastModified: "2026-01-01T00:00:00.000Z",
  basis: "trailing3",
};

export function createInMemoryRepository(
  seed: MemoryRepositoryData = {},
): InMemoryRepository {
  const data: Required<MemoryRepositoryData> = {
    accounts: [...(seed.accounts ?? [])],
    categories: [...(seed.categories ?? [])],
    transactions: [...(seed.transactions ?? [])],
    meta: { ...DEFAULT_META, ...seed.meta },
  };

  return {
    data,
    async getAccounts() { return [...data.accounts]; },
    async getCategories() { return [...data.categories]; },
    async getTransactions() { return [...data.transactions]; },
    async getBudgetMeta() { return { ...data.meta }; },
    async saveAccounts(next) { data.accounts = [...next]; },
    async saveCategories(next) { data.categories = [...next]; },
    async saveTransactions(next) { data.transactions = [...next]; },
    async saveBudgetMeta(next) { data.meta = { ...next }; },
    invalidateCache() { /* no-op — data is already in memory */ },
    async dispose() { /* no-op */ },
  };
}
