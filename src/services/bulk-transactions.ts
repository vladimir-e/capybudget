import type { Transaction } from "@/lib/types";

/** Delete multiple transactions by ID. Transfers: both legs are removed. */
export function bulkDeleteTransactions(
  ids: Set<string>,
  existing: Transaction[],
): Transaction[] {
  // Collect transfer pair IDs so both legs are deleted
  const toDelete = new Set(ids);
  for (const txn of existing) {
    if (toDelete.has(txn.id) && txn.type === "transfer" && txn.transferPairId) {
      toDelete.add(txn.transferPairId);
    }
  }
  return existing.filter((t) => !toDelete.has(t.id));
}

/** Assign a category to multiple transactions. Skips transfers. */
export function bulkAssignCategory(
  ids: Set<string>,
  categoryId: string,
  existing: Transaction[],
): Transaction[] {
  return existing.map((t) =>
    ids.has(t.id) && t.type !== "transfer"
      ? { ...t, categoryId }
      : t,
  );
}

/** Move multiple transactions to a different account. Skips transfers. */
export function bulkMoveAccount(
  ids: Set<string>,
  accountId: string,
  existing: Transaction[],
): Transaction[] {
  return existing.map((t) =>
    ids.has(t.id) && t.type !== "transfer"
      ? { ...t, accountId }
      : t,
  );
}

/** Change the date for multiple transactions. */
export function bulkChangeDate(
  ids: Set<string>,
  date: string,
  existing: Transaction[],
): Transaction[] {
  return existing.map((t) => {
    if (!ids.has(t.id)) return t;
    const timePart = t.datetime.includes("T") ? t.datetime.split("T")[1] : "12:00:00";
    return { ...t, datetime: `${date}T${timePart}` };
  });
}

/** Change the merchant for multiple transactions. Skips transfers. */
export function bulkChangeMerchant(
  ids: Set<string>,
  merchant: string,
  existing: Transaction[],
): Transaction[] {
  return existing.map((t) =>
    ids.has(t.id) && t.type !== "transfer"
      ? { ...t, merchant }
      : t,
  );
}
