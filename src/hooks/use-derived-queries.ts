import { useQuery } from "@tanstack/react-query";
import { useBudgetRepository } from "@/repositories";
import { budgetKeys } from "@/hooks/use-budget-data";
import type { Transaction } from "@/lib/types";

export function useAccountBalance(accountId: string) {
  const repo = useBudgetRepository();
  return useQuery({
    queryKey: budgetKeys.transactions(),
    queryFn: () => repo.getTransactions(),
    staleTime: Infinity,
    select: (transactions: Transaction[]) =>
      transactions
        .filter((t) => t.accountId === accountId)
        .reduce((sum, t) => sum + t.amount, 0),
  });
}

export function useNetWorth() {
  const repo = useBudgetRepository();
  return useQuery({
    queryKey: budgetKeys.transactions(),
    queryFn: () => repo.getTransactions(),
    staleTime: Infinity,
    select: (transactions: Transaction[]) =>
      transactions.reduce((sum, t) => sum + t.amount, 0),
  });
}
