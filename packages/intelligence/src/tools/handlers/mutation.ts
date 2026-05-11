/**
 * Mutation tool handlers. Pure functions over a BudgetRepository — used
 * by both the MCP server and the in-process API adapters.
 */

import type { BudgetRepository } from "@capybudget/persistence"
import {
  createAccount,
  createOpeningBalanceTransaction,
  updateAccount,
  deleteAccount,
  archiveAccount,
  unarchiveAccount,
  setNetWorthExclusions,
  createCategory,
  updateCategory,
  deleteCategory,
  archiveCategory,
  unarchiveCategory,
  setCategoryAssigned,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  bulkAssignCategory,
  bulkMoveAccount,
  bulkChangeDate,
  bulkChangeMerchant,
  formatMoney,
  type AccountType,
  type TransactionType,
} from "@capybudget/core"

export async function handleCreateTransaction(
  repo: BudgetRepository,
  args: Record<string, unknown>,
): Promise<string> {
  const type = args.type as TransactionType
  if (type === "transfer" && !args.toAccountId) {
    return JSON.stringify({ error: "toAccountId is required for transfers" })
  }

  const existing = await repo.getTransactions()
  const next = createTransaction(
    {
      type,
      amount: args.amount as number,
      accountId: args.accountId as string,
      categoryId: (args.categoryId as string) ?? "",
      toAccountId: args.toAccountId as string | undefined,
      date: args.date as string,
      merchant: (args.merchant as string) ?? "",
      note: (args.note as string) ?? "",
    },
    existing,
  )
  await repo.saveTransactions(next)

  const created = next.slice(existing.length)
  return JSON.stringify({
    success: true,
    created: created.map((t) => ({
      id: t.id,
      type: t.type,
      amount: formatMoney(t.amount),
      accountId: t.accountId,
    })),
  })
}

export async function handleUpdateTransaction(
  repo: BudgetRepository,
  args: Record<string, unknown>,
): Promise<string> {
  const existing = await repo.getTransactions()
  const original = existing.find((t) => t.id === args.id)
  if (!original) return JSON.stringify({ error: `Transaction ${args.id} not found` })

  const effectiveType = (args.type as TransactionType) ?? original.type

  // Infer toAccountId from the existing transfer pair if not provided
  let toAccountId = args.toAccountId as string | undefined
  if (effectiveType === "transfer" && !toAccountId && original.transferPairId) {
    const pair = existing.find((t) => t.id === original.transferPairId)
    if (pair) toAccountId = pair.accountId
  }
  if (effectiveType === "transfer" && !toAccountId) {
    return JSON.stringify({ error: "toAccountId is required for transfers" })
  }

  const next = updateTransaction(
    {
      id: args.id as string,
      type: effectiveType,
      amount: (args.amount as number) ?? Math.abs(original.amount),
      accountId: (args.accountId as string) ?? original.accountId,
      categoryId: (args.categoryId as string) ?? original.categoryId,
      toAccountId,
      date: (args.date as string) ?? original.datetime.slice(0, 10),
      merchant: (args.merchant as string) ?? original.merchant,
      note: (args.note as string) ?? original.note,
    },
    existing,
  )
  await repo.saveTransactions(next)
  return JSON.stringify({ success: true, id: args.id })
}

export async function handleDeleteTransactions(
  repo: BudgetRepository,
  args: Record<string, unknown>,
): Promise<string> {
  const ids = args.ids as string[]
  let transactions = await repo.getTransactions()

  for (const id of ids) {
    const txn = transactions.find((t) => t.id === id)
    if (txn) {
      transactions = deleteTransaction(txn, transactions)
    }
  }

  await repo.saveTransactions(transactions)
  return JSON.stringify({ success: true, deleted: ids.length })
}

export async function handleCreateAccount(
  repo: BudgetRepository,
  args: Record<string, unknown>,
): Promise<string> {
  const accounts = await repo.getAccounts()
  const account = createAccount(
    {
      name: args.name as string,
      type: args.type as AccountType,
    },
    accounts,
  )

  const nextAccounts = [...accounts, account]
  await repo.saveAccounts(nextAccounts)

  if (args.openingBalance && (args.openingBalance as number) !== 0) {
    const transactions = await repo.getTransactions()
    const nextTransactions = createOpeningBalanceTransaction(
      account,
      args.openingBalance as number,
      transactions,
    )
    await repo.saveTransactions(nextTransactions)
  }

  return JSON.stringify({
    success: true,
    account: {
      id: account.id,
      name: account.name,
      type: account.type,
    },
  })
}

export async function handleUpdateAccount(
  repo: BudgetRepository,
  args: Record<string, unknown>,
): Promise<string> {
  const accounts = await repo.getAccounts()
  const existing = accounts.find((a) => a.id === args.id)
  if (!existing) return JSON.stringify({ error: `Account ${args.id} not found` })

  const next = updateAccount(
    {
      id: args.id as string,
      name: (args.name as string) ?? existing.name,
      type: (args.type as AccountType) ?? existing.type,
    },
    accounts,
  )
  await repo.saveAccounts(next)
  return JSON.stringify({ success: true, id: args.id })
}

