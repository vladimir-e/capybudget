import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { rebaseDefaultCurrency } from "@capybudget/core";
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
      // Read the authoritative state from disk, not the query cache: this op is
      // destructive (a multi-currency switch rewrites transactions.csv), and the
      // trigger surface only warms `accounts`. A cold transactions query would
      // hand the transform `[]` and persist it back — wiping the file.
      const accounts = await repo.getAccounts();
      const transactions = await repo.getTransactions();

      const result = rebaseDefaultCurrency(meta, accounts, transactions, newCurrency);

      // The transform returns the same array reference for a file it leaves
      // untouched (transactions in the relabel case, accounts in the rebase
      // case), so a changed reference is exactly the set of files to rewrite —
      // no rewriting a large transactions.csv on a single-currency relabel.
      const writes: Promise<void>[] = [saveMeta(result.meta)];
      if (result.accounts !== accounts) {
        writes.push(repo.saveAccounts(result.accounts));
      }
      if (result.transactions !== transactions) {
        writes.push(repo.saveTransactions(result.transactions));
      }
      await Promise.all(writes);

      // Reflect the persisted state in the cache so the UI updates without a
      // refetch. Seeds the transactions entry too, even if it was cold before.
      queryClient.setQueryData(budgetKeys.accounts(), result.accounts);
      queryClient.setQueryData(budgetKeys.transactions(), result.transactions);
    },
    [queryClient, repo, meta, saveMeta],
  );
}
