import type { Account, Category, Transaction } from "@capybudget/core";
import { matchesTransaction } from "@capybudget/core";
import type { DateRangeValue } from "@/components/budget/date-range-picker";

export interface TransactionFilterCriteria {
  search: string;
  categoryId: string | null;
  dateRange: DateRangeValue | null;
  /** Exact-match merchant filter. Comparison is case-insensitive and
   *  whitespace-trimmed on both sides to mirror how merchants are grouped
   *  in `getTopMerchants`. Empty/whitespace merchant matches the synthetic
   *  "Unknown" bucket. */
  merchant?: string;
}

/** Normalize a merchant string for equality comparison.
 *  Mirrors the grouping key in `getTopMerchants` (lowercase + trim).
 *  Exported so analytics drilldowns can pre-filter by the same key the
 *  merchants chart uses for grouping. */
export function normalizeMerchant(raw: string): string {
  return raw.trim().toLowerCase();
}

export type SortColumn = "date" | "account" | "category" | "merchant" | "amount";
export type SortDirection = "asc" | "desc";
export interface SortConfig {
  column: SortColumn;
  direction: SortDirection;
}

/** Default sort for any new transaction grid instrument (main list, drilldown
 *  popups, future chat block). Newest first by date. */
export const DEFAULT_SORT: SortConfig = { column: "date", direction: "desc" };

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

  if (filters.merchant !== undefined) {
    const target = normalizeMerchant(filters.merchant);
    result = result.filter((t) => normalizeMerchant(t.merchant) === target);
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
    result = result.filter((t) =>
      matchesTransaction(t, filters.search, { accounts, categories }),
    );
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
