import type { Account, AccountType, CategoryGroup, Transaction } from "../entities/types";
import { ACCOUNT_TYPE_ORDER } from "../constants/account-type-labels";

export const CATEGORY_GROUP_ORDER: CategoryGroup[] = [
  "Income",
  "Fixed",
  "Daily Living",
  "Personal",
  "Irregular",
];

/** Sum of all transaction amounts for a given account. */
export function getAccountBalance(
  accountId: string,
  transactions: Transaction[],
): number {
  return transactions
    .filter((t) => t.accountId === accountId)
    .reduce((sum, t) => sum + t.amount, 0);
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
 *  excluded from net worth. */
export function getNetWorth(
  accounts: Account[],
  transactions: Transaction[],
): number {
  return accounts
    .filter((a) => !a.archived && !a.excludeFromNetWorth)
    .reduce((sum, a) => sum + getAccountBalance(a.id, transactions), 0);
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
