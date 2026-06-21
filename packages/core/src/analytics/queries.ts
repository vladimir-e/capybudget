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

/** One foreign account's contribution to the net-worth FX delta. */
export interface AccountFxDelta {
  accountId: string;
  /** Stamped flow value of the account's transactions — what it cost in the
   *  default currency at the rates on the days money moved. */
  costBasis: number;
  /** Today's-rate value of the account's native balance. */
  spot: number;
  /** `spot - costBasis`: positive is an unrealized FX gain, negative a loss. */
  fxDelta: number;
}

/** Net worth split into its cost-basis and unrealized-FX components.
 *
 *  `spot` is current net worth at today's rate — byte-identical to
 *  `getNetWorth`. `costBasis` accumulates each transaction at its stamped flow
 *  rate (the cost-basis line the over-time chart draws). Their gap is
 *  `fxDelta`, the unrealized FX gain/loss from rates moving while balances were
 *  held. Reconciles exactly: `spot === costBasis + fxDelta`.
 *
 *  Default-currency accounts have `costBasis === spot`, so they contribute
 *  nothing to `fxDelta` and never appear in `byAccount`: a single-currency
 *  budget yields `fxDelta === 0` and an empty `byAccount`. Same account filter
 *  as `getNetWorth` (non-archived, not excluded from net worth). */
export interface NetWorthBreakdown {
  costBasis: number;
  fxDelta: number;
  spot: number;
  /** Per-account deltas, foreign accounts with a non-zero delta only. */
  byAccount: AccountFxDelta[];
}

export function getNetWorthBreakdown(
  accounts: Account[],
  transactions: Transaction[],
  converter: CurrencyConverter = IDENTITY_CONVERTER,
): NetWorthBreakdown {
  let costBasis = 0;
  let spot = 0;
  const byAccount: AccountFxDelta[] = [];

  for (const account of accounts) {
    if (account.archived || account.excludeFromNetWorth) continue;

    const accountTxns = transactions.filter((t) => t.accountId === account.id);
    const accountCost = accountTxns.reduce(
      (sum, t) => sum + converter.flowToDefault(t.amount, t.fxRate),
      0,
    );
    const native = accountTxns.reduce((sum, t) => sum + t.amount, 0);
    const accountSpot = converter.holdingToDefault(native, account.currency);

    costBasis += accountCost;
    spot += accountSpot;

    const fxDelta = accountSpot - accountCost;
    if (fxDelta !== 0) {
      byAccount.push({ accountId: account.id, costBasis: accountCost, spot: accountSpot, fxDelta });
    }
  }

  return { costBasis, fxDelta: spot - costBasis, spot, byAccount };
}

/** Resolve the from/to account IDs for a transfer transaction. */
export interface TransferPair {
  fromAccountId: string;
  toAccountId: string;
  pairTransaction: Transaction | undefined;
}

export function resolveTransferPair(
  txn: Transaction,
  allTransactions: Transaction[],
): TransferPair {
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
