/** Tool handlers wrapping core pattern detection. */

import type { Transaction } from "@capybudget/core"
import {
  findDuplicates,
  findRecurring,
  formatMoney,
} from "@capybudget/core"
import type { BudgetRepository } from "@capybudget/persistence"

export async function handleFindDuplicates(
  repo: BudgetRepository,
  args: Record<string, unknown>,
): Promise<string> {
  const transactions = await repo.getTransactions()
  const filtered = applyDuplicateFilters(transactions, args)
  const allGroups = findDuplicates(filtered)

  const confidenceFilter =
    (args.confidence as "high" | "possible" | "all" | undefined) ?? "all"
  const groups =
    confidenceFilter === "all"
      ? allGroups
      : allGroups.filter((g) => g.confidence === confidenceFilter)

  const result = groups.map((g) => ({
    id: g.id,
    transactionIds: g.transactionIds,
    confidence: g.confidence,
    reason: g.reason,
    amount: formatMoney(g.amount),
    amountCents: g.amount,
    merchant: g.merchant || "(none)",
    date: g.date,
  }))

  return JSON.stringify({ groupCount: result.length, groups: result }, null, 2)
}

function applyDuplicateFilters(
  txns: Transaction[],
  args: Record<string, unknown>,
): Transaction[] {
  let out = txns
  if (typeof args.accountId === "string" && args.accountId) {
    out = out.filter((t) => t.accountId === args.accountId)
  }
  const range = args.dateRange as { from?: string; to?: string } | undefined
  if (range?.from) {
    out = out.filter((t) => t.datetime.slice(0, 10) >= range.from!)
  }
  if (range?.to) {
    out = out.filter((t) => t.datetime.slice(0, 10) <= range.to!)
  }
  return out
}

export async function handleFindRecurring(
  repo: BudgetRepository,
  args: Record<string, unknown>,
): Promise<string> {
  const transactions = await repo.getTransactions()
  const lookbackDays = (args.lookbackDays as number) || undefined
  const minTransactions = (args.minTransactions as number) || undefined

  const allPatterns = findRecurring(transactions, {
    lookbackDays,
    minTransactions,
  })

  const cadenceFilter = args.cadence as
    | "weekly"
    | "monthly"
    | "yearly"
    | "irregular"
    | undefined
  const patterns = cadenceFilter
    ? allPatterns.filter((p) => p.cadence === cadenceFilter)
    : allPatterns

  const result = patterns.map((p) => ({
    id: p.id,
    merchant: p.merchant,
    cadence: p.cadence,
    averageAmount: formatMoney(p.averageAmount),
    averageAmountCents: p.averageAmount,
    amountVariance: p.amountVariance,
    transactionCount: p.transactionIds.length,
    transactionIds: p.transactionIds,
    firstSeen: p.firstSeen,
    lastSeen: p.lastSeen,
    nextExpected: p.nextExpected,
    totalSpent: formatMoney(p.totalSpent),
    totalSpentCents: p.totalSpent,
  }))

  return JSON.stringify(
    { patternCount: result.length, patterns: result },
    null,
    2,
  )
}
