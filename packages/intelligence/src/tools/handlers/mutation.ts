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
  stampFxRate,
  stampTransferRates,
  resolveRate,
  type Account,
  type AccountType,
  type CurrencySettings,
  type TransactionType,
} from "@capybudget/core"

// The inflow magnitude in the destination's currency for a cross-currency
// transfer when the model didn't supply one: the source amount at today's
// display cross-rate, rate(from→to) = rate(from→default) / rate(to→default).
// Same-currency transfers mirror the source amount unchanged.
function inferToAmount(
  fromAmount: number,
  from: Account,
  to: Account,
  currencies: Record<string, CurrencySettings>,
  defaultCurrency: string,
): number {
  if (from.currency === to.currency) return fromAmount
  const fromToDefault = resolveRate(from.currency, currencies, defaultCurrency).rate
  const toToDefault = resolveRate(to.currency, currencies, defaultCurrency).rate
  return Math.round((fromAmount * fromToDefault) / toToDefault)
}

export async function handleCreateTransaction(
  repo: BudgetRepository,
  currency: string,
  currencies: Record<string, CurrencySettings> | undefined,
  args: Record<string, unknown>,
): Promise<string> {
  const type = args.type as TransactionType
  if (type === "transfer" && !args.toAccountId) {
    return JSON.stringify({ error: "toAccountId is required for transfers" })
  }

  const accountId = args.accountId as string
  const amount = args.amount as number
  const toAccountId = args.toAccountId as string | undefined
  // Stamp today's rate at entry (same as the UI create path), so AI-created
  // flows freeze their rate too. A transfer stamps each leg from its own
  // account's currency, deriving the bank rate from the two amounts when one
  // side is the default (see stampTransferRates); a plain flow stamps just its
  // source account's rate.
  const accounts = await repo.getAccounts()
  const cur = currencies ?? {}
  let fxRate: number | undefined
  let toFxRate: number | undefined
  let toAmount: number | undefined
  if (type === "transfer") {
    const from = accounts.find((a) => a.id === accountId)
    const to = accounts.find((a) => a.id === toAccountId)
    if (from && to) {
      toAmount = (args.toAmount as number | undefined) ?? inferToAmount(amount, from, to, cur, currency)
      const rates = stampTransferRates(from.currency, to.currency, amount, toAmount, cur, currency)
      fxRate = rates.fromRate
      toFxRate = rates.toRate
    }
  } else {
    const account = accounts.find((a) => a.id === accountId)
    fxRate = account ? stampFxRate(account.currency, cur, currency) : undefined
  }

  const existing = await repo.getTransactions()
  const next = createTransaction(
    {
      type,
      amount,
      accountId,
      categoryId: (args.categoryId as string) ?? "",
      toAccountId,
      date: args.date as string,
      merchant: (args.merchant as string) ?? "",
      note: (args.note as string) ?? "",
      fxRate,
      toAmount,
      toFxRate,
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
      amount: formatMoney(t.amount, currency),
      accountId: t.accountId,
    })),
  })
}

