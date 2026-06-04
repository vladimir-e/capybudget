import { describe, it, expect, vi } from "vitest"
import type { Account, Category, Transaction } from "@capybudget/core"
import {
  makeAccount,
  makeCategory,
  makeTransaction as makeTxn,
} from "@capybudget/core/test-factories"
import type { BudgetRepository } from "@capybudget/persistence"
import {
  handleListAccounts,
  handleListCategories,
  handleListTransactions,
  handleSearchTransactions,
} from "./data"

function createMockRepo(data: {
  accounts?: Account[]
  categories?: Category[]
  transactions?: Transaction[]
}): BudgetRepository {
  return {
    getAccounts: vi.fn().mockResolvedValue(data.accounts ?? []),
    getCategories: vi.fn().mockResolvedValue(data.categories ?? []),
    getTransactions: vi.fn().mockResolvedValue(data.transactions ?? []),
    saveAccounts: vi.fn().mockResolvedValue(undefined),
    saveCategories: vi.fn().mockResolvedValue(undefined),
    saveTransactions: vi.fn().mockResolvedValue(undefined),
  }
}

// ── handleListAccounts ──────────────────────────────────────────

describe("handleListAccounts", () => {
  it("returns formatted account list with balances", async () => {
    const repo = createMockRepo({
      accounts: [
        makeAccount({ id: "acc-1", name: "Checking", type: "checking" }),
        makeAccount({ id: "acc-2", name: "Savings", type: "savings", archived: true }),
      ],
      transactions: [
        makeTxn({ accountId: "acc-1", amount: 100000 }),
        makeTxn({ accountId: "acc-1", amount: -3500 }),
        makeTxn({ accountId: "acc-2", amount: 50000 }),
      ],
    })

    const result = JSON.parse(await handleListAccounts(repo))

    expect(result).toHaveLength(2)

    expect(result[0]).toEqual({
      id: "acc-1",
      name: "Checking",
      type: "checking",
      balance: "$965.00",
      balanceCents: 96500,
      archived: false,
    })

    expect(result[1]).toEqual({
      id: "acc-2",
      name: "Savings",
      type: "savings",
      balance: "$500.00",
      balanceCents: 50000,
      archived: true,
    })
  })

  it("returns empty array when no accounts exist", async () => {
    const repo = createMockRepo({ accounts: [], transactions: [] })
    const result = JSON.parse(await handleListAccounts(repo))
    expect(result).toEqual([])
  })

  it("shows zero balance when account has no transactions", async () => {
    const repo = createMockRepo({
      accounts: [makeAccount({ id: "acc-1" })],
      transactions: [],
    })

    const result = JSON.parse(await handleListAccounts(repo))
    expect(result[0].balance).toBe("$0.00")
    expect(result[0].balanceCents).toBe(0)
  })
})

// ── handleListCategories ────────────────────────────────────────

describe("handleListCategories", () => {
  it("groups categories by their group field", async () => {
    const repo = createMockRepo({
      categories: [
        makeCategory({ id: "cat-1", name: "Groceries", group: "Daily Living" }),
        makeCategory({ id: "cat-2", name: "Rent", group: "Fixed" }),
        makeCategory({ id: "cat-3", name: "Coffee", group: "Daily Living" }),
        makeCategory({ id: "cat-4", name: "Salary", group: "Income" }),
      ],
    })

    const result = JSON.parse(await handleListCategories(repo))

    expect(result["Daily Living"]).toHaveLength(2)
    expect(result["Daily Living"][0]).toEqual({ id: "cat-1", name: "Groceries", archived: false })
    expect(result["Daily Living"][1]).toEqual({ id: "cat-3", name: "Coffee", archived: false })
    expect(result["Fixed"]).toHaveLength(1)
    expect(result["Fixed"][0]).toEqual({ id: "cat-2", name: "Rent", archived: false })
    expect(result["Income"]).toHaveLength(1)
    expect(result["Income"][0]).toEqual({ id: "cat-4", name: "Salary", archived: false })
  })

  it("returns empty object when no categories exist", async () => {
    const repo = createMockRepo({ categories: [] })
    const result = JSON.parse(await handleListCategories(repo))
    expect(result).toEqual({})
  })

  it("preserves archived status", async () => {
    const repo = createMockRepo({
      categories: [makeCategory({ id: "cat-1", name: "Old", group: "Personal", archived: true })],
    })

    const result = JSON.parse(await handleListCategories(repo))
    expect(result["Personal"][0].archived).toBe(true)
  })
})

