import type { Account, Category, Transaction } from "@/lib/types";

export interface BudgetRepository {
  getAccounts(): Promise<Account[]>;
  getCategories(): Promise<Category[]>;
  getTransactions(): Promise<Transaction[]>;
  saveAccounts(accounts: Account[]): Promise<void>;
  saveCategories(categories: Category[]): Promise<void>;
  saveTransactions(transactions: Transaction[]): Promise<void>;
}
