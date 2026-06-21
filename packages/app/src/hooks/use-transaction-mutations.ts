import type { Transaction, TransactionFormData } from "@capybudget/core";
import {
  createTransaction,
  updateTransaction,
  deleteTransaction,
  stampFxRate,
} from "@capybudget/core";
import { useBudgetMutation } from "@/hooks/use-budget-mutation";
import { useCurrency, useCurrencies } from "@/contexts/currency-context";

export function useCreateTransaction() {
  const defaultCurrency = useCurrency();
  const currencies = useCurrencies();
  return useBudgetMutation<TransactionFormData>(async (data, { accounts, transactions }) => {
    // Stamp today's rate on a foreign-account transaction at entry, frozen so
    // the flow never re-rates. The source account drives the rate; same-currency
    // transfers stamp both legs with it (cross-currency stamping is U5).
    const account = accounts.get().find((a) => a.id === data.accountId);
    const fxRate = account
      ? stampFxRate(account.currency, currencies, defaultCurrency)
      : undefined;
    const next = createTransaction({ ...data, fxRate }, transactions.get());
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
