import type { Account, Category, Transaction } from "@/lib/types";
import { formatMoney } from "@/lib/money";
import type { DateRangeValue } from "@/components/budget/date-range-picker";

/**
 * Check whether a lowercase search query matches a money amount.
 * Matches against formatted ("$1,850.00") and plain ("1850.00") forms
 * so users can type "1850", "1,850", "$1850", etc.
 */
function matchesMoney(cents: number, query: string): boolean {
  const formatted = formatMoney(cents).toLowerCase();
  if (formatted.includes(query)) return true;
  // Also match against comma-stripped form: "$1,850.00" → "$1850.00"
  const plain = formatted.replace(/,/g, "");
  if (plain.includes(query)) return true;
  // Allow "-12" to match "-$12.50" by stripping the $ from comparison
  const noCurrency = plain.replace("$", "");
  if (noCurrency.includes(query)) return true;
  return false;
}

export interface TransactionFilterCriteria {
  search: string;
  categoryId: string | null;
  dateRange: DateRangeValue | null;
}

export type SortColumn = "date" | "account" | "category" | "merchant" | "amount";
export type SortDirection = "asc" | "desc";
export interface SortConfig {
  column: SortColumn;
  direction: SortDirection;
}

export function filterTransactions(
  transactions: Transaction[],
  filters: TransactionFilterCriteria,
  accounts: Account[],
  categories: Category[],
): Transaction[] {
  let result = transactions;

  if (filters.categoryId) {
    result = result.filter((t) => t.categoryId === filters.categoryId);
  }

  if (filters.dateRange) {
    const fromTime = filters.dateRange.from.getTime();
    const toTime = filters.dateRange.to.getTime();
    result = result.filter((t) => {
      const time = new Date(t.datetime.slice(0, 10) + "T12:00:00").getTime();
      return time >= fromTime && time <= toTime;
    });
  }

  if (filters.search) {
    const q = filters.search.toLowerCase();
    const accountMap = new Map(accounts.map((a) => [a.id, a.name.toLowerCase()]));
    const categoryMap = new Map(categories.map((c) => [c.id, c.name.toLowerCase()]));

    result = result.filter((t) => {
      if (t.merchant.toLowerCase().includes(q)) return true;
      if (t.note.toLowerCase().includes(q)) return true;
      if (categoryMap.get(t.categoryId)?.includes(q)) return true;
      if (accountMap.get(t.accountId)?.includes(q)) return true;
      if (matchesMoney(t.amount, q)) return true;
      return false;
    });
  }

  return result;
}

export function sortTransactions(
  transactions: Transaction[],
  sort: SortConfig,
  accounts: Account[],
  categories: Category[],
): Transaction[] {
  const accountMap = new Map(accounts.map((a) => [a.id, a.name]));
  const categoryMap = new Map(categories.map((c) => [c.id, c.name]));
  const dir = sort.direction === "asc" ? 1 : -1;

  return [...transactions].sort((a, b) => {
    let cmp = 0;
    switch (sort.column) {
      case "date":
        cmp = a.datetime.localeCompare(b.datetime);
        break;
      case "account":
        cmp = (accountMap.get(a.accountId) ?? "").localeCompare(accountMap.get(b.accountId) ?? "");
        break;
      case "category":
        cmp = (categoryMap.get(a.categoryId) ?? "").localeCompare(categoryMap.get(b.categoryId) ?? "");
        break;
      case "merchant":
        cmp = a.merchant.localeCompare(b.merchant);
        break;
      case "amount":
        cmp = a.amount - b.amount;
        break;
    }
    if (cmp !== 0) return cmp * dir;
    // Tiebreaker: createdAt descending (newest first)
    return b.createdAt.localeCompare(a.createdAt);
  });
}
