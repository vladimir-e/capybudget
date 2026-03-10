import type { Account, Category, Transaction } from "@/lib/types";
import { formatMoney } from "@/lib/money";
import type { DateRangeValue } from "@/components/budget/date-range-picker";

export interface TransactionFilterCriteria {
  search: string;
  categoryId: string | null;
  dateRange: DateRangeValue | null;
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
      const time = new Date(t.datetime).getTime();
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
      if (formatMoney(t.amount).toLowerCase().includes(q)) return true;
      return false;
    });
  }

  return result;
}
