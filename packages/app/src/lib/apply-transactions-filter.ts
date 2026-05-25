import type { Transaction } from "@capybudget/core"
import type { TransactionsFilter } from "@capybudget/intelligence"

export function applyTransactionsFilter(
  transactions: Transaction[],
  filter: TransactionsFilter,
): Transaction[] {
  let result = transactions
  if (filter.transactionIds?.length) {
    const idSet = new Set(filter.transactionIds)
    result = result.filter((t) => idSet.has(t.id))
  }
  if (filter.categoryId) result = result.filter((t) => t.categoryId === filter.categoryId)
  if (filter.merchant) result = result.filter((t) => t.merchant.toLowerCase() === filter.merchant!.toLowerCase())
  if (filter.dateRange) {
    result = result.filter((t) => {
      const d = t.datetime.slice(0, 10)
      return d >= filter.dateRange!.from && d <= filter.dateRange!.to
    })
  }
  if (filter.amountRange) {
    if (filter.amountRange.min != null) result = result.filter((t) => Math.abs(t.amount) >= filter.amountRange!.min!)
    if (filter.amountRange.max != null) result = result.filter((t) => Math.abs(t.amount) <= filter.amountRange!.max!)
  }
  if (filter.type) result = result.filter((t) => t.type === filter.type)
  return result
}
