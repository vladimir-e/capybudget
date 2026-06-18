/**
 * Read-only data tool handlers. Pure functions over a BudgetRepository —
 * no node fs, no transport coupling. Used by both the MCP server (via
 * dispatch) and the in-process API adapters.
 */

import type {
  Account,
  Category,
  Transaction,
  GroupDimension,
  GroupMetric,
} from "@capybudget/core"
import {
  formatMoney,
  getAccountBalance,
  searchTransactions,
  groupTransactions,
  type MoneyFormat,
} from "@capybudget/core"
import type { BudgetRepository } from "@capybudget/persistence"

export async function handleListAccounts(
  repo: BudgetRepository,
  currency: string,
  format: MoneyFormat,
): Promise<string> {
  const accounts = await repo.getAccounts()
  const transactions = await repo.getTransactions()

  const result = accounts.map((a: Account) => {
    const bal = getAccountBalance(a.id, transactions)
    return {
      id: a.id,
      name: a.name,
      type: a.type,
      balance: formatMoney(bal, currency, format),
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

/**
 * Apply the structured (non-text) filter set shared by `list_transactions`
 * and `search_transactions`: accountId / categoryId / merchant / type /
 * start / end / min / max amount. All optional. The free-text `query`
 * (cross-field substring incl. money) is applied separately via the core
 * matcher, since it needs account/category names for resolution.
 */
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
  if (args.type) {
    out = out.filter((t) => t.type === args.type)
  }
  if (args.startDate) {
    out = out.filter((t) => t.datetime >= (args.startDate as string))
  }
  if (args.endDate) {
    out = out.filter(
      (t) => t.datetime <= (args.endDate as string) + "T23:59:59",
    )
  }
  if (typeof args.minAmountCents === "number") {
    out = out.filter((t) => t.amount >= (args.minAmountCents as number))
  }
  if (typeof args.maxAmountCents === "number") {
    out = out.filter((t) => t.amount <= (args.maxAmountCents as number))
  }
  return out
}

/**
 * Lean row for token-efficient scanning: raw signed cents, raw ids, no name
 * resolution or formatting. The model resolves names via `list_accounts` /
 * `list_categories` only when it needs them.
 */
function compactRow(t: Transaction) {
  return {
    id: t.id,
    date: t.datetime.slice(0, 10),
    amountCents: t.amount,
    type: t.type,
    accountId: t.accountId,
    categoryId: t.categoryId,
    merchant: t.merchant,
    note: t.note,
    transferPairId: t.transferPairId,
  }
}

/** Verbose, name-resolved row — `list_transactions`' default shape. */
function verboseRow(
  t: Transaction,
  accountMap: Map<string, string>,
  categoryMap: Map<string, string>,
  currency: string,
  format: MoneyFormat,
) {
  return {
    id: t.id,
    date: t.datetime.slice(0, 10),
    type: t.type,
    amount: formatMoney(t.amount, currency, format),
    amountCents: t.amount,
    account: accountMap.get(t.accountId) ?? t.accountId,
    category: categoryMap.get(t.categoryId) ?? (t.categoryId || "Uncategorized"),
    merchant: t.merchant || "(none)",
    note: t.note || "",
  }
}

export async function handleListTransactions(
  repo: BudgetRepository,
  currency: string,
  format: MoneyFormat,
  args: Record<string, unknown>,
): Promise<string> {
  const allTxns = await repo.getTransactions()
  const accounts = await repo.getAccounts()
  const categories = await repo.getCategories()

  const accountMap = new Map(accounts.map((a: Account) => [a.id, a.name]))
  const categoryMap = new Map(categories.map((c: Category) => [c.id, c.name]))

  let txns: Transaction[]
  if (Array.isArray(args.ids)) {
    // Fetch-by-ids: the scan→drill companion. Return exactly the requested
    // rows, in the order asked (silently dropping ids that don't exist), and
    // skip the filter/sort/paginate path entirely.
    const byId = new Map(allTxns.map((t) => [t.id, t]))
    txns = (args.ids as string[])
      .map((id) => byId.get(id))
      .filter((t): t is Transaction => t !== undefined)
  } else {
    const sort = (args.sort as TransactionSort | undefined) ?? "newest"
    const comparator = SORT_COMPARATORS[sort] ?? SORT_COMPARATORS.newest
    // Copy before sorting: `applyTransactionFilters` and the repo's
    // `getTransactions()` can both hand back a cached array by reference, and
    // an in-place sort would reorder the persistence cache for every later read.
    const sorted = [...applyTransactionFilters(allTxns, args)].sort(comparator)
    const limit = (args.limit as number) || 50
    const offset = Math.max(0, (args.offset as number) || 0)
    txns = sorted.slice(offset, offset + limit)
  }

  const result =
    args.format === "compact"
      ? txns.map(compactRow)
      : txns.map((t) => verboseRow(t, accountMap, categoryMap, currency, format))

  return JSON.stringify(result, null, 2)
}

export async function handleSearchTransactions(
  repo: BudgetRepository,
  args: Record<string, unknown>,
): Promise<string> {
  const allTxns = await repo.getTransactions()
  const accounts = await repo.getAccounts()
  const categories = await repo.getCategories()

  const filtered = applyTransactionFilters(allTxns, args)
  const matched = args.query
    ? searchTransactions(filtered, args.query as string, { accounts, categories })
    : filtered

  const sort = (args.sort as TransactionSort | undefined) ?? "newest"
  const comparator = SORT_COMPARATORS[sort] ?? SORT_COMPARATORS.newest
  // Copy before sorting — `matched` may be a cached array by reference (no
  // query and no narrowing filter), and an in-place sort would mutate it.
  const txns = [...matched].sort(comparator).slice(0, (args.limit as number) || 50)

  return JSON.stringify(txns.map(compactRow), null, 2)
}

export async function handleGroupTransactions(
  repo: BudgetRepository,
  args: Record<string, unknown>,
): Promise<string> {
  const allTxns = await repo.getTransactions()
  const accounts = await repo.getAccounts()
  const categories = await repo.getCategories()

  // Same filter pipeline as search: structured filters, then the core fuzzy
  // matcher for `query`. Grouping runs over the already-filtered set.
  const filtered = applyTransactionFilters(allTxns, args)
  const scoped = args.query
    ? searchTransactions(filtered, args.query as string, { accounts, categories })
    : filtered

  const groups = groupTransactions(
    scoped,
    {
      groupBy: (args.groupBy as GroupDimension[] | undefined) ?? [],
      metrics: (args.metrics as GroupMetric[] | undefined) ?? ["count"],
      amountBucketCents: args.amountBucketCents as number | undefined,
      sortByMetric: args.sortByMetric as Exclude<GroupMetric, "cadence"> | undefined,
      sortDir: args.sortDir as "asc" | "desc" | undefined,
      limit: args.limit as number | undefined,
    },
    { accounts, categories },
  )

  return JSON.stringify(groups, null, 2)
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