export async function handleDeleteAccount(
  repo: BudgetRepository,
  args: Record<string, unknown>,
): Promise<string> {
  const accounts = await repo.getAccounts()
  const transactions = await repo.getTransactions()
  const result = deleteAccount(args.id as string, accounts, transactions)
  await repo.saveAccounts(result.accounts)
  await repo.saveTransactions(result.transactions)
  return JSON.stringify({ success: true, id: args.id })
}

export async function handleArchiveAccount(
  repo: BudgetRepository,
  args: Record<string, unknown>,
): Promise<string> {
  const accounts = await repo.getAccounts()
  const transactions = await repo.getTransactions()
  const next = archiveAccount(args.id as string, accounts, transactions)
  await repo.saveAccounts(next)
  return JSON.stringify({ success: true, id: args.id })
}

export async function handleUnarchiveAccount(
  repo: BudgetRepository,
  args: Record<string, unknown>,
): Promise<string> {
  const accounts = await repo.getAccounts()
  if (!accounts.some((a) => a.id === args.id)) {
    return JSON.stringify({
      error: `Invalid accountId "${args.id}". Call list_accounts to see valid IDs.`,
    })
  }
  const next = unarchiveAccount(args.id as string, accounts)
  await repo.saveAccounts(next)
  return JSON.stringify({ success: true, id: args.id })
}

export async function handleSetNetWorthExclusions(
  repo: BudgetRepository,
  args: Record<string, unknown>,
): Promise<string> {
  const accountIds = args.accountIds as string[] | undefined
  const exclude = args.exclude as boolean | undefined
  if (!Array.isArray(accountIds) || accountIds.length === 0) {
    return JSON.stringify({ error: "accountIds must be a non-empty array" })
  }
  if (typeof exclude !== "boolean") {
    return JSON.stringify({ error: "exclude must be a boolean" })
  }

  const accounts = await repo.getAccounts()
  const known = new Set(accounts.map((a) => a.id))
  const invalid = accountIds.filter((id) => !known.has(id))
  if (invalid.length > 0) {
    return JSON.stringify({
      error: `Invalid accountId(s) ${JSON.stringify(invalid)}. Call list_accounts to see valid IDs.`,
    })
  }

  // setNetWorthExclusions takes the full excluded set, so merge the new
  // intent with the existing flags on every other active account.
  const target = new Set(accountIds)
  const finalExcluded = new Set<string>()
  for (const a of accounts) {
    if (a.archived) continue
    const next = target.has(a.id) ? exclude : a.excludeFromNetWorth
    if (next) finalExcluded.add(a.id)
  }
  const nextAccounts = setNetWorthExclusions(finalExcluded, accounts)
  await repo.saveAccounts(nextAccounts)
  return JSON.stringify({
    success: true,
    updated: accountIds.length,
    exclude,
  })
}

export async function handleCreateCategory(
  repo: BudgetRepository,
  args: Record<string, unknown>,
): Promise<string> {
  const existing = await repo.getCategories()
  const next = createCategory(
    {
      name: args.name as string,
      group: args.group as string,
    },
    existing,
  )
  await repo.saveCategories(next)

  const created = next[next.length - 1]
  return JSON.stringify({
    success: true,
    category: {
      id: created.id,
      name: created.name,
      group: created.group,
    },
  })
}

export async function handleUpdateCategory(
  repo: BudgetRepository,
  args: Record<string, unknown>,
): Promise<string> {
  const categories = await repo.getCategories()
  const existing = categories.find((c) => c.id === args.id)
  if (!existing) return JSON.stringify({ error: `Category ${args.id} not found` })

  const next = updateCategory(
    {
      id: args.id as string,
      name: (args.name as string) ?? existing.name,
      group: (args.group as string) ?? existing.group,
    },
    categories,
  )
  await repo.saveCategories(next)
  return JSON.stringify({ success: true, id: args.id })
}

export async function handleDeleteCategory(
  repo: BudgetRepository,
  args: Record<string, unknown>,
): Promise<string> {
  const categories = await repo.getCategories()
  const transactions = await repo.getTransactions()
  const result = deleteCategory(args.id as string, categories, transactions)
  await repo.saveCategories(result.categories)
  await repo.saveTransactions(result.transactions)
  return JSON.stringify({ success: true, id: args.id })
}

export async function handleArchiveCategory(
  repo: BudgetRepository,
  args: Record<string, unknown>,
): Promise<string> {
  const existing = await repo.getCategories()
  const next = archiveCategory(args.id as string, existing)
  await repo.saveCategories(next)
  return JSON.stringify({ success: true, id: args.id })
}

