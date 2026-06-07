/**
 * The budget-data seam — the History phase's read-only window onto the user's
 * own budget. Grounding needs the transaction history (the matcher's corpus),
 * the categories (resolution targets + the classifier's id list), and the
 * accounts (sourceAccount resolution).
 *
 * Kept separate from the staging store: staging is the import's scratch space,
 * this is the live budget. Unit 3 supplies a concrete impl backed by the
 * budget repository; tests pass a fixed snapshot.
 */

import type { Account, Category, Transaction } from "@capybudget/core";

export interface BudgetDataProvider {
  getHistory(): Promise<Transaction[]>;
  getCategories(): Promise<Category[]>;
  getAccounts(): Promise<Account[]>;
}
