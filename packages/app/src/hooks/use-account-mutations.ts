import type { Account, AccountFormData } from "@capybudget/core";
import {
  createAccount,
  createOpeningBalanceTransaction,
  updateAccount,
  deleteAccount,
  archiveAccount,
  unarchiveAccount,
  reorderAccounts,
  setNetWorthExclusions,
  stampFxRate,
} from "@capybudget/core";
import { useBudgetMutation } from "@/hooks/use-budget-mutation";
import { useBudgetMeta } from "@/hooks/use-budget-meta";
import { useCurrency, useCurrencies } from "@/contexts/currency-context";

export function useCreateAccount(budgetPath: string) {
  const defaultCurrency = useCurrency();
  const currencies = useCurrencies();
  const { ensureCurrency } = useBudgetMeta(budgetPath);
  return useBudgetMutation<AccountFormData, Account>(async (data, { accounts, transactions }) => {
    const prev = accounts.get();
    const account = createAccount(data, prev, defaultCurrency);
    // Register a foreign account's currency in budget.json so the converter has
    // a rate for it immediately — without this, holdings value 1:1 until the
    // user opens Settings. Same lazy-seed the Settings panel runs; a no-op once
    // the entry exists.
    if (account.currency !== defaultCurrency) {
      await ensureCurrency(account.currency);
    }
    const nextAccounts = [...prev, account];
    accounts.set(nextAccounts);
    await accounts.save(nextAccounts);

    if (data.openingBalance && data.openingBalance !== 0) {
      const fxRate = stampFxRate(account.currency, currencies, defaultCurrency);
      const nextTxns = createOpeningBalanceTransaction(account, data.openingBalance, transactions.get(), fxRate);
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

/** Replace the full set of accounts excluded from Net Worth. */
export function useSetNetWorthExclusions() {
  return useBudgetMutation<Set<string>>(async (excludedIds, { accounts }) => {
    const next = setNetWorthExclusions(excludedIds, accounts.get());
    accounts.set(next);
    await accounts.save(next);
  });
}
