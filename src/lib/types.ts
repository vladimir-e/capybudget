export interface BudgetMeta {
  schemaVersion: number;
  name: string;
  createdAt: string;
  lastModified: string;
}

export interface RecentBudget {
  path: string;
  name: string;
  lastOpened: string;
}

export type AccountType =
  | "cash"
  | "checking"
  | "savings"
  | "credit_card"
  | "loan"
  | "asset"
  | "crypto";

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  startBalance: number;
  sortOrder: number;
  createdAt: string;
}

export type CategoryGroup =
  | "Income"
  | "Fixed"
  | "Daily Living"
  | "Personal"
  | "Irregular";

export interface Category {
  id: number;
  name: string;
  group: CategoryGroup;
  assigned: number;
  sortOrder: number;
}

export type TransactionType = "income" | "expense" | "transfer";

export interface Transaction {
  id: string;
  date: string;
  type: TransactionType;
  amount: number;
  categoryId: number | null;
  accountId: string;
  toAccountId: string | null;
  note: string;
  createdAt: string;
}
