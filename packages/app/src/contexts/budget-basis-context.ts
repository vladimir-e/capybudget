import { createContext, useContext } from "react";
import type { BudgetBasis } from "@capybudget/core";

export type BudgetBasisContextValue = [BudgetBasis, (basis: BudgetBasis) => void];

export const BudgetBasisContext = createContext<BudgetBasisContextValue | null>(null);

export function useBudgetBasis(): BudgetBasisContextValue {
  const ctx = useContext(BudgetBasisContext);
  if (!ctx) throw new Error("useBudgetBasis must be used within BudgetBasisProvider");
  return ctx;
}