export async function handleUpdateTransaction(
  repo: BudgetRepository,
  currency: string,
  currencies: Record<string, CurrencySettings> | undefined,
  args: Record<string, unknown>,
): Promise<string> {
  const existing = await repo.getTransactions()
  const original = existing.find((t) => t.id === args.id)
  if (!original) return JSON.stringify({ error: `Transaction ${args.id} not found` })

  const effectiveType = (args.type as TransactionType) ?? original.type
  const accountId = (args.accountId as string) ?? original.accountId
  const amount = (args.amount as number) ?? Math.abs(original.amount)

  // Infer toAccountId from the existing transfer pair if not provided
  let toAccountId = args.toAccountId as string | undefined
  if (effectiveType === "transfer" && !toAccountId && original.transferPairId) {
    const pair = existing.find((t) => t.id === original.transferPairId)
    if (pair) toAccountId = pair.accountId
  }
  if (effectiveType === "transfer" && !toAccountId) {
    return JSON.stringify({ error: "toAccountId is required for transfers" })
  }

  // Re-stamp a transfer's per-leg rates from the edited legs (amounts or the
  // destination currency may have changed). Plain flows never re-rate —
  // updateTransaction preserves their original stamp.
  let fxRate: number | undefined
  let toFxRate: number | undefined
  let toAmount: number | undefined
  if (effectiveType === "transfer") {
    const accounts = await repo.getAccounts()
    const from = accounts.find((a) => a.id === accountId)
    const to = accounts.find((a) => a.id === toAccountId)
    if (from && to) {
      const cur = currencies ?? {}
      toAmount = (args.toAmount as number | undefined) ?? inferToAmount(amount, from, to, cur, currency)
      const rates = stampTransferRates(from.currency, to.currency, amount, toAmount, cur, currency)
      fxRate = rates.fromRate
      toFxRate = rates.toRate
    }
  }

  const next = updateTransaction(
    {
      id: args.id as string,
      type: effectiveType,
      amount,
      accountId,
      categoryId: (args.categoryId as string) ?? original.categoryId,
      toAccountId,
      date: (args.date as string) ?? original.datetime.slice(0, 10),
      merchant: (args.merchant as string) ?? original.merchant,
      note: (args.note as string) ?? original.note,
      fxRate,
      toAmount,
      toFxRate,
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
  currency: string,
  currencies: Record<string, CurrencySettings> | undefined,
  args: Record<string, unknown>,
): Promise<string> {
  const accounts = await repo.getAccounts()
  const account = createAccount(
    {
      name: args.name as string,
      type: args.type as AccountType,
      // AI-created accounts always get the budget default; a model-facing
      // currency parameter on the tool is U6's job.
      currency,
    },
    accounts,
  )

  const nextAccounts = [...accounts, account]
  await repo.saveAccounts(nextAccounts)

  if (args.openingBalance && (args.openingBalance as number) !== 0) {
    const transactions = await repo.getTransactions()
    const fxRate = stampFxRate(account.currency, currencies ?? {}, currency)
    const nextTransactions = createOpeningBalanceTransaction(
      account,
      args.openingBalance as number,
      transactions,
      fxRate,
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
  const id = args.id as string
  const accounts = await repo.getAccounts()
  const existing = accounts.find((a) => a.id === id)
  if (!existing) return JSON.stringify({ error: `Account ${id} not found` })

  let next = updateAccount(
    {
      id,
      name: (args.name as string) ?? existing.name,
      type: (args.type as AccountType) ?? existing.type,
    },
    accounts,
  )

  // archiveAccount throws on a non-zero balance; running it before saving
  // means a rejected archive never persists the name/type/exclusion edits.
  if (typeof args.archived === "boolean") {
    if (args.archived) {
      const transactions = await repo.getTransactions()
      next = archiveAccount(id, next, transactions)
    } else {
      next = unarchiveAccount(id, next)
    }
  }

  if (typeof args.excludeFromNetWorth === "boolean") {
    const exclude = args.excludeFromNetWorth
    next = next.map((a) =>
      a.id === id && !a.archived ? { ...a, excludeFromNetWorth: exclude } : a,
    )
  }

  await repo.saveAccounts(next)
  return JSON.stringify({ success: true, id })
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
  const id = args.id as string
  const categories = await repo.getCategories()
  const existing = categories.find((c) => c.id === id)
  if (!existing) return JSON.stringify({ error: `Category ${id} not found` })

  // budgetCents is meaningful as null (untracked) vs omitted (unchanged), so
  // guard with `in` to keep `null` distinct from a missing key.
  if ("budgetCents" in args) {
    const budgetCents = args.budgetCents as number | null
    if (budgetCents !== null && (!Number.isInteger(budgetCents) || budgetCents < 0)) {
      return JSON.stringify({
        error: "budgetCents must be a non-negative integer (cents) or null",
      })
    }
  }

  let next = updateCategory(
    {
      id,
      name: (args.name as string) ?? existing.name,
      group: (args.group as string) ?? existing.group,
    },
    categories,
  )

  if (typeof args.archived === "boolean") {
    next = args.archived
      ? archiveCategory(id, next)
      : unarchiveCategory(id, next)
  }

  if ("budgetCents" in args) {
    next = setCategoryAssigned(id, args.budgetCents as number | null, next)
  }

  await repo.saveCategories(next)
  return JSON.stringify({ success: true, id })
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

export async function handleBulkUpdateTransactions(
  repo: BudgetRepository,
  args: Record<string, unknown>,
): Promise<string> {
  const transactionIds = args.transactionIds as string[] | undefined
  const set = args.set as
    | { categoryId?: string; accountId?: string; date?: string; merchant?: string }
    | undefined

  if (!Array.isArray(transactionIds) || transactionIds.length === 0) {
    return JSON.stringify({ error: "transactionIds must be a non-empty array" })
  }
  if (!set || typeof set !== "object") {
    return JSON.stringify({ error: "set is required" })
  }
  const categoryId = set.categoryId
  const accountId = set.accountId
  const date = set.date
  const merchant = set.merchant
  if (
    categoryId === undefined &&
    accountId === undefined &&
    date === undefined &&
    merchant === undefined
  ) {
    return JSON.stringify({
      error: "set must include at least one of categoryId, accountId, date, merchant",
    })
  }

  // Mirror the UI: category, account, and merchant changes all skip transfers,
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

  const counts = { categoryId: 0, accountId: 0, date: 0, merchant: 0 }

  if (categoryId !== undefined) {
    const categories = await repo.getCategories()
    if (!categories.some((c) => c.id === categoryId)) {
      return JSON.stringify({
        error: `Invalid categoryId "${categoryId}". Call list_categories to see valid IDs.`,
      })
    }
    transactions = bulkAssignCategory(ids, categoryId, transactions)
    counts.categoryId = nonTransferTargeted
  }
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

  // Report exactly what changed per field so the model doesn't re-issue the
  // same call.
  const parts: string[] = []
  if (categoryId !== undefined) parts.push(`category on ${counts.categoryId}`)
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
