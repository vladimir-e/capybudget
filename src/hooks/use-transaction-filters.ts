import { useMemo, useState } from "react";
import type { Account, Category, Transaction } from "@/lib/types";
import {
  filterTransactions,
  sortTransactions,
  type TransactionFilterCriteria,
  type SortConfig,
} from "@/lib/filter-transactions";

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

  const [sort, setSort] = useState<SortConfig>(DEFAULT_SORT);

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
