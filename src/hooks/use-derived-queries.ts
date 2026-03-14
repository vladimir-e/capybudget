import { useQuery } from "@tanstack/react-query";
import { useBudgetRepository } from "@/repositories";
import { useAccounts } from "@/hooks/use-budget-data";
import { budgetKeys } from "@/hooks/use-budget-data";
import { getAccountBalance, getNetWorth } from "@capybudget/core";

export function useAccountBalance(accountId: string) {
  const repo = useBudgetRepository();
  return useQuery({
    queryKey: budgetKeys.transactions(),
    queryFn: () => repo.getTransactions(),
    staleTime: Infinity,
    select: (transactions) => getAccountBalance(accountId, transactions),
  });
}

export function useNetWorth() {
  const { data: accounts = [] } = useAccounts();
  const repo = useBudgetRepository();
  return useQuery({
    queryKey: budgetKeys.transactions(),
    queryFn: () => repo.getTransactions(),
    staleTime: Infinity,
    select: (transactions) => getNetWorth(accounts, transactions),
  });
}
