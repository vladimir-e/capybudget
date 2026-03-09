import type { Transaction, TransactionType } from "@/lib/types";

export interface TransactionFormData {
  id?: string;
  type: TransactionType;
  amount: number; // positive cents
  categoryId: string;
  accountId: string;
  toAccountId?: string;
  date: string;
  merchant: string;
  note: string;
}

/** Create one (or two, for transfers) new transactions. Returns the new full list. */
export function createTransaction(
  input: TransactionFormData,
  existing: Transaction[],
): Transaction[] {
  const now = new Date().toISOString();
  const datetime = `${input.date}T12:00:00.000Z`;

  if (input.type === "transfer") {
    const fromId = crypto.randomUUID();
    const toId = crypto.randomUUID();
    const base = {
      datetime,
      type: "transfer" as const,
      categoryId: "",
      merchant: "",
      note: input.note,
      createdAt: now,
    };
    return [
      ...existing,
      { ...base, id: fromId, amount: -input.amount, accountId: input.accountId, transferPairId: toId },
      { ...base, id: toId, amount: input.amount, accountId: input.toAccountId!, transferPairId: fromId },
    ];
  }

  return [
    ...existing,
    {
      id: crypto.randomUUID(),
      datetime,
      type: input.type,
      amount: input.type === "expense" ? -input.amount : input.amount,
      categoryId: input.categoryId,
      accountId: input.accountId,
      transferPairId: "",
      merchant: input.merchant,
      note: input.note,
      createdAt: now,
    },
  ];
}

/** Update an existing transaction (and its transfer pair if applicable). Returns the new full list. */
export function updateTransaction(
  input: TransactionFormData,
  existing: Transaction[],
): Transaction[] {
  const datetime = `${input.date}T12:00:00.000Z`;

  if (input.type === "transfer") {
    const original = existing.find((t) => t.id === input.id);
    const pairId = original?.transferPairId;
    return existing.map((t) => {
      if (t.id === input.id) {
        return { ...t, amount: -input.amount, accountId: input.accountId, datetime, merchant: "", note: input.note };
      }
      if (pairId && t.id === pairId) {
        return { ...t, amount: input.amount, accountId: input.toAccountId!, datetime, merchant: "", note: input.note };
      }
      return t;
    });
  }

  return existing.map((t) =>
    t.id === input.id
      ? { ...t, type: input.type, amount: input.type === "expense" ? -input.amount : input.amount, categoryId: input.categoryId, accountId: input.accountId, datetime, merchant: input.merchant, note: input.note }
      : t,
  );
}

/** Delete a transaction (and its transfer pair if applicable). Returns the new full list. */
export function deleteTransaction(
  txn: Transaction,
  existing: Transaction[],
): Transaction[] {
  if (txn.type === "transfer" && txn.transferPairId) {
    return existing.filter((t) => t.id !== txn.id && t.id !== txn.transferPairId);
  }
  return existing.filter((t) => t.id !== txn.id);
}
