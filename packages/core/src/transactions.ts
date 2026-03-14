import type { Transaction, TransactionType } from "./types";

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
function localTimeString(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

export function createTransaction(
  input: TransactionFormData,
  existing: Transaction[],
): Transaction[] {
  const now = new Date();
  const createdAt = now.toISOString();
  const datetime = `${input.date}T${localTimeString(now)}`;

  if (input.type === "transfer") {
    const fromId = crypto.randomUUID();
    const toId = crypto.randomUUID();
    const base = {
      datetime,
      type: "transfer" as const,
      categoryId: "",
      merchant: "",
      note: input.note,
      createdAt,
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
      createdAt,
    },
  ];
}

/** If the date portion changed, generate a new datetime with current time; otherwise keep the original. */
function resolveDateTime(inputDate: string, originalDatetime: string): string {
  const originalDate = originalDatetime.split("T")[0];
  if (inputDate === originalDate) return originalDatetime;
  return `${inputDate}T${localTimeString(new Date())}`;
}

/** Update an existing transaction (and its transfer pair if applicable). Returns the new full list. */
export function updateTransaction(
  input: TransactionFormData,
  existing: Transaction[],
): Transaction[] {
  if (input.type === "transfer") {
    // The form resolves transfer pairs so input.accountId = from (outflow),
    // input.toAccountId = to (inflow), regardless of which leg was clicked.
    // Both legs are fully rewritten based on the resolved from/to.
    const original = existing.find((t) => t.id === input.id);
    const pairId = original?.transferPairId;
    const datetime = resolveDateTime(input.date, original?.datetime ?? "");
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

  const original = existing.find((t) => t.id === input.id);
  const datetime = resolveDateTime(input.date, original?.datetime ?? "");

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
