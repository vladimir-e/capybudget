import { useMemo, useState } from "react";
import type { Account, Category, Transaction } from "@/lib/types";
import { filterTransactions, type TransactionFilterCriteria } from "@/lib/filter-transactions";

export type { TransactionFilterCriteria };

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

  const filtered = useMemo(
    () => filterTransactions(transactions, filters, accounts, categories),
    [transactions, filters, accounts, categories],
  );

  return { filters, setFilters, filtered };
}