export async function handleUnarchiveCategory(
  repo: BudgetRepository,
  args: Record<string, unknown>,
): Promise<string> {
  const existing = await repo.getCategories()
  if (!existing.some((c) => c.id === args.id)) {
    return JSON.stringify({
      error: `Invalid categoryId "${args.id}". Call list_categories to see valid IDs.`,
    })
  }
  const next = unarchiveCategory(args.id as string, existing)
  await repo.saveCategories(next)
  return JSON.stringify({ success: true, id: args.id })
}

export async function handleSetCategoryBudget(
  repo: BudgetRepository,
  args: Record<string, unknown>,
): Promise<string> {
  const categoryId = args.categoryId as string | undefined
  // assigned is meaningful as null (untracked) vs omitted — guard via
  // `in` so `null` survives, while a missing key trips the error.
  if (!("assigned" in args)) {
    return JSON.stringify({ error: "assigned is required (use null for untracked)" })
  }
  const assigned = args.assigned as number | null
  if (assigned !== null && (!Number.isInteger(assigned) || assigned < 0)) {
    return JSON.stringify({
      error: "assigned must be a non-negative integer (cents) or null",
    })
  }

  const existing = await repo.getCategories()
  if (!existing.some((c) => c.id === categoryId)) {
    return JSON.stringify({
      error: `Invalid categoryId "${categoryId}". Call list_categories to see valid IDs.`,
    })
  }
  const next = setCategoryAssigned(categoryId as string, assigned, existing)
  await repo.saveCategories(next)
  return JSON.stringify({
    success: true,
    categoryId,
    assigned,
  })
}

export async function handleAssignCategories(
  repo: BudgetRepository,
  args: Record<string, unknown>,
): Promise<string> {
  const transactions = await repo.getTransactions()
  const ids = new Set(args.transactionIds as string[])
  const next = bulkAssignCategory(ids, args.categoryId as string, transactions)
  await repo.saveTransactions(next)
  return JSON.stringify({ success: true, updated: ids.size })
}

export async function handleBulkUpdateTransactions(
  repo: BudgetRepository,
  args: Record<string, unknown>,
): Promise<string> {
  const transactionIds = args.transactionIds as string[] | undefined
  const set = args.set as
    | { accountId?: string; date?: string; merchant?: string }
    | undefined

  if (!Array.isArray(transactionIds) || transactionIds.length === 0) {
    return JSON.stringify({ error: "transactionIds must be a non-empty array" })
  }
  if (!set || typeof set !== "object") {
    return JSON.stringify({ error: "set is required" })
  }
  const accountId = set.accountId
  const date = set.date
  const merchant = set.merchant
  if (accountId === undefined && date === undefined && merchant === undefined) {
    return JSON.stringify({
      error: "set must include at least one of accountId, date, merchant",
    })
  }

  // Mirror the UI: account moves and merchant changes both skip transfers,
  // so the "Nothing to do" check has to account for that, not the raw count.
  const ids = new Set(transactionIds)
  let transactions = await repo.getTransactions()
  const targeted = transactions.filter((t) => ids.has(t.id))
  if (targeted.length === 0) {
    return JSON.stringify({
      error: "None of the provided transactionIds matched existing transactions.",
    })
  }
  const nonTransferTargeted = targeted.filter((t) => t.type !== "transfer").length

  // Per-field counters — matches the enrich_update style so the model can
  // tell which fields actually landed (transfers silently skipped show up as
  // 0 for account/merchant, non-zero for date).
  const counts = { accountId: 0, date: 0, merchant: 0 }

  if (accountId !== undefined) {
    const accounts = await repo.getAccounts()
    if (!accounts.some((a) => a.id === accountId)) {
      return JSON.stringify({
        error: `Invalid accountId "${accountId}". Call list_accounts to see valid IDs.`,
      })
    }
    transactions = bulkMoveAccount(ids, accountId, transactions)
    counts.accountId = nonTransferTargeted
  }
  if (date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return JSON.stringify({
        error: `Invalid date "${date}". Expected YYYY-MM-DD.`,
      })
    }
    transactions = bulkChangeDate(ids, date, transactions)
    counts.date = targeted.length
  }
  if (merchant !== undefined) {
    transactions = bulkChangeMerchant(ids, merchant, transactions)
    counts.merchant = nonTransferTargeted
  }

  await repo.saveTransactions(transactions)

  // Summary mirrors the enrich_update voice: tell the model exactly what
  // happened per field so it doesn't re-issue the same call.
  const parts: string[] = []
  if (accountId !== undefined) parts.push(`account on ${counts.accountId}`)
  if (date !== undefined) parts.push(`date on ${counts.date}`)
  if (merchant !== undefined) parts.push(`merchant on ${counts.merchant}`)
  const summary = `Updated ${targeted.length} transaction(s): ${parts.join(", ")}.`

  return JSON.stringify({
    success: true,
    matched: targeted.length,
    counts,
    summary,
  })
}
