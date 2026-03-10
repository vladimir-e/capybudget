import { useQuery } from "@tanstack/react-query";
import { useBudgetRepository } from "@/repositories";

export const budgetKeys = {
  all: ["budget"] as const,
  accounts: () => [...budgetKeys.all, "accounts"] as const,
  categories: () => [...budgetKeys.all, "categories"] as const,
  transactions: () => [...budgetKeys.all, "transactions"] as const,
};

export function useAccounts() {
  const repo = useBudgetRepository();
  return useQuery({
    queryKey: budgetKeys.accounts(),
    queryFn: () => repo.getAccounts(),
    staleTime: Infinity,
  });
}

export function useCategories() {
  const repo = useBudgetRepository();
  return useQuery({
    queryKey: budgetKeys.categories(),
    queryFn: () => repo.getCategories(),
    staleTime: Infinity,
  });
}

export function useTransactions() {
  const repo = useBudgetRepository();
  return useQuery({
    queryKey: budgetKeys.transactions(),
    queryFn: () => repo.getTransactions(),
    staleTime: Infinity,
  });
}
