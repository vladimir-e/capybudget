import { useBudgetMutation } from "@/hooks/use-budget-mutation";
import {
  bulkDeleteTransactions,
  bulkAssignCategory,
  bulkMoveAccount,
  bulkChangeDate,
  bulkChangeMerchant,
  stampFxRate,
} from "@capybudget/core";
import { useCurrency, useCurrencies } from "@/contexts/currency-context";

export function useBulkDeleteTransactions() {
  return useBudgetMutation<Set<string>>(async (ids, { transactions }) => {
    const next = bulkDeleteTransactions(ids, transactions.get());
    transactions.set(next);
    await transactions.save(next);
  });
}

export function useBulkAssignCategory() {
  return useBudgetMutation<{ ids: Set<string>; categoryId: string }>(
    async ({ ids, categoryId }, { transactions }) => {
      const next = bulkAssignCategory(ids, categoryId, transactions.get());
      transactions.set(next);
      await transactions.save(next);
    },
  );
}

export function useBulkMoveAccount() {
  const defaultCurrency = useCurrency();
  const currencies = useCurrencies();
  return useBudgetMutation<{ ids: Set<string>; accountId: string }>(
    async ({ ids, accountId }, { accounts, transactions }) => {
      // All moved transactions land in one account, so they share its one rate.
      const target = accounts.get().find((a) => a.id === accountId);
      const fxRate = target
        ? stampFxRate(target.currency, currencies, defaultCurrency)
        : undefined;
      const next = bulkMoveAccount(ids, accountId, fxRate, transactions.get());
      transactions.set(next);
      await transactions.save(next);
    },
  );
}

export function useBulkChangeDate() {
  return useBudgetMutation<{ ids: Set<string>; date: string }>(
    async ({ ids, date }, { transactions }) => {
      const next = bulkChangeDate(ids, date, transactions.get());
      transactions.set(next);
      await transactions.save(next);
    },
  );
}

export function useBulkChangeMerchant() {
  return useBudgetMutation<{ ids: Set<string>; merchant: string }>(
    async ({ ids, merchant }, { transactions }) => {
      const next = bulkChangeMerchant(ids, merchant, transactions.get());
      transactions.set(next);
      await transactions.save(next);
    },
  );
}
