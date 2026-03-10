import { MOCK_ACCOUNTS, MOCK_CATEGORIES, MOCK_TRANSACTIONS } from "@/lib/mock-data";
import type { BudgetRepository } from "@/repositories/types";

export function createMockRepository(): BudgetRepository {
  return {
    getAccounts: () => Promise.resolve(MOCK_ACCOUNTS),
    getCategories: () => Promise.resolve(MOCK_CATEGORIES),
    getTransactions: () => Promise.resolve(MOCK_TRANSACTIONS),
    saveAccounts: () => Promise.resolve(),
    saveCategories: () => Promise.resolve(),
    saveTransactions: () => Promise.resolve(),
  };
}
