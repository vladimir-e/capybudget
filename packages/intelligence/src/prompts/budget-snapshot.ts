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

import { CATEGORY_GROUP_ORDER } from "@capybudget/core"
import type { Account, Category, CategoryGroup, Transaction } from "@capybudget/core"

export interface BudgetSnapshot {
  currency: string
  accountCount: number
  transactionCount: number
  /** Earliest → latest transaction date (YYYY-MM-DD), or null when empty. */
  earliestDate: string | null
  latestDate: string | null
  /** Non-archived category names keyed by group, in group order. */
  categoriesByGroup: Array<{ group: string; names: string[] }>
  /** Non-archived accounts whose currency differs from the budget default —
   *  empty for a single-currency budget, so the snapshot stays identical. */
  foreignAccounts: Array<{ name: string; currency: string }>
}

export function buildBudgetSnapshot(
  accounts: Account[],
  transactions: Transaction[],
  categories: Category[],
  currency: string,
): BudgetSnapshot {
  let earliest: string | null = null
  let latest: string | null = null
  for (const t of transactions) {
    const date = t.datetime.slice(0, 10)
    if (earliest === null || date < earliest) earliest = date
    if (latest === null || date > latest) latest = date
  }

  const byGroup = new Map<CategoryGroup, string[]>()
  for (const c of categories) {
    if (c.archived) continue
    const names = byGroup.get(c.group) ?? []
    names.push(c.name)
    byGroup.set(c.group, names)
  }

  const orderedGroups = [
    ...CATEGORY_GROUP_ORDER.filter((g) => byGroup.has(g)),
    ...[...byGroup.keys()].filter((g) => !CATEGORY_GROUP_ORDER.includes(g)),
  ]

  return {
    currency,
    accountCount: accounts.filter((a) => !a.archived).length,
    transactionCount: transactions.length,
    earliestDate: earliest,
    latestDate: latest,
    categoriesByGroup: orderedGroups.map((group) => ({
      group,
      names: byGroup.get(group) ?? [],
    })),
    foreignAccounts: accounts
      .filter((a) => !a.archived && a.currency !== currency)
      .map((a) => ({ name: a.name, currency: a.currency })),
  }
}

export function formatBudgetSnapshot(snapshot: BudgetSnapshot): string {
  const range =
    snapshot.earliestDate && snapshot.latestDate
      ? `${snapshot.earliestDate} → ${snapshot.latestDate}`
      : "none yet"

  const lines = [
    "[Budget snapshot]",
    `Currency: ${snapshot.currency}`,
    `Accounts: ${snapshot.accountCount} active`,
    `Transactions: ${snapshot.transactionCount} (${range})`,
  ]

  if (snapshot.foreignAccounts.length > 0) {
    lines.push(
      "Foreign-currency accounts:",
      ...snapshot.foreignAccounts.map((a) => `  ${a.name}: ${a.currency}`),
      `Aggregate totals (group_transactions, list_accounts balances) are in the default currency (${snapshot.currency}); per-row amounts in list_transactions are each account's own currency.`,
    )
  }

  lines.push(
    "Categories:",
    ...snapshot.categoriesByGroup.map(
      ({ group, names }) => `  ${group}: ${names.join(", ")}`,
    ),
  )
  return lines.join("\n")
}
