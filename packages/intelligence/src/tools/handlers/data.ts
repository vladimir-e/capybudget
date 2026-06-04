/**
 * Read-only data tool handlers. Pure functions over a BudgetRepository —
 * no node fs, no transport coupling. Used by both the MCP server (via
 * dispatch) and the in-process API adapters.
 */

import type { Account, Category, Transaction } from "@capybudget/core"
import {
  formatMoney,
  getAccountBalance,
  getUniqueMerchants,
  findCategoryForMerchant,
} from "@capybudget/core"
import type { BudgetRepository } from "@capybudget/persistence"

export async function handleListAccounts(repo: BudgetRepository): Promise<string> {
  const accounts = await repo.getAccounts()
  const transactions = await repo.getTransactions()

  const result = accounts.map((a: Account) => {
    const bal = getAccountBalance(a.id, transactions)
    return {
      id: a.id,
      name: a.name,
      type: a.type,
      balance: formatMoney(bal),
      balanceCents: bal,
      archived: a.archived,
    }
  })

  return JSON.stringify(result, null, 2)
}

type TransactionSort = "newest" | "oldest" | "amount_asc" | "amount_desc"

const SORT_COMPARATORS: Record<
  TransactionSort,
  (a: Transaction, b: Transaction) => number
> = {
  newest: (a, b) => b.datetime.localeCompare(a.datetime),
  oldest: (a, b) => a.datetime.localeCompare(b.datetime),
  // Most-negative first — biggest expenses surface at the top.
  amount_asc: (a, b) => a.amount - b.amount,
  // Most-positive first — biggest income at the top.
  amount_desc: (a, b) => b.amount - a.amount,
}

/** Apply the shared filter set (accountId / categoryId / merchant / start / end). */
function applyTransactionFilters(
  txns: Transaction[],
  args: Record<string, unknown>,
): Transaction[] {
  let out = txns
  if (args.accountId) {
    out = out.filter((t) => t.accountId === args.accountId)
  }
  if (args.categoryId) {
    out = out.filter((t) => t.categoryId === args.categoryId)
  }
  if (args.merchant) {
    const q = (args.merchant as string).toLowerCase()
    out = out.filter((t) => t.merchant.toLowerCase().includes(q))
  }
  if (args.startDate) {
    out = out.filter((t) => t.datetime >= (args.startDate as string))
  }
  if (args.endDate) {
    out = out.filter(
      (t) => t.datetime <= (args.endDate as string) + "T23:59:59",
    )
  }
  return out
}

export async function handleListTransactions(
  repo: BudgetRepository,
  args: Record<string, unknown>,
): Promise<string> {
  const allTxns = await repo.getTransactions()
  const accounts = await repo.getAccounts()
  const categories = await repo.getCategories()

  const accountMap = new Map(accounts.map((a: Account) => [a.id, a.name]))
  const categoryMap = new Map(categories.map((c: Category) => [c.id, c.name]))

  let txns = applyTransactionFilters(allTxns, args)

  const sort = (args.sort as TransactionSort | undefined) ?? "newest"
  const comparator = SORT_COMPARATORS[sort] ?? SORT_COMPARATORS.newest
  txns.sort(comparator)

  const limit = (args.limit as number) || 50
  const offset = Math.max(0, (args.offset as number) || 0)
  txns = txns.slice(offset, offset + limit)

  const result = txns.map((t: Transaction) => ({
    id: t.id,
    date: t.datetime.slice(0, 10),
    type: t.type,
    amount: formatMoney(t.amount),
    amountCents: t.amount,
    account: accountMap.get(t.accountId) ?? t.accountId,
    category: categoryMap.get(t.categoryId) ?? (t.categoryId || "Uncategorized"),
    merchant: t.merchant || "(none)",
    note: t.note || "",
  }))

  return JSON.stringify(result, null, 2)
}

export async function handleListCategories(repo: BudgetRepository): Promise<string> {
  const categories = await repo.getCategories()

  const grouped: Record<string, { id: string; name: string; archived: boolean }[]> = {}
  for (const c of categories) {
    const group = c.group || "Other"
    if (!grouped[group]) grouped[group] = []
    grouped[group].push({ id: c.id, name: c.name, archived: c.archived })
  }

  return JSON.stringify(grouped, null, 2)
}

export async function handleSearchMerchants(
  repo: BudgetRepository,
  args: Record<string, unknown>,
): Promise<string> {
  const query = args.query as string
  const limit = (args.limit as number) || 10
  const q = query.toLowerCase()

  const transactions = await repo.getTransactions()
  const categories = await repo.getCategories()
  const categoryMap = new Map(categories.map((c: Category) => [c.id, c.name]))

  // Collect matches with quality scores: 1=full, 2=word-start, 3=substring, 4=note
  type Match = { merchant: string; matchType: string; matchScore: number }
  const seen = new Set<string>()
  const matches: Match[] = []

  function addMatch(merchant: string, matchType: string, matchScore: number) {
    const key = merchant.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    matches.push({ merchant, matchType, matchScore })
  }

  // 1. Search merchant names (clean names from budget)
  const merchants = getUniqueMerchants(transactions)
  for (const m of merchants) {
    const lower = m.toLowerCase()
    if (lower === q) {
      addMatch(m, "full match on merchant name", 1)
    } else if (lower.split(/\s+/).some((w) => w.startsWith(q))) {
      addMatch(m, "word-start match on merchant name", 2)
    } else if (lower.includes(q)) {
      addMatch(m, "substring match on merchant name", 3)
    }
  }

  // 2. Search transaction notes (raw descriptions from past imports/entries)
  // Group by merchant to find merchants whose transactions had matching notes
  const merchantByNote = new Map<string, string>() // lowercase merchant → original
  for (const t of transactions) {
    if (!t.merchant || !t.note) continue
    const noteLower = t.note.toLowerCase()
    if (noteLower.includes(q)) {
      const key = t.merchant.toLowerCase()
      if (!merchantByNote.has(key)) {
        merchantByNote.set(key, t.merchant)
      }
    }
  }
  for (const [, merchant] of merchantByNote) {
    addMatch(merchant, "match in transaction description/note", 4)
  }

  // Sort by match quality, then alphabetically, and cut to limit
  matches.sort((a, b) => a.matchScore - b.matchScore || a.merchant.localeCompare(b.merchant))
  const top = matches.slice(0, limit)

  // Enrich with category data
  const result = top.map(({ merchant, matchType }) => {
    const categoryId = findCategoryForMerchant(transactions, merchant)
    return {
      merchant,
      matchType,
      category: categoryId ? (categoryMap.get(categoryId) ?? categoryId) : null,
      categoryId: categoryId || null,
    }
  })

  return JSON.stringify(result, null, 2)
}
