import { useCallback } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import {
  buildBudgetSnapshot,
  type BudgetSnapshot,
} from "@capybudget/intelligence";
import type { Account, Category, Transaction } from "@capybudget/core";
import { useBudgetRepository } from "@/contexts/repository-context";
import { useCurrency } from "@/contexts/currency-context";

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

/**
 * Whether the budget actually holds money in more than one currency — true iff
 * some account's currency differs from the budget default. The currency badges
 * on accounts and transaction rows key off this: a single-currency budget has
 * no foreign account, so it renders none and stays byte-identical. Derived from
 * live accounts, not the persisted currencies map, so a deleted foreign account
 * (whose rate persists) doesn't keep the badges around.
 */
export function useIsMultiCurrency(): boolean {
  const defaultCurrency = useCurrency();
  const { data: accounts = [] } = useAccounts();
  return accounts.some((a) => a.currency !== defaultCurrency);
}

/**
 * Returns a getter that builds a budget snapshot from the freshest cached
 * query data on demand. Used to attach a data snapshot to the first message
 * of a Capy session (chat and import) without a tool round-trip. Reads the
 * cache lazily — no extra fetch, no stale closure.
 */
export function useBudgetSnapshot(currency: string): () => BudgetSnapshot {
  const queryClient = useQueryClient();
  return useCallback(() => {
    const accounts =
      queryClient.getQueryData<Account[]>(budgetKeys.accounts()) ?? [];
    const transactions =
      queryClient.getQueryData<Transaction[]>(budgetKeys.transactions()) ?? [];
    const categories =
      queryClient.getQueryData<Category[]>(budgetKeys.categories()) ?? [];
    return buildBudgetSnapshot(accounts, transactions, categories, currency);
  }, [queryClient, currency]);
}
