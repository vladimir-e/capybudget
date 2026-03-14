import { createContext, useContext } from "react";
import type { BudgetRepository } from "@capybudget/persistence";

const RepositoryContext = createContext<BudgetRepository | null>(null);

export const RepositoryProvider = RepositoryContext.Provider;

export function useBudgetRepository(): BudgetRepository {
  const repo = useContext(RepositoryContext);
  if (!repo) throw new Error("useBudgetRepository must be used within RepositoryProvider");
  return repo;
}
