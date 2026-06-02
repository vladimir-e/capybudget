/**
 * Compact budget snapshot attached to the first message of chat and import
 * sessions. Gives Capy the shape of the data — how many accounts and
 * transactions, the date range it spans, and the category list grouped by
 * group — so it can reason without a tool round-trip on the first turn.
 *
 * `buildBudgetSnapshot` derives the snapshot from already-loaded entities
 * (the app passes its cached `useAccounts` / `useTransactions` /
 * `useCategories` results); `formatBudgetSnapshot` renders it for the prompt.
 */

import type { Account, Category, Transaction } from "@capybudget/core"

export interface BudgetSnapshot {
  accountCount: number
  transactionCount: number
  /** Earliest → latest transaction date (YYYY-MM-DD), or null when empty. */
  earliestDate: string | null
  latestDate: string | null
  /** Non-archived category names keyed by group, in group order. */
  categoriesByGroup: Array<{ group: string; names: string[] }>
}

const GROUP_ORDER = ["Income", "Fixed", "Daily Living", "Personal", "Irregular"]

export function buildBudgetSnapshot(
  accounts: Account[],
  transactions: Transaction[],
  categories: Category[],
): BudgetSnapshot {
  let earliest: string | null = null
  let latest: string | null = null
  for (const t of transactions) {
    const date = t.datetime.slice(0, 10)
    if (earliest === null || date < earliest) earliest = date
    if (latest === null || date > latest) latest = date
  }

  const byGroup = new Map<string, string[]>()
  for (const c of categories) {
    if (c.archived) continue
    const names = byGroup.get(c.group) ?? []
    names.push(c.name)
    byGroup.set(c.group, names)
  }

  const orderedGroups = [
    ...GROUP_ORDER.filter((g) => byGroup.has(g)),
    ...[...byGroup.keys()].filter((g) => !GROUP_ORDER.includes(g)),
  ]

  return {
    accountCount: accounts.filter((a) => !a.archived).length,
    transactionCount: transactions.length,
    earliestDate: earliest,
    latestDate: latest,
    categoriesByGroup: orderedGroups.map((group) => ({
      group,
      names: byGroup.get(group) ?? [],
    })),
  }
}

export function formatBudgetSnapshot(snapshot: BudgetSnapshot): string {
  const range =
    snapshot.earliestDate && snapshot.latestDate
      ? `${snapshot.earliestDate} → ${snapshot.latestDate}`
      : "none yet"

  const lines = [
    "[Budget snapshot]",
    `Accounts: ${snapshot.accountCount} active`,
    `Transactions: ${snapshot.transactionCount} (${range})`,
    "Categories:",
    ...snapshot.categoriesByGroup.map(
      ({ group, names }) => `  ${group}: ${names.join(", ")}`,
    ),
  ]
  return lines.join("\n")
}
