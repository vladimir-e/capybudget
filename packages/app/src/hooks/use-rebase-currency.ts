import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { rebaseDefaultCurrency } from "@capybudget/core";
import type { Account, Transaction } from "@capybudget/core";
import { useBudgetRepository } from "@/contexts/repository-context";
import { budgetKeys } from "@/hooks/use-budget-data";
import { useBudgetMeta } from "@/hooks/use-budget-meta";

/**
 * Switching the default currency spans three files: budget.json (the new default
 * + rebased rate map), accounts.csv (re-labeled in the single-currency case), and
 * transactions.csv (re-stamped in the multi-currency case). The pure transform
 * lives in core; this hook reads the current state, runs it, and persists every
 * touched file — the orchestration `setCurrency` (meta-only) can't do.
 */
export function useRebaseCurrency(budgetPath: string) {
  const queryClient = useQueryClient();
  const repo = useBudgetRepository();
  const { data: meta, save: saveMeta } = useBudgetMeta(budgetPath);

  return useCallback(
    async (newCurrency: string) => {
      const accounts =
        queryClient.getQueryData<Account[]>(budgetKeys.accounts()) ?? [];
      const transactions =
        queryClient.getQueryData<Transaction[]>(budgetKeys.transactions()) ?? [];

      const result = rebaseDefaultCurrency(meta, accounts, transactions, newCurrency);

      // The transform returns the same array reference for a file it leaves
      // untouched (transactions in the relabel case, accounts in the rebase
      // case), so a changed reference is exactly the set of files to rewrite —
      // no rewriting a large transactions.csv on a single-currency relabel.
      const writes: Promise<void>[] = [saveMeta(result.meta)];
      if (result.accounts !== accounts) {
        queryClient.setQueryData(budgetKeys.accounts(), result.accounts);
        writes.push(repo.saveAccounts(result.accounts));
      }
      if (result.transactions !== transactions) {
        queryClient.setQueryData(budgetKeys.transactions(), result.transactions);
        writes.push(repo.saveTransactions(result.transactions));
      }
      await Promise.all(writes);
    },
    [queryClient, repo, meta, saveMeta],
  );
}
