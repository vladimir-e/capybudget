import type { Account, Category, Transaction } from "@capybudget/core";
import { DEFAULT_CATEGORIES } from "@capybudget/core";

export interface DemoPreset {
  id: string;
  name: string;
  description: string;
  netWorth: number;
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
}

export function createCategories(): Category[] {
  return DEFAULT_CATEGORIES.map((c, i) => ({
    ...c,
    id: `cat-${i}`,
  }));
}

export function catId(categories: Category[], name: string): string {
  return categories.find((c) => c.name === name)?.id ?? "";
}

export function createTxnFactory(prefix: string) {
  let counter = 0;
  return function txn(
    overrides: Partial<Transaction> &
      Pick<Transaction, "datetime" | "type" | "amount" | "accountId">,
  ): Transaction {
    counter++;
    return {
      id: `${prefix}-txn-${counter}`,
      datetime: overrides.datetime,
      type: overrides.type,
      amount: overrides.amount,
      categoryId: overrides.categoryId ?? "",
      accountId: overrides.accountId,
      transferPairId: overrides.transferPairId ?? "",
      merchant: overrides.merchant ?? "",
      note: overrides.note ?? "",
      createdAt: `2025-01-01T00:00:${String(counter).padStart(2, "0")}Z`,
    };
  };
}

export function linkTransferPairs(txns: Transaction[], ...pairIds: string[]) {
  for (const pairId of pairIds) {
    const pair = txns.filter((t) => t.transferPairId === pairId);
    if (pair.length === 2) {
      pair[0].transferPairId = pair[1].id;
      pair[1].transferPairId = pair[0].id;
    }
  }
}
