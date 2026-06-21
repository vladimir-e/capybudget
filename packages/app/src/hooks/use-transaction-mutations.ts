import type { Account, Transaction, TransactionFormData } from "@capybudget/core";
import {
  createTransaction,
  updateTransaction,
  deleteTransaction,
  stampFxRate,
  stampTransferRates,
} from "@capybudget/core";
import { useBudgetMutation } from "@/hooks/use-budget-mutation";
import { useCurrency, useCurrencies } from "@/contexts/currency-context";
import type { CurrencySettings } from "@capybudget/core";

// Resolve the per-leg rate(s) to freeze on a transaction at entry. A transfer
// stamps each leg from its own account's currency (deriving the bank rate from
// the two amounts when one side is the default — see `stampTransferRates`); a
// plain flow stamps just its source account's rate. This is the single
// resolution seam, consistent with U4a: the form supplies native amounts and
// account ids, the rates are computed here from budget meta + accounts.
function resolveRates(
  data: TransactionFormData,
  accounts: Account[],
  currencies: Record<string, CurrencySettings>,
  defaultCurrency: string,
): Pick<TransactionFormData, "fxRate" | "toFxRate"> {
  if (data.type === "transfer") {
    const from = accounts.find((a) => a.id === data.accountId);
    const to = accounts.find((a) => a.id === data.toAccountId);
    if (!from || !to) return {};
    const { fromRate, toRate } = stampTransferRates(
      from.currency,
      to.currency,
      data.amount,
      data.toAmount ?? data.amount,
      currencies,
      defaultCurrency,
    );
    return { fxRate: fromRate, toFxRate: toRate };
  }
  const account = accounts.find((a) => a.id === data.accountId);
  return { fxRate: account ? stampFxRate(account.currency, currencies, defaultCurrency) : undefined };
}

export function useCreateTransaction() {
  const defaultCurrency = useCurrency();
  const currencies = useCurrencies();
  return useBudgetMutation<TransactionFormData>(async (data, { accounts, transactions }) => {
    const rates = resolveRates(data, accounts.get(), currencies, defaultCurrency);
    const next = createTransaction({ ...data, ...rates }, transactions.get());
    transactions.set(next);
    await transactions.save(next);
  });
}

export function useUpdateTransaction() {
  const defaultCurrency = useCurrency();
  const currencies = useCurrencies();
  return useBudgetMutation<TransactionFormData>(async (data, { accounts, transactions }) => {
    // A transfer's amounts or destination (hence currency) can change on edit,
    // so its per-leg rates are recomputed from the edited legs. Plain flows
    // never re-rate — `updateTransaction` preserves their original stamp.
    const rates = data.type === "transfer"
      ? resolveRates(data, accounts.get(), currencies, defaultCurrency)
      : {};
    const next = updateTransaction({ ...data, ...rates }, transactions.get());
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
