import { useBudgetMutation } from "@/hooks/use-budget-mutation";
import type { Account } from "@/lib/types";
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
  return useBudgetMutation<AccountFormData, Account>(async (data, { accounts, transactions }) => {
    const prev = accounts.get();
    const account = createAccount(data, prev);
    const nextAccounts = [...prev, account];
    accounts.set(nextAccounts);
    await accounts.save(nextAccounts);

    if (data.openingBalance && data.openingBalance !== 0) {
      const nextTxns = createOpeningBalanceTransaction(account, data.openingBalance, transactions.get());
      transactions.set(nextTxns);
      await transactions.save(nextTxns);
    }

    return account;
  });
}

export function useUpdateAccount() {
  return useBudgetMutation<AccountFormData>(async (data, { accounts }) => {
    const next = updateAccount(data, accounts.get());
    accounts.set(next);
    await accounts.save(next);
  });
}

export function useDeleteAccount() {
  return useBudgetMutation<string>(async (accountId, { accounts, transactions }) => {
    const result = deleteAccount(accountId, accounts.get(), transactions.get());
    accounts.set(result.accounts);
    transactions.set(result.transactions);
    await accounts.save(result.accounts);
    await transactions.save(result.transactions);
  });
}

export function useArchiveAccount() {
  return useBudgetMutation<string>(async (accountId, { accounts, transactions }) => {
    const next = archiveAccount(accountId, accounts.get(), transactions.get());
    accounts.set(next);
    await accounts.save(next);
  });
}

export function useReorderAccounts() {
  return useBudgetMutation<{ type: Account["type"]; orderedIds: string[] }>(
    async (data, { accounts }) => {
      const next = reorderAccounts(data.type, data.orderedIds, accounts.get());
      accounts.set(next);
      await accounts.save(next);
    },
  );
}

export function useUnarchiveAccount() {
  return useBudgetMutation<string>(async (accountId, { accounts }) => {
    const next = unarchiveAccount(accountId, accounts.get());
    accounts.set(next);
    await accounts.save(next);
  });
}
