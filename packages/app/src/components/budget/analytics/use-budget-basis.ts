import { useCallback, useState } from "react";
import { BUDGET_BASES, type BudgetBasis } from "@capybudget/core";

const BUDGET_BASIS_STORAGE_KEY = "budget-basis";
const DEFAULT_BUDGET_BASIS: BudgetBasis = "trailing3";

function getStoredBasis(): BudgetBasis {
  try {
    const stored = localStorage.getItem(BUDGET_BASIS_STORAGE_KEY);
    if (stored && (BUDGET_BASES as readonly string[]).includes(stored)) {
      return stored as BudgetBasis;
    }
  } catch {
    // SSR or storage unavailable
  }
  return DEFAULT_BUDGET_BASIS;
}

/** The Monthly Budget comparison basis — a screen-local display preference,
 *  remembered per device in localStorage like the color theme. Not synced and
 *  not part of the budget file. Read on mount, persisted on every change. */
export function useBudgetBasis(): [BudgetBasis, (basis: BudgetBasis) => void] {
  const [basis, setBasisState] = useState<BudgetBasis>(getStoredBasis);

  const setBasis = useCallback((next: BudgetBasis) => {
    setBasisState(next);
    localStorage.setItem(BUDGET_BASIS_STORAGE_KEY, next);
  }, []);

  return [basis, setBasis];
}
