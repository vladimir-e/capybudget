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
  createCategory,
  updateCategory,
  deleteCategory,
  archiveCategory,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  bulkAssignCategory,
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
