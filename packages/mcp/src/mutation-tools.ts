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

// ── Tool schemas ─────────────────────────────────────────────────

export const MUTATION_TOOLS = [
  // ── Transactions ────────────────────────────────────────────────
  {
    name: "create_transaction",
    description:
      "Create a new transaction. Amount is always positive cents — sign is determined by type. For transfers, provide toAccountId.",
    inputSchema: {
      type: "object" as const,
      properties: {
        type: {
          type: "string",
          enum: ["income", "expense", "transfer"],
          description: "Transaction type",
        },
        amount: {
          type: "number",
          description: "Amount in positive cents (e.g. 1250 = $12.50)",
        },
        accountId: {
          type: "string",
          description: "Account ID (source account for transfers)",
        },
        categoryId: {
          type: "string",
          description: "Category ID (ignored for transfers)",
        },
        toAccountId: {
          type: "string",
          description: "Destination account ID (required for transfers)",
        },
        date: {
          type: "string",
          description: "Date in YYYY-MM-DD format",
        },
        merchant: {
          type: "string",
          description: "Merchant name (ignored for transfers)",
        },
        note: {
          type: "string",
          description: "Optional note",
        },
      },
      required: ["type", "amount", "accountId", "date"],
    },
  },
  {
    name: "update_transaction",
    description:
      "Update an existing transaction. Only provided fields are changed. Amount is always positive cents. For transfers, both legs are updated together.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "Transaction ID to update",
        },
        type: {
          type: "string",
          enum: ["income", "expense", "transfer"],
          description: "New transaction type",
        },
        amount: {
          type: "number",
          description: "New amount in positive cents",
        },
        accountId: {
          type: "string",
          description: "New account ID (source for transfers)",
        },
        categoryId: {
          type: "string",
          description: "New category ID",
        },
        toAccountId: {
          type: "string",
          description: "New destination account (for transfers)",
        },
        date: {
          type: "string",
          description: "New date in YYYY-MM-DD format",
        },
        merchant: {
          type: "string",
          description: "New merchant name",
        },
        note: {
          type: "string",
          description: "New note",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_transactions",
    description:
      "Delete one or more transactions by ID. Transfer pairs are automatically removed.",
    inputSchema: {
      type: "object" as const,
      properties: {
        ids: {
          type: "array",
          items: { type: "string" },
          description: "Transaction IDs to delete",
        },
      },
      required: ["ids"],
    },
  },

  // ── Accounts ────────────────────────────────────────────────────
  {
    name: "create_account",
    description:
      "Create a new account. Optionally set an opening balance (positive cents).",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Account name",
        },
        type: {
          type: "string",
          enum: ["cash", "checking", "savings", "credit_card", "loan", "asset", "crypto"],
          description: "Account type",
        },
        openingBalance: {
          type: "number",
          description: "Opening balance in positive cents (optional)",
        },
      },
      required: ["name", "type"],
    },
  },
  {
    name: "update_account",
    description: "Update an account's name or type.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "Account ID to update",
        },
        name: {
          type: "string",
          description: "New account name",
        },
        type: {
          type: "string",
          enum: ["cash", "checking", "savings", "credit_card", "loan", "asset", "crypto"],
          description: "New account type",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_account",
    description:
      "Delete an account. Fails if the account has transactions (other than opening balance).",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "Account ID to delete",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "archive_account",
    description:
      "Archive an account. Fails if the balance is not zero.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "Account ID to archive",
        },
      },
      required: ["id"],
    },
  },

  // ── Categories ──────────────────────────────────────────────────
  {
    name: "create_category",
    description: "Create a new category in a group.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Category name",
        },
        group: {
          type: "string",
          enum: ["Income", "Fixed", "Daily Living", "Personal", "Irregular"],
          description: "Category group",
        },
      },
      required: ["name", "group"],
    },
  },
  {
    name: "update_category",
    description: "Update a category's name or group.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "Category ID to update",
        },
        name: {
          type: "string",
          description: "New category name",
        },
        group: {
          type: "string",
          enum: ["Income", "Fixed", "Daily Living", "Personal", "Irregular"],
          description: "New category group",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_category",
    description:
      "Delete a category. Transactions referencing it will have their category cleared.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "Category ID to delete",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "archive_category",
    description: "Archive a category so it's hidden from the UI.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "Category ID to archive",
        },
      },
      required: ["id"],
    },
  },

  // ── Bulk ────────────────────────────────────────────────────────
  {
    name: "assign_categories",
    description:
      "Assign a category to multiple transactions at once. Skips transfers.",
    inputSchema: {
      type: "object" as const,
      properties: {
        transactionIds: {
          type: "array",
          items: { type: "string" },
          description: "Transaction IDs to update",
        },
        categoryId: {
          type: "string",
          description: "Category ID to assign",
        },
      },
      required: ["transactionIds", "categoryId"],
    },
  },
] as const

// ── Tool handlers ────────────────────────────────────────────────

export async function handleCreateTransaction(
  repo: BudgetRepository,
  args: Record<string, unknown>,
): Promise<string> {
  const existing = await repo.getTransactions()
  const next = createTransaction(
    {
      type: args.type as TransactionType,
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

  const next = updateTransaction(
    {
      id: args.id as string,
      type: (args.type as TransactionType) ?? original.type,
      amount: (args.amount as number) ?? Math.abs(original.amount),
      accountId: (args.accountId as string) ?? original.accountId,
      categoryId: (args.categoryId as string) ?? original.categoryId,
      toAccountId: args.toAccountId as string | undefined,
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