// ── handleListTransactions ──────────────────────────────────────

describe("handleListTransactions", () => {
  const baseAccounts = [
    makeAccount({ id: "acc-1", name: "Checking" }),
    makeAccount({ id: "acc-2", name: "Savings" }),
  ]
  const baseCategories = [
    makeCategory({ id: "cat-1", name: "Groceries" }),
    makeCategory({ id: "cat-2", name: "Rent" }),
  ]

  it("returns formatted transaction list sorted newest first", async () => {
    const repo = createMockRepo({
      accounts: baseAccounts,
      categories: baseCategories,
      transactions: [
        makeTxn({ id: "txn-old", datetime: "2026-01-10T10:00:00.000Z", amount: -2000 }),
        makeTxn({ id: "txn-new", datetime: "2026-01-20T10:00:00.000Z", amount: -3000 }),
      ],
    })

    const result = JSON.parse(await handleListTransactions(repo, {}))

    expect(result).toHaveLength(2)
    expect(result[0].id).toBe("txn-new")
    expect(result[1].id).toBe("txn-old")
  })

  it("resolves account and category names", async () => {
    const repo = createMockRepo({
      accounts: baseAccounts,
      categories: baseCategories,
      transactions: [
        makeTxn({ accountId: "acc-1", categoryId: "cat-2", amount: -150000 }),
      ],
    })

    const result = JSON.parse(await handleListTransactions(repo, {}))
    expect(result[0].account).toBe("Checking")
    expect(result[0].category).toBe("Rent")
    expect(result[0].amount).toBe("-$1,500.00")
    expect(result[0].amountCents).toBe(-150000)
  })

  it("falls back to ID when account or category is unknown", async () => {
    const repo = createMockRepo({
      accounts: [],
      categories: [],
      transactions: [
        makeTxn({ accountId: "acc-unknown", categoryId: "cat-unknown" }),
      ],
    })

    const result = JSON.parse(await handleListTransactions(repo, {}))
    expect(result[0].account).toBe("acc-unknown")
    expect(result[0].category).toBe("cat-unknown")
  })

  it("shows 'Uncategorized' when categoryId is empty", async () => {
    const repo = createMockRepo({
      accounts: baseAccounts,
      categories: baseCategories,
      transactions: [makeTxn({ categoryId: "" })],
    })

    const result = JSON.parse(await handleListTransactions(repo, {}))
    expect(result[0].category).toBe("Uncategorized")
  })

  it("shows '(none)' when merchant is empty", async () => {
    const repo = createMockRepo({
      accounts: baseAccounts,
      categories: baseCategories,
      transactions: [makeTxn({ merchant: "" })],
    })

    const result = JSON.parse(await handleListTransactions(repo, {}))
    expect(result[0].merchant).toBe("(none)")
  })

  it("defaults to limit of 50", async () => {
    const transactions = Array.from({ length: 60 }, (_, i) =>
      makeTxn({ id: `txn-${i}`, datetime: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z` }),
    )
    const repo = createMockRepo({
      accounts: baseAccounts,
      categories: baseCategories,
      transactions,
    })

    const result = JSON.parse(await handleListTransactions(repo, {}))
    expect(result).toHaveLength(50)
  })

  it("respects custom limit", async () => {
    const transactions = Array.from({ length: 10 }, (_, i) =>
      makeTxn({ id: `txn-${i}` }),
    )
    const repo = createMockRepo({
      accounts: baseAccounts,
      categories: baseCategories,
      transactions,
    })

    const result = JSON.parse(await handleListTransactions(repo, { limit: 3 }))
    expect(result).toHaveLength(3)
  })

  it("filters by accountId", async () => {
    const repo = createMockRepo({
      accounts: baseAccounts,
      categories: baseCategories,
      transactions: [
        makeTxn({ id: "txn-1", accountId: "acc-1" }),
        makeTxn({ id: "txn-2", accountId: "acc-2" }),
        makeTxn({ id: "txn-3", accountId: "acc-1" }),
      ],
    })

    const result = JSON.parse(await handleListTransactions(repo, { accountId: "acc-2" }))
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("txn-2")
  })

  it("filters by categoryId", async () => {
    const repo = createMockRepo({
      accounts: baseAccounts,
      categories: baseCategories,
      transactions: [
        makeTxn({ id: "txn-1", categoryId: "cat-1" }),
        makeTxn({ id: "txn-2", categoryId: "cat-2" }),
      ],
    })

    const result = JSON.parse(await handleListTransactions(repo, { categoryId: "cat-1" }))
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("txn-1")
  })

  it("filters by merchant (case-insensitive substring)", async () => {
    const repo = createMockRepo({
      accounts: baseAccounts,
      categories: baseCategories,
      transactions: [
        makeTxn({ id: "txn-1", merchant: "Whole Foods Market" }),
        makeTxn({ id: "txn-2", merchant: "Trader Joe's" }),
        makeTxn({ id: "txn-3", merchant: "Whole Foods Express" }),
      ],
    })

    const result = JSON.parse(await handleListTransactions(repo, { merchant: "whole foods" }))
    expect(result).toHaveLength(2)
    expect(result.map((t: { id: string }) => t.id).sort()).toEqual(["txn-1", "txn-3"])
  })

  it("filters by startDate", async () => {
    const repo = createMockRepo({
      accounts: baseAccounts,
      categories: baseCategories,
      transactions: [
        makeTxn({ id: "txn-1", datetime: "2026-01-01T10:00:00.000Z" }),
        makeTxn({ id: "txn-2", datetime: "2026-01-15T10:00:00.000Z" }),
        makeTxn({ id: "txn-3", datetime: "2026-01-31T10:00:00.000Z" }),
      ],
    })

    const result = JSON.parse(await handleListTransactions(repo, { startDate: "2026-01-15" }))
    expect(result).toHaveLength(2)
    expect(result.map((t: { id: string }) => t.id).sort()).toEqual(["txn-2", "txn-3"])
  })

  it("filters by endDate (inclusive of the full day)", async () => {
    const repo = createMockRepo({
      accounts: baseAccounts,
      categories: baseCategories,
      transactions: [
        makeTxn({ id: "txn-1", datetime: "2026-01-10T08:00:00.000Z" }),
        makeTxn({ id: "txn-2", datetime: "2026-01-15T18:30:00.000Z" }),
        makeTxn({ id: "txn-3", datetime: "2026-01-20T10:00:00.000Z" }),
      ],
    })

    const result = JSON.parse(await handleListTransactions(repo, { endDate: "2026-01-15" }))
    expect(result).toHaveLength(2)
    expect(result.map((t: { id: string }) => t.id).sort()).toEqual(["txn-1", "txn-2"])
  })

  it("combines multiple filters", async () => {
    const repo = createMockRepo({
      accounts: baseAccounts,
      categories: baseCategories,
      transactions: [
        makeTxn({ id: "txn-1", accountId: "acc-1", merchant: "Store A", datetime: "2026-01-10T00:00:00.000Z" }),
        makeTxn({ id: "txn-2", accountId: "acc-1", merchant: "Store B", datetime: "2026-01-20T00:00:00.000Z" }),
        makeTxn({ id: "txn-3", accountId: "acc-2", merchant: "Store A", datetime: "2026-01-20T00:00:00.000Z" }),
      ],
    })

    const result = JSON.parse(
      await handleListTransactions(repo, {
        accountId: "acc-1",
        startDate: "2026-01-15",
      }),
    )
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("txn-2")
  })

  it("returns empty array when no transactions exist", async () => {
    const repo = createMockRepo({
      accounts: baseAccounts,
      categories: baseCategories,
      transactions: [],
    })

    const result = JSON.parse(await handleListTransactions(repo, {}))
    expect(result).toEqual([])
  })

  it("extracts date from datetime for display", async () => {
    const repo = createMockRepo({
      accounts: baseAccounts,
      categories: baseCategories,
      transactions: [makeTxn({ datetime: "2026-03-14T18:30:00.000Z" })],
    })

    const result = JSON.parse(await handleListTransactions(repo, {}))
    expect(result[0].date).toBe("2026-03-14")
  })
})

// ── handleListTransactions: sort + offset ───────────────────────

describe("handleListTransactions sort + offset", () => {
  const baseAccounts = [makeAccount({ id: "acc-1", name: "Checking" })]
  const baseCategories = [makeCategory({ id: "cat-1", name: "Groceries" })]

  function buildRepo() {
    return createMockRepo({
      accounts: baseAccounts,
      categories: baseCategories,
      transactions: [
        makeTxn({ id: "txn-old-small", datetime: "2024-01-01T00:00:00.000Z", amount: -1000 }),
        makeTxn({ id: "txn-mid-big-exp", datetime: "2025-06-15T00:00:00.000Z", amount: -50000 }),
        makeTxn({ id: "txn-new-income", datetime: "2026-03-10T00:00:00.000Z", amount: 200000 }),
        makeTxn({ id: "txn-newest-small", datetime: "2026-05-20T00:00:00.000Z", amount: -500 }),
      ],
    })
  }

  it("default sort is newest first (no `sort` arg)", async () => {
    const repo = buildRepo()
    const result = JSON.parse(await handleListTransactions(repo, {}))
    expect(result.map((t: { id: string }) => t.id)).toEqual([
      "txn-newest-small",
      "txn-new-income",
      "txn-mid-big-exp",
      "txn-old-small",
    ])
  })

  it("`sort: \"oldest\"` returns earliest first", async () => {
    const repo = buildRepo()
    const result = JSON.parse(await handleListTransactions(repo, { sort: "oldest" }))
    expect(result.map((t: { id: string }) => t.id)).toEqual([
      "txn-old-small",
      "txn-mid-big-exp",
      "txn-new-income",
      "txn-newest-small",
    ])
  })

  it("`sort: \"oldest\"` with `limit: 1` answers 'find my first transaction' in one call", async () => {
    const repo = buildRepo()
    const result = JSON.parse(
      await handleListTransactions(repo, { sort: "oldest", limit: 1 }),
    )
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("txn-old-small")
  })

  it("`sort: \"amount_asc\"` puts the largest expenses (most-negative) first", async () => {
    const repo = buildRepo()
    const result = JSON.parse(await handleListTransactions(repo, { sort: "amount_asc" }))
    expect(result.map((t: { id: string }) => t.id)).toEqual([
      "txn-mid-big-exp",
      "txn-old-small",
      "txn-newest-small",
      "txn-new-income",
    ])
  })

  it("`sort: \"amount_desc\"` puts the largest income (most-positive) first", async () => {
    const repo = buildRepo()
    const result = JSON.parse(await handleListTransactions(repo, { sort: "amount_desc" }))
    expect(result.map((t: { id: string }) => t.id)).toEqual([
      "txn-new-income",
      "txn-newest-small",
      "txn-old-small",
      "txn-mid-big-exp",
    ])
  })

  it("`offset` skips rows after the sort and before the limit", async () => {
    const repo = buildRepo()
    const result = JSON.parse(
      await handleListTransactions(repo, { sort: "oldest", offset: 2, limit: 1 }),
    )
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("txn-new-income")
  })

  it("`offset` past the end returns an empty array", async () => {
    const repo = buildRepo()
    const result = JSON.parse(await handleListTransactions(repo, { offset: 100 }))
    expect(result).toEqual([])
  })

  it("negative `offset` is treated as 0", async () => {
    const repo = buildRepo()
    const result = JSON.parse(
      await handleListTransactions(repo, { offset: -5, limit: 1 }),
    )
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("txn-newest-small") // default sort: newest first
  })
})

// ── handleListTransactions: format ──────────────────────────────

describe("handleListTransactions format", () => {
  const accounts = [makeAccount({ id: "acc-1", name: "Checking" })]
  const categories = [makeCategory({ id: "cat-1", name: "Groceries" })]

  it("defaults to the verbose, name-resolved shape (back-compat)", async () => {
    const repo = createMockRepo({
      accounts,
      categories,
      transactions: [
        makeTxn({ id: "t1", accountId: "acc-1", categoryId: "cat-1", amount: -1250 }),
      ],
    })
    const result = JSON.parse(await handleListTransactions(repo, {}))
    expect(result[0]).toMatchObject({
      account: "Checking",
      category: "Groceries",
      amount: "-$12.50",
      amountCents: -1250,
    })
    expect(result[0]).not.toHaveProperty("accountId")
  })

  it("`format: \"compact\"` returns the lean shape with raw ids and signed cents", async () => {
    const repo = createMockRepo({
      accounts,
      categories,
      transactions: [
        makeTxn({
          id: "t1",
          datetime: "2026-02-03T10:00:00.000Z",
          accountId: "acc-1",
          categoryId: "cat-1",
          amount: -1250,
          merchant: "Costco",
          note: "raw desc",
          transferPairId: "",
        }),
      ],
    })
    const result = JSON.parse(await handleListTransactions(repo, { format: "compact" }))
    expect(result[0]).toEqual({
      id: "t1",
      date: "2026-02-03",
      amountCents: -1250,
      type: "expense",
      accountId: "acc-1",
      categoryId: "cat-1",
      merchant: "Costco",
      note: "raw desc",
      transferPairId: "",
    })
    expect(result[0]).not.toHaveProperty("account")
    expect(result[0]).not.toHaveProperty("amount")
  })
})

// ── handleSearchTransactions ────────────────────────────────────

describe("handleSearchTransactions", () => {
  const accounts = [
    makeAccount({ id: "acc-1", name: "Chase Checking" }),
    makeAccount({ id: "acc-2", name: "Amex Gold" }),
  ]
  const categories = [
    makeCategory({ id: "cat-1", name: "Groceries" }),
    makeCategory({ id: "cat-2", name: "Dining Out" }),
  ]

  function buildRepo() {
    return createMockRepo({
      accounts,
      categories,
      transactions: [
        makeTxn({ id: "t-wf", merchant: "Whole Foods", categoryId: "cat-1", accountId: "acc-1", amount: -8500, datetime: "2026-01-05T00:00:00.000Z" }),
        makeTxn({ id: "t-nobu", merchant: "Nobu", note: "RESTAURANT", categoryId: "cat-2", accountId: "acc-2", amount: -22000, datetime: "2026-01-10T00:00:00.000Z" }),
        makeTxn({ id: "t-apple", merchant: "Apple", note: "APL*ITUNES", categoryId: "cat-2", accountId: "acc-1", amount: -999, datetime: "2026-01-20T00:00:00.000Z" }),
        makeTxn({ id: "t-pay", merchant: "Employer", type: "income", categoryId: "cat-1", accountId: "acc-1", amount: 500000, datetime: "2026-01-31T00:00:00.000Z" }),
      ],
    })
  }

  it("returns compact rows", async () => {
    const result = JSON.parse(await handleSearchTransactions(buildRepo(), { query: "nobu" }))
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      id: "t-nobu",
      date: "2026-01-10",
      amountCents: -22000,
      type: "expense",
      accountId: "acc-2",
      categoryId: "cat-2",
      merchant: "Nobu",
      note: "RESTAURANT",
      transferPairId: "",
    })
  })

  it("matches across merchant, note, category name, account name, and money", async () => {
    const ids = async (query: string) =>
      JSON.parse(await handleSearchTransactions(buildRepo(), { query }))
        .map((r: { id: string }) => r.id)
        .sort()
    expect(await ids("itunes")).toEqual(["t-apple"]) // note
    expect(await ids("dining")).toEqual(["t-apple", "t-nobu"]) // category name
    expect(await ids("amex")).toEqual(["t-nobu"]) // account name
    expect(await ids("220")).toEqual(["t-nobu"]) // money fragment
  })

  it("combines a query with structured filters", async () => {
    const result = JSON.parse(
      await handleSearchTransactions(buildRepo(), { query: "dining", accountId: "acc-1" }),
    )
    expect(result.map((r: { id: string }) => r.id)).toEqual(["t-apple"])
  })

  it("filters by type without a query", async () => {
    const result = JSON.parse(await handleSearchTransactions(buildRepo(), { type: "income" }))
    expect(result.map((r: { id: string }) => r.id)).toEqual(["t-pay"])
  })

  it("filters by signed amount range", async () => {
    // Outflows of $90 or more (<= -9000 cents).
    const result = JSON.parse(
      await handleSearchTransactions(buildRepo(), { maxAmountCents: -9000 }),
    )
    expect(result.map((r: { id: string }) => r.id).sort()).toEqual(["t-nobu"])
  })

  it("filters by date range", async () => {
    const result = JSON.parse(
      await handleSearchTransactions(buildRepo(), { startDate: "2026-01-15", endDate: "2026-01-25" }),
    )
    expect(result.map((r: { id: string }) => r.id)).toEqual(["t-apple"])
  })

  it("sorts and limits", async () => {
    const result = JSON.parse(
      await handleSearchTransactions(buildRepo(), { sort: "oldest", limit: 2 }),
    )
    expect(result.map((r: { id: string }) => r.id)).toEqual(["t-wf", "t-nobu"])
  })

  it("with no query and no filters returns everything (newest first)", async () => {
    const result = JSON.parse(await handleSearchTransactions(buildRepo(), {}))
    expect(result.map((r: { id: string }) => r.id)).toEqual([
      "t-pay",
      "t-apple",
      "t-nobu",
      "t-wf",
    ])
  })

  it("returns an empty array when nothing matches", async () => {
    const result = JSON.parse(
      await handleSearchTransactions(buildRepo(), { query: "zzz-nope" }),
    )
    expect(result).toEqual([])
  })
})
