export interface BudgetMeta {
  schemaVersion: number;
  name: string;
  currency: string;
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
  archived: boolean;
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
  id: string;
  name: string;
  group: string;
  archived: boolean;
  sortOrder: number;
}

export type TransactionType = "income" | "expense" | "transfer";

export interface Transaction {
  id: string;
  datetime: string;
  type: TransactionType;
  amount: number;
  categoryId: string;
  accountId: string;
  transferPairId: string;
  merchant: string;
  note: string;
  createdAt: string;
}
