import { useMutation } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useBudgetRepository } from "@/repositories";
import { useUndoRedo } from "@/hooks/use-undo-redo";
import { budgetKeys } from "@/hooks/use-budget-data";
import type { Account, Category, Transaction } from "@capybudget/core";

export interface EntityHelper<T> {
  get(): T[];
  set(next: T[]): void;
  save(next: T[]): Promise<void>;
}

export interface MutationHelpers {
  accounts: EntityHelper<Account>;
  categories: EntityHelper<Category>;
  transactions: EntityHelper<Transaction>;
}

export function useBudgetMutation<TInput, TResult = void>(
  fn: (input: TInput, helpers: MutationHelpers) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  const repo = useBudgetRepository();
  const { captureSnapshot } = useUndoRedo();

  const helpers: MutationHelpers = {
    accounts: {
      get: () => queryClient.getQueryData<Account[]>(budgetKeys.accounts()) ?? [],
      set: (next) => queryClient.setQueryData(budgetKeys.accounts(), next),
      save: (next) => repo.saveAccounts(next),
    },
    categories: {
      get: () => queryClient.getQueryData<Category[]>(budgetKeys.categories()) ?? [],
      set: (next) => queryClient.setQueryData(budgetKeys.categories(), next),
      save: (next) => repo.saveCategories(next),
    },
    transactions: {
      get: () => queryClient.getQueryData<Transaction[]>(budgetKeys.transactions()) ?? [],
      set: (next) => queryClient.setQueryData(budgetKeys.transactions(), next),
      save: (next) => repo.saveTransactions(next),
    },
  };

  return useMutation({
    mutationFn: async (input: TInput) => {
      captureSnapshot();
      return fn(input, helpers);
    },
  });
}
