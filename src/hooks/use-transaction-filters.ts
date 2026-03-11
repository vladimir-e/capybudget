import { useMemo, useState, useCallback } from "react";
import type { Account, Category, Transaction } from "@/lib/types";
import {
  filterTransactions,
  sortTransactions,
  type TransactionFilterCriteria,
  type SortConfig,
} from "@/lib/filter-transactions";
import { useAppStore } from "@/stores/app-store";

export type { TransactionFilterCriteria, SortConfig };

const DEFAULT_SORT: SortConfig = { column: "date", direction: "desc" };

export function useTransactionFilters(
  transactions: Transaction[],
  accounts: Account[],
  categories: Category[],
  viewKey?: string,
) {
  const [filters, setFilters] = useState<TransactionFilterCriteria>({
    search: "",
    categoryId: null,
    dateRange: null,
  });

  // Persisted sort: read from store when viewKey is provided
  const persistedSort = useAppStore((s) =>
    viewKey ? s.sortPreferences[viewKey] : undefined,
  );
  const setSortPreference = useAppStore((s) => s.setSortPreference);

  // Local-only sort: used when no viewKey
  const [localSort, setLocalSort] = useState<SortConfig>(DEFAULT_SORT);

  const sort = viewKey ? (persistedSort ?? DEFAULT_SORT) : localSort;

  const setSort = useCallback(
    (next: SortConfig) => {
      if (viewKey) {
        setSortPreference(viewKey, next);
      } else {
        setLocalSort(next);
      }
    },
    [viewKey, setSortPreference],
  );

  const filtered = useMemo(
    () => filterTransactions(transactions, filters, accounts, categories),
    [transactions, filters, accounts, categories],
  );

  const sorted = useMemo(
    () => sortTransactions(filtered, sort, accounts, categories),
    [filtered, sort, accounts, categories],
  );

  return { filters, setFilters, sort, setSort, filtered: sorted };
}
