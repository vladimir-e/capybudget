import type { Account, Category, Transaction } from "@capybudget/core";
import type { DisposableRepository } from "@capybudget/persistence";

export function createInMemoryRepository(
  initialAccounts: Account[],
  initialCategories: Category[],
  initialTransactions: Transaction[],
): DisposableRepository {
  let accounts = [...initialAccounts];
  let categories = [...initialCategories];
  let transactions = [...initialTransactions];

  return {
    async getAccounts() { return accounts; },
    async getCategories() { return categories; },
    async getTransactions() { return transactions; },
    async saveAccounts(data) { accounts = data; },
    async saveCategories(data) { categories = data; },
    async saveTransactions(data) { transactions = data; },
    invalidateCache() { /* no-op — data is already in memory */ },
    async dispose() { /* no-op */ },
  };
}
