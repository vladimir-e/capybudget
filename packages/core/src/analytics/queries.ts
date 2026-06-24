import type { Account, AccountType, CategoryGroup, Transaction } from "../entities/types";
import { ACCOUNT_TYPE_ORDER } from "../constants/account-type-labels";
import { IDENTITY_CONVERTER, type CurrencyConverter } from "./converter";

export const CATEGORY_GROUP_ORDER: CategoryGroup[] = [
  "Income",
  "Fixed",
  "Daily Living",
  "Personal",
  "Irregular",
];

/** Sum of all transaction amounts for a given account, valued in the default
 *  currency at today's rate (a holding). `currency` is the account's native
 *  currency; pass it together with a converter to value a foreign account.
 *  Native sum first, single conversion. */
export function getAccountBalance(
  accountId: string,
  transactions: Transaction[],
  converter: CurrencyConverter = IDENTITY_CONVERTER,
  currency?: string,
): number {
  const native = transactions
    .filter((t) => t.accountId === accountId)
    .reduce((sum, t) => sum + t.amount, 0);
  return converter.holdingToDefault(native, currency);
}

/** Group accounts by type, ordered by ACCOUNT_TYPE_ORDER. Only includes groups that have accounts. */
export function getAccountsByGroup(
  accounts: Account[],
): Map<AccountType, Account[]> {
  const grouped = new Map<AccountType, Account[]>();

  for (const type of ACCOUNT_TYPE_ORDER) {
    const matching = accounts
      .filter((a) => a.type === type && !a.archived)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    if (matching.length > 0) {
      grouped.set(type, matching);
    }
  }

  return grouped;
}

/** Filter transactions by account. Pass null for all accounts. */
export function getTransactionsForAccount(
  accountId: string | null,
  transactions: Transaction[],
): Transaction[] {
  if (accountId === null) return transactions;
  return transactions.filter((t) => t.accountId === accountId);
}

/** Net worth = sum of balances for accounts that are neither archived nor
 *  excluded from net worth. Each account's native balance converts once at
 *  today's rate (a holding) before being summed. */
export function getNetWorth(
  accounts: Account[],
  transactions: Transaction[],
  converter: CurrencyConverter = IDENTITY_CONVERTER,
): number {
  return accounts
    .filter((a) => !a.archived && !a.excludeFromNetWorth)
    .reduce(
      (sum, a) => sum + getAccountBalance(a.id, transactions, converter, a.currency),
      0,
    );
}

/** Net worth split into its cost-basis and unrealized-FX components.
 *
 *  `costBasis` accumulates each transaction at its stamped flow rate — exactly
 *  the cost-basis line `getNetWorthOverTime` draws, so the callout reconciles
 *  with the chart endpoint it sits under. `spot` values the same balances at
 *  today's rate. Their gap is `fxDelta`, the unrealized FX gain/loss from rates
 *  moving while balances were held. Reconciles exactly: `spot === costBasis +
 *  fxDelta`.
 *
 *  Counts exactly the accounts passed in — no internal archived/excluded
 *  filter, matching `getNetWorthOverTime`'s contract where the caller's account
 *  set is authoritative. Default-currency accounts have `costBasis === spot`,
 *  so a single-currency budget yields `fxDelta === 0`. */
export interface NetWorthBreakdown {
  costBasis: number;
  fxDelta: number;
  spot: number;
}

export function getNetWorthBreakdown(
  accounts: Account[],
  transactions: Transaction[],
  converter: CurrencyConverter = IDENTITY_CONVERTER,
): NetWorthBreakdown {
  let costBasis = 0;
  let spot = 0;

  for (const account of accounts) {
    const accountTxns = transactions.filter((t) => t.accountId === account.id);
    costBasis += accountTxns.reduce(
      (sum, t) => sum + converter.flowToDefault(t.amount, t.fxRate),
      0,
    );
    const native = accountTxns.reduce((sum, t) => sum + t.amount, 0);
    spot += converter.holdingToDefault(native, account.currency);
  }

  return { costBasis, fxDelta: spot - costBasis, spot };
}

/** Resolve the from/to account IDs for a transfer transaction. */
export interface TransferPair {
  fromAccountId: string;
  toAccountId: string;
  pairTransaction: Transaction | undefined;
}

/** Resolves a transfer leg into its from/to accounts. Pass only transfers — for
 *  a plain flow the sign-based split is meaningless; read `txn.accountId`. */
export function resolveTransferPair(
  txn: Transaction,
  allTransactions: Transaction[],
): TransferPair {
  if (txn.type !== "transfer") {
    console.warn(
      `resolveTransferPair called on non-transfer (type="${txn.type}") — read txn.accountId instead`,
    );
  }

  const pair = txn.transferPairId
    ? allTransactions.find((t) => t.id === txn.transferPairId)
    : undefined;

  if (!pair) {
    // Use amount sign to determine which side this unpaired leg is
    return txn.amount < 0
      ? { fromAccountId: txn.accountId, toAccountId: "", pairTransaction: undefined }
      : { fromAccountId: "", toAccountId: txn.accountId, pairTransaction: undefined };
  }

  return txn.amount < 0
    ? { fromAccountId: txn.accountId, toAccountId: pair.accountId, pairTransaction: pair }
    : { fromAccountId: pair.accountId, toAccountId: txn.accountId, pairTransaction: pair };
}
