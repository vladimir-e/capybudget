import type { Account, BudgetMeta, Category, Transaction } from "@capybudget/core";

export interface BudgetRepository {
  getAccounts(): Promise<Account[]>;
  getCategories(): Promise<Category[]>;
  getTransactions(): Promise<Transaction[]>;
  getBudgetMeta(): Promise<BudgetMeta>;
  saveAccounts(accounts: Account[]): Promise<void>;
  saveCategories(categories: Category[]): Promise<void>;
  saveTransactions(transactions: Transaction[]): Promise<void>;
  saveBudgetMeta(meta: BudgetMeta): Promise<void>;
}
