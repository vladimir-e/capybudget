import type { ImportTransaction } from "@capybudget/core";
import { formatMoney } from "@capybudget/core";

export type ImportSortColumn =
  | "date"
  | "merchant"
  | "amount"
  | "type"
  | "sourceAccount"
  | "categoryId";

export interface ImportSortConfig {
  column: ImportSortColumn;
  direction: "asc" | "desc";
}

export function amountColorClass(txn: ImportTransaction): string {
  if (txn.type === "income") return "text-amount-income";
  if (txn.type === "expense") return "text-amount-expense";
  return "text-muted-foreground";
}

export function sortImportTransactions(
  transactions: ImportTransaction[],
  sort: ImportSortConfig,
): ImportTransaction[] {
  const sorted = [...transactions];
  const dir = sort.direction === "asc" ? 1 : -1;

  sorted.sort((a, b) => {
    let cmp = 0;
    switch (sort.column) {
      case "date":
        cmp = a.date.localeCompare(b.date);
        break;
      case "merchant":
        cmp = (a.merchant || a.description).localeCompare(b.merchant || b.description);
        break;
      case "amount":
        cmp = a.amount - b.amount;
        break;
      case "type":
        cmp = a.type.localeCompare(b.type);
        break;
      case "sourceAccount":
        cmp = a.sourceAccount.localeCompare(b.sourceAccount);
        break;
      case "categoryId":
        cmp = a.categoryId.localeCompare(b.categoryId);
        break;
    }
    return cmp * dir;
  });

  return sorted;
}

export function filterImportTransactions(
  transactions: ImportTransaction[],
  search: string,
): ImportTransaction[] {
  if (!search) return transactions;
  const q = search.toLowerCase();
  return transactions.filter(
    (t) =>
      t.description.toLowerCase().includes(q) ||
      (t.merchant && t.merchant.toLowerCase().includes(q)) ||
      t.sourceAccount.toLowerCase().includes(q) ||
      t.sourceCategory.toLowerCase().includes(q) ||
      t.memo.toLowerCase().includes(q) ||
      t.type.includes(q) ||
      formatMoney(t.amount).toLowerCase().includes(q),
  );
}
