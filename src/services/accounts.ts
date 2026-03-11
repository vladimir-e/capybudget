import type { Account, AccountType, Transaction } from "@/lib/types";
import { localDateTime } from "@/lib/date-utils";

export interface AccountFormData {
  id?: string;
  name: string;
  type: AccountType;
  openingBalance?: number;
}

export function createAccount(
  input: AccountFormData,
  existing: Account[],
): Account {
  const sameType = existing.filter((a) => a.type === input.type);
  const maxSort =
    sameType.length > 0
      ? Math.max(...sameType.map((a) => a.sortOrder))
      : 0;

  return {
    id: crypto.randomUUID(),
    name: input.name,
    type: input.type,
    archived: false,
    sortOrder: maxSort + 1,
    createdAt: new Date().toISOString(),
  };
}

export function createOpeningBalanceTransaction(
  account: Account,
  amount: number,
  existing: Transaction[],
): Transaction[] {
  if (amount === 0) return existing;

  const txn: Transaction = {
    id: crypto.randomUUID(),
    datetime: localDateTime(),
    type: "income",
    amount,
    categoryId: "",
    accountId: account.id,
    transferPairId: "",
    merchant: "Opening Balance",
    note: "",
    createdAt: new Date().toISOString(),
  };

  return [...existing, txn];
}

export function updateAccount(
  input: AccountFormData,
  existing: Account[],
): Account[] {
  return existing.map((a) =>
    a.id === input.id ? { ...a, name: input.name, type: input.type } : a,
  );
}

function isOpeningBalanceTxn(t: Transaction): boolean {
  return t.type === "income" && t.merchant === "Opening Balance" && t.categoryId === "" && t.transferPairId === "";
}

export function deleteAccount(
  accountId: string,
  accounts: Account[],
  transactions: Transaction[],
): { accounts: Account[]; transactions: Transaction[] } {
  const accountTxns = transactions.filter((t) => t.accountId === accountId);
  const hasNonOpeningTxns = accountTxns.some((t) => !isOpeningBalanceTxn(t));
  if (hasNonOpeningTxns) {
    throw new Error(
      "Cannot delete account with transactions. Remove transactions first.",
    );
  }
  return {
    accounts: accounts.filter((a) => a.id !== accountId),
    transactions: transactions.filter((t) => t.accountId !== accountId),
  };
}

export function archiveAccount(
  accountId: string,
  accounts: Account[],
  transactions: Transaction[],
): Account[] {
  const balance = transactions
    .filter((t) => t.accountId === accountId)
    .reduce((sum, t) => sum + t.amount, 0);

  if (balance !== 0) {
    throw new Error(
      "Cannot archive account with non-zero balance. Clear the balance first.",
    );
  }

  return accounts.map((a) =>
    a.id === accountId ? { ...a, archived: true } : a,
  );
}

export function reorderAccounts(
  type: AccountType,
  orderedIds: string[],
  existing: Account[],
): Account[] {
  const orderMap = new Map(orderedIds.map((id, i) => [id, i + 1]));
  return existing.map((a) =>
    a.type === type && orderMap.has(a.id)
      ? { ...a, sortOrder: orderMap.get(a.id)! }
      : a,
  );
}

export function unarchiveAccount(
  accountId: string,
  existing: Account[],
): Account[] {
  return existing.map((a) =>
    a.id === accountId ? { ...a, archived: false } : a,
  );
}
