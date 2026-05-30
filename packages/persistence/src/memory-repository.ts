import type { Account, Category, Transaction } from "@capybudget/core";
import type { DisposableRepository } from "./csv-repository";

export interface MemoryRepositoryData {
  accounts?: Account[];
  categories?: Category[];
  transactions?: Transaction[];
}

export interface InMemoryRepository extends DisposableRepository {
  /** Current in-memory state — useful for test assertions. */
  readonly data: Required<MemoryRepositoryData>;
}

export function createInMemoryRepository(
  seed: MemoryRepositoryData = {},
): InMemoryRepository {
  const data: Required<MemoryRepositoryData> = {
    accounts: [...(seed.accounts ?? [])],
    categories: [...(seed.categories ?? [])],
    transactions: [...(seed.transactions ?? [])],
  };

  return {
    data,
    async getAccounts() { return [...data.accounts]; },
    async getCategories() { return [...data.categories]; },
    async getTransactions() { return [...data.transactions]; },
    async saveAccounts(next) { data.accounts = [...next]; },
    async saveCategories(next) { data.categories = [...next]; },
    async saveTransactions(next) { data.transactions = [...next]; },
    invalidateCache() { /* no-op — data is already in memory */ },
    async dispose() { /* no-op */ },
  };
}
