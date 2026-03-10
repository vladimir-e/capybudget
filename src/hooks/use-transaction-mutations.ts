import { useMutation } from "@tanstack/react-query";
import {
  createTransaction,
  updateTransaction,
  deleteTransaction,
  type TransactionFormData,
} from "@/services/transactions";
import { budgetKeys } from "@/hooks/use-budget-data";
import { useMutationDeps } from "@/hooks/use-mutation-deps";
import type { Transaction } from "@/lib/types";

export function useCreateTransaction() {
  const { queryClient, repo, captureSnapshot } = useMutationDeps();

  return useMutation({
    mutationFn: async (data: TransactionFormData) => {
      captureSnapshot();
      const prev = queryClient.getQueryData<Transaction[]>(budgetKeys.transactions()) ?? [];
      const next = createTransaction(data, prev);
      queryClient.setQueryData(budgetKeys.transactions(), next);
      await repo.saveTransactions(next);
      return next;
    },
  });
}

export function useUpdateTransaction() {
  const { queryClient, repo, captureSnapshot } = useMutationDeps();

  return useMutation({
    mutationFn: async (data: TransactionFormData) => {
      captureSnapshot();
      const prev = queryClient.getQueryData<Transaction[]>(budgetKeys.transactions()) ?? [];
      const next = updateTransaction(data, prev);
      queryClient.setQueryData(budgetKeys.transactions(), next);
      await repo.saveTransactions(next);
      return next;
    },
  });
}

export function useDeleteTransaction() {
  const { queryClient, repo, captureSnapshot } = useMutationDeps();

  return useMutation({
    mutationFn: async (txn: Transaction) => {
      captureSnapshot();
      const prev = queryClient.getQueryData<Transaction[]>(budgetKeys.transactions()) ?? [];
      const next = deleteTransaction(txn, prev);
      queryClient.setQueryData(budgetKeys.transactions(), next);
      await repo.saveTransactions(next);
      return next;
    },
  });
}
