import type { Account, Category, Transaction } from "@capybudget/core"
import { formatMoney, getAccountBalance } from "@capybudget/core"
import type { BudgetRepository } from "@capybudget/persistence"

// ── Tool schemas ─────────────────────────────────────────────────

export const DATA_TOOLS = [
  {
    name: "list_accounts",
    description:
      "List all accounts with their current balances. Returns account name, type, balance, and whether it's archived.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "list_transactions",
    description:
      "List transactions with optional filters. Amounts are in cents (negative = expense). Dates are ISO strings.",
    inputSchema: {
      type: "object" as const,
      properties: {
        accountId: {
          type: "string",
          description: "Filter by account ID",
        },
        categoryId: {
          type: "string",
          description: "Filter by category ID",
        },
        merchant: {
          type: "string",
          description: "Filter by merchant name (case-insensitive substring match)",
        },
        startDate: {
          type: "string",
          description: "Filter transactions on or after this date (YYYY-MM-DD)",
        },
        endDate: {
          type: "string",
          description: "Filter transactions on or before this date (YYYY-MM-DD)",
        },
        limit: {
          type: "number",
          description: "Maximum number of transactions to return (default: 50)",
        },
      },
    },
  },
  {
    name: "list_categories",
    description:
      "List all categories grouped by type (Income, Fixed, Daily Living, Personal, Irregular).",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "spending_summary",
    description:
      "Get spending aggregated by category for a date range. Returns category name, transaction count, and total amount.",
    inputSchema: {
      type: "object" as const,
      properties: {
        startDate: {
          type: "string",
          description: "Start date (YYYY-MM-DD). Defaults to first day of current month.",
        },
        endDate: {
          type: "string",
          description: "End date (YYYY-MM-DD). Defaults to today.",
        },
      },
    },
  },
] as const

// ── Tool handlers ────────────────────────────────────────────────

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

export async function handleListTransactions(
  repo: BudgetRepository,
  args: Record<string, unknown>,
): Promise<string> {
  let txns = await repo.getTransactions()
  const accounts = await repo.getAccounts()
  const categories = await repo.getCategories()

  const accountMap = new Map(accounts.map((a: Account) => [a.id, a.name]))
  const categoryMap = new Map(categories.map((c: Category) => [c.id, c.name]))

  if (args.accountId) {
    txns = txns.filter((t: Transaction) => t.accountId === args.accountId)
  }
  if (args.categoryId) {
    txns = txns.filter((t: Transaction) => t.categoryId === args.categoryId)
  }
  if (args.merchant) {
    const q = (args.merchant as string).toLowerCase()
    txns = txns.filter((t: Transaction) => t.merchant.toLowerCase().includes(q))
  }
  if (args.startDate) {
    txns = txns.filter((t: Transaction) => t.datetime >= (args.startDate as string))
  }
  if (args.endDate) {
    txns = txns.filter(
      (t: Transaction) => t.datetime <= (args.endDate as string) + "T23:59:59",
    )
  }

  // Sort newest first
  txns.sort((a: Transaction, b: Transaction) => b.datetime.localeCompare(a.datetime))

  const limit = (args.limit as number) || 50
  txns = txns.slice(0, limit)

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

export async function handleSpendingSummary(
  repo: BudgetRepository,
  args: Record<string, unknown>,
): Promise<string> {
  const now = new Date()
  const startDate =
    (args.startDate as string) ??
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`
  const endDate = (args.endDate as string) ?? now.toISOString().slice(0, 10)

  const transactions = await repo.getTransactions()
  const categories = await repo.getCategories()
  const categoryMap = new Map(categories.map((c: Category) => [c.id, c.name]))

  const expenses = transactions.filter(
    (t: Transaction) =>
      t.type === "expense" &&
      t.datetime >= startDate &&
      t.datetime <= endDate + "T23:59:59",
  )

  const byCat = new Map<string, { count: number; totalCents: number }>()
  for (const t of expenses) {
    const catName = categoryMap.get(t.categoryId) ?? (t.categoryId || "Uncategorized")
    const entry = byCat.get(catName) ?? { count: 0, totalCents: 0 }
    entry.count++
    entry.totalCents += t.amount // negative cents
    byCat.set(catName, entry)
  }

  const result = [...byCat.entries()]
    .sort((a, b) => a[1].totalCents - b[1].totalCents) // most negative first
    .map(([category, { count, totalCents }]) => ({
      category,
      transactions: count,
      total: formatMoney(totalCents),
      totalCents,
    }))

  return JSON.stringify(
    { period: `${startDate} to ${endDate}`, spending: result },
    null,
    2,
  )
}
