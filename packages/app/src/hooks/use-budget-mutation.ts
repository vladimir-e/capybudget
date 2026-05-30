import { useMutation } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useBudgetRepository } from "@/providers/repository-provider";
import { useUndoRedo } from "@/hooks/use-undo-redo";
import { budgetKeys } from "@/hooks/use-budget-data";
import type { Account, BudgetMeta, Category, Transaction } from "@capybudget/core";

export interface EntityHelper<T> {
  get(): T[];
  set(next: T[]): void;
  save(next: T[]): Promise<void>;
}

/** Single-document analogue of EntityHelper for budget-level settings that
 *  aren't arrays (e.g. budget.json metadata). */
export interface DocumentHelper<T> {
  get(): T | undefined;
  set(next: T): void;
  save(next: T): Promise<void>;
}

export interface MutationHelpers {
  accounts: EntityHelper<Account>;
  categories: EntityHelper<Category>;
  transactions: EntityHelper<Transaction>;
  meta: DocumentHelper<BudgetMeta>;
}

export interface BudgetMutationOptions {
  /** Capture an undo snapshot before mutating. Default `true`. Set `false`
   *  for budget-level settings (e.g. basis) that aren't part of the
   *  document undo history — the snapshot only tracks the CSV entities, so
   *  a settings change would push an inert undo entry. */
  snapshot?: boolean;
}

export function useBudgetMutation<TInput, TResult = void>(
  fn: (input: TInput, helpers: MutationHelpers) => Promise<TResult>,
  options: BudgetMutationOptions = {},
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
    meta: {
      get: () => queryClient.getQueryData<BudgetMeta>(budgetKeys.meta()),
      set: (next) => queryClient.setQueryData(budgetKeys.meta(), next),
      save: (next) => repo.saveBudgetMeta(next),
    },
  };

  const { snapshot = true } = options;

  return useMutation({
    mutationFn: async (input: TInput) => {
      if (snapshot) captureSnapshot();
      return fn(input, helpers);
    },
  });
}
