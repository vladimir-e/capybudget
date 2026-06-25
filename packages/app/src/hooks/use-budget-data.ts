import { useCallback } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import {
  buildBudgetSnapshot,
  type BudgetSnapshot,
} from "@capybudget/intelligence";
import type { Account, Category, Transaction } from "@capybudget/core";
import { useBudgetRepository } from "@/contexts/repository-context";
import { useBudgetMeta } from "@/hooks/use-budget-meta";
import { useCurrency } from "@/contexts/currency-context";

export const budgetKeys = {
  all: ["budget"] as const,
  accounts: () => [...budgetKeys.all, "accounts"] as const,
  categories: () => [...budgetKeys.all, "categories"] as const,
  transactions: () => [...budgetKeys.all, "transactions"] as const,
};

// retry: false on all three — a local CSV read won't succeed on retry, and the
// default retry+backoff would hold the readiness gate (BudgetShell) on the
// loading mascot for ~3s before a corrupt/missing file surfaced its error.
export function useAccounts() {
  const repo = useBudgetRepository();
  return useQuery({
    queryKey: budgetKeys.accounts(),
    queryFn: () => repo.getAccounts(),
    staleTime: Infinity,
    retry: false,
  });
}

export function useCategories() {
  const repo = useBudgetRepository();
  return useQuery({
    queryKey: budgetKeys.categories(),
    queryFn: () => repo.getCategories(),
    staleTime: Infinity,
    retry: false,
  });
}

export function useTransactions() {
  const repo = useBudgetRepository();
  return useQuery({
    queryKey: budgetKeys.transactions(),
    queryFn: () => repo.getTransactions(),
    staleTime: Infinity,
    retry: false,
  });
}

/**
 * Aggregate readiness gate for a budget. Once true, a view's `length === 0` can
 * be trusted to mean genuinely empty rather than still-loading. Settles on the
 * first fetch settling — including an error (retry is off), so a bad CSV
 * releases the gate to the error/empty views instead of hanging the loader.
 *
 * Must be called inside RepositoryProvider (the data hooks read the repo).
 */
export function useBudgetReady(budgetPath: string): boolean {
  // useBudgetMeta swallows read errors to a default, so it only exposes
  // isLoading; the CSV queries surface isPending — same "first fetch settled" bit.
  const { isLoading: metaLoading } = useBudgetMeta(budgetPath);
  const { isPending: accountsPending } = useAccounts();
  const { isPending: categoriesPending } = useCategories();
  const { isPending: transactionsPending } = useTransactions();
  return !metaLoading && !accountsPending && !categoriesPending && !transactionsPending;
}

/**
 * Whether the budget actually holds money in more than one currency — true iff
 * some account's currency differs from the budget default. The currency badges
 * on accounts and transaction rows key off this: a single-currency budget has
 * no foreign account, so it renders none and formats identically. Derived from
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
