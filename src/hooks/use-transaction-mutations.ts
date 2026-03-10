import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useBudgetRepository } from "@/repositories";
import {
  createTransaction,
  updateTransaction,
  deleteTransaction,
  type TransactionFormData,
} from "@/services/transactions";
import { budgetKeys } from "@/hooks/use-budget-data";
import type { Transaction } from "@/lib/types";

export function useCreateTransaction() {
  const queryClient = useQueryClient();
  const repo = useBudgetRepository();

  return useMutation({
    mutationFn: async (data: TransactionFormData) => {
      const prev = queryClient.getQueryData<Transaction[]>(budgetKeys.transactions()) ?? [];
      const next = createTransaction(data, prev);
      queryClient.setQueryData(budgetKeys.transactions(), next);
      await repo.saveTransactions(next);
      return next;
    },
  });
}

export function useUpdateTransaction() {
  const queryClient = useQueryClient();
  const repo = useBudgetRepository();

  return useMutation({
    mutationFn: async (data: TransactionFormData) => {
      const prev = queryClient.getQueryData<Transaction[]>(budgetKeys.transactions()) ?? [];
      const next = updateTransaction(data, prev);
      queryClient.setQueryData(budgetKeys.transactions(), next);
      await repo.saveTransactions(next);
      return next;
    },
  });
}

export function useDeleteTransaction() {
  const queryClient = useQueryClient();
  const repo = useBudgetRepository();

  return useMutation({
    mutationFn: async (txn: Transaction) => {
      const prev = queryClient.getQueryData<Transaction[]>(budgetKeys.transactions()) ?? [];
      const next = deleteTransaction(txn, prev);
      queryClient.setQueryData(budgetKeys.transactions(), next);
      await repo.saveTransactions(next);
      return next;
    },
  });
}
