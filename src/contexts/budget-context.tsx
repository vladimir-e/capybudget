import { createContext, useContext } from "react";
import type { Transaction } from "@/lib/types";

export interface BudgetUIContextValue {
  editingTxnId: string | undefined;
  editTransaction: (txn: Transaction) => void;
  cancelEdit: () => void;
  currentAccountId: string | undefined;
  setCurrentAccountId: (id: string | undefined) => void;
}

const BudgetUIContext = createContext<BudgetUIContextValue | null>(null);

export const BudgetUIProvider = BudgetUIContext.Provider;

export function useBudgetUI() {
  const ctx = useContext(BudgetUIContext);
  if (!ctx) throw new Error("useBudgetUI must be used within BudgetUIProvider");
  return ctx;
}
