import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useBudgetRepository } from "@/repositories";
import { budgetKeys } from "@/hooks/use-budget-data";
import { useUndoStore } from "@/stores/undo-store";
import type { Account, Category, Transaction } from "@capybudget/core";

export function useUndoRedo() {
  const queryClient = useQueryClient();
  const repo = useBudgetRepository();
  const { canUndo, canRedo, pushSnapshot, undo, redo } = useUndoStore();

  const captureSnapshot = useCallback(() => {
    const accounts = queryClient.getQueryData<Account[]>(budgetKeys.accounts()) ?? [];
    const categories = queryClient.getQueryData<Category[]>(budgetKeys.categories()) ?? [];
    const transactions = queryClient.getQueryData<Transaction[]>(budgetKeys.transactions()) ?? [];
    pushSnapshot({ accounts, categories, transactions });
  }, [queryClient, pushSnapshot]);

  const applySnapshot = useCallback(
    async (snapshot: { accounts: Account[]; categories: Category[]; transactions: Transaction[] }) => {
      queryClient.setQueryData(budgetKeys.accounts(), snapshot.accounts);
      queryClient.setQueryData(budgetKeys.categories(), snapshot.categories);
      queryClient.setQueryData(budgetKeys.transactions(), snapshot.transactions);
      await Promise.all([
        repo.saveAccounts(snapshot.accounts),
        repo.saveCategories(snapshot.categories),
        repo.saveTransactions(snapshot.transactions),
      ]);
    },
    [queryClient, repo],
  );

  const handleUndo = useCallback(async () => {
    const snapshot = undo();
    if (snapshot) await applySnapshot(snapshot);
  }, [undo, applySnapshot]);

  const handleRedo = useCallback(async () => {
    const snapshot = redo();
    if (snapshot) await applySnapshot(snapshot);
  }, [redo, applySnapshot]);

  return { canUndo, canRedo, undo: handleUndo, redo: handleRedo, captureSnapshot };
}
