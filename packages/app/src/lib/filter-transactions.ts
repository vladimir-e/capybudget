import type { Account, Category, Transaction, TransactionType } from "@capybudget/core";
import { matchesTransaction, toDateString } from "@capybudget/core";
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
  /** Secondary "deep exploration" filters, surfaced behind the toolbar's
   *  filter popover. */
  types?: TransactionType[];
  uncategorizedOnly?: boolean;
  noMerchantOnly?: boolean;
}

/** The full type set, in toolbar display order. */
export const ALL_TRANSACTION_TYPES: TransactionType[] = ["expense", "income", "transfer"];

/** Normalize a merchant string for equality comparison.
 *  Mirrors the grouping key in `getTopMerchants` (lowercase + trim).
 *  Exported so analytics drilldowns can pre-filter by the same key the
 *  merchants chart uses for grouping. */
export function normalizeMerchant(raw: string): string {
  return raw.trim().toLowerCase();
}

/** A transaction is uncategorized when it carries no category id, or one that
 *  no category resolves — the same rule the core search uses to label rows
 *  "uncategorized". */
function isUncategorized(txn: Transaction, categoryIds: Set<string>): boolean {
  return txn.categoryId === "" || !categoryIds.has(txn.categoryId);
}

/** Whether any secondary (popover) filter is active: a strict non-empty subset
 *  of types, or either show-only toggle. Drives the trigger dot and the
 *  popover's Reset affordance. */
export function hasSecondaryFilters(filters: TransactionFilterCriteria): boolean {
  const typeCount = filters.types?.length ?? 0;
  const typeSubset = typeCount > 0 && typeCount < ALL_TRANSACTION_TYPES.length;
  return typeSubset || filters.uncategorizedOnly === true || filters.noMerchantOnly === true;
}

/** Whether any filter — primary or secondary — narrows the list. Gates the
 *  toolbar's Clear-all button and the "no matching transactions" empty state. */
export function hasActiveFilters(filters: TransactionFilterCriteria): boolean {
  return (
    filters.search.length > 0 ||
    filters.categoryId !== null ||
    filters.dateRange !== null ||
    filters.merchant !== undefined ||
    hasSecondaryFilters(filters)
  );
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

  const { types } = filters;
  if (types && types.length > 0 && types.length < ALL_TRANSACTION_TYPES.length) {
    result = result.filter((t) => types.includes(t.type));
  }

  if (filters.uncategorizedOnly) {
    const categoryIds = new Set(categories.map((c) => c.id));
    result = result.filter((t) => isUncategorized(t, categoryIds));
  }

  if (filters.noMerchantOnly) {
    result = result.filter((t) => normalizeMerchant(t.merchant) === "");
  }

  if (filters.dateRange) {
    const fromDate = toDateString(filters.dateRange.from);
    const toDate = toDateString(filters.dateRange.to);
    result = result.filter((t) => {
      const txnDate = t.datetime.slice(0, 10);
      return txnDate >= fromDate && txnDate <= toDate;
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
