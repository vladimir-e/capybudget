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
) {
  const [filters, setFilters] = useState<TransactionFilterCriteria>({
    search: "",
    categoryId: null,
    dateRange: null,
  });

  // Sort is a property of the grid instrument, shared across all views
  const persistedSort = useAppStore((s) => s.sortPreferences["global"]);
  const setSortPreference = useAppStore((s) => s.setSortPreference);

  const sort = persistedSort ?? DEFAULT_SORT;

  const setSort = useCallback(
    (next: SortConfig) => setSortPreference("global", next),
    [setSortPreference],
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
