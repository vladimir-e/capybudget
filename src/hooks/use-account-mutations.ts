import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useBudgetRepository } from "@/repositories";
import { budgetKeys } from "@/hooks/use-budget-data";
import { useUndoRedo } from "@/hooks/use-undo-redo";
import type { Account, Transaction } from "@/lib/types";
import {
  type AccountFormData,
  createAccount,
  createOpeningBalanceTransaction,
  updateAccount,
  deleteAccount,
  archiveAccount,
  unarchiveAccount,
  reorderAccounts,
} from "@/services/accounts";

export function useCreateAccount() {
  const queryClient = useQueryClient();
  const repo = useBudgetRepository();
  const { captureSnapshot } = useUndoRedo();
  return useMutation({
    mutationFn: async (data: AccountFormData) => {
      captureSnapshot();
      const prevAccounts =
        queryClient.getQueryData<Account[]>(budgetKeys.accounts()) ?? [];
      const account = createAccount(data, prevAccounts);
      const nextAccounts = [...prevAccounts, account];
      queryClient.setQueryData(budgetKeys.accounts(), nextAccounts);
      await repo.saveAccounts(nextAccounts);

      if (data.openingBalance && data.openingBalance !== 0) {
        const prevTransactions =
          queryClient.getQueryData<Transaction[]>(
            budgetKeys.transactions(),
          ) ?? [];
        const nextTransactions = createOpeningBalanceTransaction(
          account,
          data.openingBalance,
          prevTransactions,
        );
        queryClient.setQueryData(budgetKeys.transactions(), nextTransactions);
        await repo.saveTransactions(nextTransactions);
      }

      return account;
    },
  });
}

export function useUpdateAccount() {
  const queryClient = useQueryClient();
  const repo = useBudgetRepository();
  const { captureSnapshot } = useUndoRedo();
  return useMutation({
    mutationFn: async (data: AccountFormData) => {
      captureSnapshot();
      const prev =
        queryClient.getQueryData<Account[]>(budgetKeys.accounts()) ?? [];
      const next = updateAccount(data, prev);
      queryClient.setQueryData(budgetKeys.accounts(), next);
      await repo.saveAccounts(next);
      return next;
    },
  });
}

export function useDeleteAccount() {
  const queryClient = useQueryClient();
  const repo = useBudgetRepository();
  const { captureSnapshot } = useUndoRedo();
  return useMutation({
    mutationFn: async (accountId: string) => {
      captureSnapshot();
      const prevAccounts =
        queryClient.getQueryData<Account[]>(budgetKeys.accounts()) ?? [];
      const prevTransactions =
        queryClient.getQueryData<Transaction[]>(budgetKeys.transactions()) ??
        [];
      const nextAccounts = deleteAccount(accountId, prevAccounts, prevTransactions);
      queryClient.setQueryData(budgetKeys.accounts(), nextAccounts);
      await repo.saveAccounts(nextAccounts);

      const nextTransactions = prevTransactions.filter(
        (t) => t.accountId !== accountId,
      );
      queryClient.setQueryData(budgetKeys.transactions(), nextTransactions);
      await repo.saveTransactions(nextTransactions);

      return { accounts: nextAccounts, transactions: nextTransactions };
    },
  });
}

export function useArchiveAccount() {
  const queryClient = useQueryClient();
  const repo = useBudgetRepository();
  const { captureSnapshot } = useUndoRedo();
  return useMutation({
    mutationFn: async (accountId: string) => {
      captureSnapshot();
      const prevAccounts =
        queryClient.getQueryData<Account[]>(budgetKeys.accounts()) ?? [];
      const prevTransactions =
        queryClient.getQueryData<Transaction[]>(budgetKeys.transactions()) ??
        [];
      const next = archiveAccount(accountId, prevAccounts, prevTransactions);
      queryClient.setQueryData(budgetKeys.accounts(), next);
      await repo.saveAccounts(next);
      return next;
    },
  });
}

export function useReorderAccounts() {
  const queryClient = useQueryClient();
  const repo = useBudgetRepository();
  const { captureSnapshot } = useUndoRedo();
  return useMutation({
    mutationFn: async (data: { type: string; orderedIds: string[] }) => {
      captureSnapshot();
      const prev =
        queryClient.getQueryData<Account[]>(budgetKeys.accounts()) ?? [];
      const next = reorderAccounts(data.type as Account["type"], data.orderedIds, prev);
      queryClient.setQueryData(budgetKeys.accounts(), next);
      await repo.saveAccounts(next);
      return next;
    },
  });
}

export function useUnarchiveAccount() {
  const queryClient = useQueryClient();
  const repo = useBudgetRepository();
  const { captureSnapshot } = useUndoRedo();
  return useMutation({
    mutationFn: async (accountId: string) => {
      captureSnapshot();
      const prev =
        queryClient.getQueryData<Account[]>(budgetKeys.accounts()) ?? [];
      const next = unarchiveAccount(accountId, prev);
      queryClient.setQueryData(budgetKeys.accounts(), next);
      await repo.saveAccounts(next);
      return next;
    },
  });
}
