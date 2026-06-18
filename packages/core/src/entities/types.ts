import type { SymbolPosition } from "../utils/money";

/** The comparison bases the Monthly Budget tab can average implicit targets
 *  over. Source of truth for both the `BudgetBasis` type and the runtime
 *  list the basis picker enumerates. */
export const BUDGET_BASES = [
  "trailing3",
  "trailing6",
  "trailing12",
  "sameMonthLastYear",
] as const;

/** Which month-set the Monthly Budget tab's implicit targets average over.
 *  Drives the view computation and `getCategoryHistoricalStats`; supports
 *  exhaustiveness checks. */
export type BudgetBasis = (typeof BUDGET_BASES)[number];

/** Descriptive labels for the basis picker's menu options — the long form a
 *  user reads when choosing ("3 months"), distinct from the resolved
 *  reference label that `basisLabel` renders on the trigger and pin ("3-mo
 *  avg" / "Dec 2024"). Co-located with `BUDGET_BASES` so the two label sets
 *  can't drift from the type. */
export const BASIS_OPTION_LABELS: Record<BudgetBasis, string> = {
  trailing3: "3 months",
  trailing6: "6 months",
  trailing12: "12 months",
  sameMonthLastYear: "same month last year",
};

export interface BudgetMeta {
  schemaVersion: number;
  name: string;
  currency: string;
  currencyDecimals: number;
  currencySymbolPosition: SymbolPosition;
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
