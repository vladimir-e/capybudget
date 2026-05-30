/** The comparison bases the Monthly Budget tab can average implicit targets
 *  over. Source of truth for both the `BudgetBasis` type and any runtime
 *  validation/enumeration (e.g. the MCP tool's enum). */
export const BUDGET_BASES = [
  "trailing3",
  "trailing6",
  "trailing12",
  "sameMonthLastYear",
] as const;

/** Which month-set the Monthly Budget tab's implicit targets average over.
 *  Serializes to JSON (the budget.json `basis` field) and supports
 *  exhaustiveness checks. */
export type BudgetBasis = (typeof BUDGET_BASES)[number];

export interface BudgetMeta {
  schemaVersion: number;
  name: string;
  currency: string;
  createdAt: string;
  lastModified: string;
  /** Comparison basis for the Monthly Budget tab's implicit targets.
   *  Absent in budgets written before this field existed — readers default
   *  to `"trailing3"`. */
  basis?: BudgetBasis;
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
  /** Excluded from Net Worth calculations when true. Defaults to false. */
  excludeFromNetWorth: boolean;
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
  group: CategoryGroup;
  archived: boolean;
  sortOrder: number;
  /** Monthly budget target in integer cents. `null` means the category is
   *  untracked (not budgeted). `0` means tracked at zero — any spend is over. */
  assigned: number | null;
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
