import {
  createTransaction,
  updateTransaction,
  deleteTransaction,
  type TransactionFormData,
} from "@/services/transactions";
import { useBudgetMutation } from "@/hooks/use-budget-mutation";
import type { Transaction } from "@/lib/types";

export function useCreateTransaction() {
  return useBudgetMutation<TransactionFormData>(async (data, { transactions }) => {
    const next = createTransaction(data, transactions.get());
    transactions.set(next);
    await transactions.save(next);
  });
}

export function useUpdateTransaction() {
  return useBudgetMutation<TransactionFormData>(async (data, { transactions }) => {
    const next = updateTransaction(data, transactions.get());
    transactions.set(next);
    await transactions.save(next);
  });
}

export function useDeleteTransaction() {
  return useBudgetMutation<Transaction>(async (txn, { transactions }) => {
    const next = deleteTransaction(txn, transactions.get());
    transactions.set(next);
    await transactions.save(next);
  });
}
