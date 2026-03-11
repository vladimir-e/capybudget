import { useMutation } from "@tanstack/react-query";
import { budgetKeys } from "@/hooks/use-budget-data";
import { useMutationDeps } from "@/hooks/use-mutation-deps";
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
  const { queryClient, repo, captureSnapshot } = useMutationDeps();
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
  const { queryClient, repo, captureSnapshot } = useMutationDeps();
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
  const { queryClient, repo, captureSnapshot } = useMutationDeps();
  return useMutation({
    mutationFn: async (accountId: string) => {
      captureSnapshot();
      const prevAccounts =
        queryClient.getQueryData<Account[]>(budgetKeys.accounts()) ?? [];
      const prevTransactions =
        queryClient.getQueryData<Transaction[]>(budgetKeys.transactions()) ??
        [];
      const { accounts, transactions } = deleteAccount(accountId, prevAccounts, prevTransactions);
      queryClient.setQueryData(budgetKeys.accounts(), accounts);
      queryClient.setQueryData(budgetKeys.transactions(), transactions);
      await repo.saveAccounts(accounts);
      await repo.saveTransactions(transactions);
      return { accounts, transactions };
    },
  });
}

export function useArchiveAccount() {
  const { queryClient, repo, captureSnapshot } = useMutationDeps();
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
  const { queryClient, repo, captureSnapshot } = useMutationDeps();
  return useMutation({
    mutationFn: async (data: { type: Account["type"]; orderedIds: string[] }) => {
      captureSnapshot();
      const prev =
        queryClient.getQueryData<Account[]>(budgetKeys.accounts()) ?? [];
      const next = reorderAccounts(data.type, data.orderedIds, prev);
      queryClient.setQueryData(budgetKeys.accounts(), next);
      await repo.saveAccounts(next);
      return next;
    },
  });
}

export function useUnarchiveAccount() {
  const { queryClient, repo, captureSnapshot } = useMutationDeps();
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
