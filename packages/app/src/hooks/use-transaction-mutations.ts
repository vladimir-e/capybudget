import type { Account, Transaction, TransactionFormData } from "@capybudget/core";
import {
  createTransaction,
  updateTransaction,
  deleteTransaction,
  splitTransferLegs,
  stampFxRate,
  stampTransferRates,
} from "@capybudget/core";
import { useBudgetMutation } from "@/hooks/use-budget-mutation";
import { useCurrency, useCurrencies } from "@/contexts/currency-context";
import type { CurrencySettings } from "@capybudget/core";

// Resolve the per-leg rate(s) to freeze on a transaction at entry. A transfer
// stamps each leg from its own account's currency (deriving the bank rate from
// the two amounts when one side is the default — see `stampTransferRates`); a
// plain flow stamps just its source account's rate. The single resolution seam:
// the form supplies native amounts and account ids, the rates are computed here
// from budget meta + accounts.
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

// The per-leg rates to write on a transfer edit. A transfer's stamped rates are
// real history — what the FX actually was when it executed — so an edit that
// leaves the shape (amounts + accounts) untouched must carry the stored rates
// verbatim. Re-deriving would silently re-rate a both-foreign transfer (neither
// leg the default) to today on an unrelated note/date edit, rewriting history.
// Only a genuine shape change re-derives.
function transferEditRates(
  data: TransactionFormData,
  accounts: Account[],
  transactions: Transaction[],
  currencies: Record<string, CurrencySettings>,
  defaultCurrency: string,
): Pick<TransactionFormData, "fxRate" | "toFxRate"> {
  const original = transactions.find((t) => t.id === data.id);
  const { outflowLeg, inflowLeg } = original
    ? splitTransferLegs(original, transactions)
    : { outflowLeg: undefined, inflowLeg: undefined };

  // The form resolves accountId=from (outflow), toAccountId=to (inflow), so the
  // shape change is decided by comparing those resolved values against the stored
  // legs.
  const storedToAmount = inflowLeg ? Math.abs(inflowLeg.amount) : undefined;
  const editToAmount = data.toAmount ?? data.amount;
  const shapeChanged =
    data.accountId !== outflowLeg?.accountId ||
    data.toAccountId !== inflowLeg?.accountId ||
    data.amount !== Math.abs(outflowLeg?.amount ?? data.amount) ||
    editToAmount !== storedToAmount;

  if (!shapeChanged) {
    return { fxRate: outflowLeg?.fxRate, toFxRate: inflowLeg?.fxRate };
  }
  return resolveRates(data, accounts, currencies, defaultCurrency);
}

// The rate to write on a plain (non-transfer) flow edit. A flow's stamp is the
// rate on the day it happened, so it always carries through verbatim. A move is
// same-currency only (the form disables cross-currency targets), so the flow's
// currency never changes on a move either — its historical stamp stays valid.
// Mirrors the MCP `handleUpdateTransaction` so both write paths behave identically.
function flowEditRates(
  data: TransactionFormData,
  transactions: Transaction[],
): Pick<TransactionFormData, "fxRate"> {
  const original = transactions.find((t) => t.id === data.id);
  return { fxRate: original?.fxRate };
}

export function useUpdateTransaction() {
  const defaultCurrency = useCurrency();
  const currencies = useCurrencies();
  return useBudgetMutation<TransactionFormData>(async (data, { accounts, transactions }) => {
    // Both paths preserve a stamp through an unrelated edit and only re-derive on
    // a real change: a transfer when its shape changes, a plain flow when it
    // moves to a different-currency account. `updateTransaction` writes the
    // resolved rate verbatim, so the hook is the single resolution seam.
    const rates = data.type === "transfer"
      ? transferEditRates(data, accounts.get(), transactions.get(), currencies, defaultCurrency)
      : flowEditRates(data, transactions.get());
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
