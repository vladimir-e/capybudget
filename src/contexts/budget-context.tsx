import { createContext, useContext } from "react";
import type { Transaction } from "@/lib/types";

export interface BudgetContextValue {
  transactions: Transaction[];
  setTransactions: React.Dispatch<React.SetStateAction<Transaction[]>>;
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
