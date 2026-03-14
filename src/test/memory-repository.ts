import type { Account, Category, Transaction } from "@capybudget/core";
import type { BudgetRepository } from "@/repositories/types";

export interface MemoryRepositoryData {
  accounts?: Account[];
  categories?: Category[];
  transactions?: Transaction[];
}

export interface MemoryRepository extends BudgetRepository {
  /** Current in-memory state (for assertions). */
  data: Required<MemoryRepositoryData>;
  /** No-op dispose for compatibility with DisposableRepository. */
  dispose(): Promise<void>;
}

export function createMemoryRepository(
  seed: MemoryRepositoryData = {},
): MemoryRepository {
  const data: Required<MemoryRepositoryData> = {
    accounts: [...(seed.accounts ?? [])],
    categories: [...(seed.categories ?? [])],
    transactions: [...(seed.transactions ?? [])],
  };

  return {
    data,
    getAccounts: async () => [...data.accounts],
    getCategories: async () => [...data.categories],
    getTransactions: async () => [...data.transactions],
    saveAccounts: async (next) => { data.accounts = [...next]; },
    saveCategories: async (next) => { data.categories = [...next]; },
    saveTransactions: async (next) => { data.transactions = [...next]; },
    dispose: async () => {},
  };
}
