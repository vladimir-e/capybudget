import { createContext, useContext } from "react";
import type { Account, Category, Transaction } from "@/lib/types";

export interface BudgetContextValue {
  transactions: Transaction[];
  accounts: Account[];
  categories: Category[];
  deleteTransaction: (txn: Transaction) => void;
  editingTxnId: string | undefined;
  editTransaction: (txn: Transaction) => void;
  cancelEdit: () => void;
  currentAccountId: string | undefined;
  setCurrentAccountId: (id: string | undefined) => void;
}

const BudgetContext = createContext<BudgetContextValue | null>(null);

export const BudgetProvider = BudgetContext.Provider;

export function useBudget() {
  const ctx = useContext(BudgetContext);
  if (!ctx) throw new Error("useBudget must be used within BudgetProvider");
  return ctx;
}
