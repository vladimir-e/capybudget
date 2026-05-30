import { describe, it, expect, vi } from "vitest"
import type { Account, BudgetMeta, Category, Transaction } from "@capybudget/core"
import type { BudgetRepository } from "@capybudget/persistence"
import {
  handleCreateTransaction,
  handleUpdateTransaction,
  handleDeleteTransactions,
  handleCreateAccount,
  handleUpdateAccount,
  handleDeleteAccount,
  handleArchiveAccount,
  handleUnarchiveAccount,
  handleSetNetWorthExclusions,
  handleSetBudgetBasis,
  handleCreateCategory,
  handleUpdateCategory,
  handleDeleteCategory,
  handleArchiveCategory,
  handleUnarchiveCategory,
  handleSetCategoryBudget,
  handleAssignCategories,
  handleBulkUpdateTransactions,
} from "./mutation"

// ── Test data factories ─────────────────────────────────────────

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: "acc-1",
    name: "Checking",
    type: "checking",
    archived: false,
    excludeFromNetWorth: false,
    sortOrder: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }
}

function makeCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: "cat-1",
    name: "Groceries",
    group: "Daily Living",
    archived: false,
    sortOrder: 1,
    assigned: null,
    ...overrides,
  }
}

function makeTxn(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "txn-1",
    datetime: "2026-01-15T12:00:00.000",
    type: "expense",
    amount: -5000,
    categoryId: "cat-1",
    accountId: "acc-1",
    transferPairId: "",
    merchant: "Whole Foods",
    note: "",
    createdAt: "2026-01-15T00:00:00.000Z",
    ...overrides,
  }
}

function makeMeta(overrides: Partial<BudgetMeta> = {}): BudgetMeta {
  return {
    schemaVersion: 3,
    name: "Test Budget",
    currency: "USD",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastModified: "2026-01-01T00:00:00.000Z",
    basis: "trailing3",
    ...overrides,
  }
}

function createMockRepo(data: {
  accounts?: Account[]
  categories?: Category[]
  transactions?: Transaction[]
  meta?: BudgetMeta
}): BudgetRepository {
  return {
    getAccounts: vi.fn().mockResolvedValue(data.accounts ?? []),
    getCategories: vi.fn().mockResolvedValue(data.categories ?? []),
    getTransactions: vi.fn().mockResolvedValue(data.transactions ?? []),
    getBudgetMeta: vi.fn().mockResolvedValue(data.meta ?? makeMeta()),
    saveAccounts: vi.fn().mockResolvedValue(undefined),
    saveCategories: vi.fn().mockResolvedValue(undefined),
    saveTransactions: vi.fn().mockResolvedValue(undefined),
    saveBudgetMeta: vi.fn().mockResolvedValue(undefined),
  }
}

// ── Transactions ────────────────────────────────────────────────

describe("handleCreateTransaction", () => {
  it("creates an expense transaction", async () => {
    const repo = createMockRepo({})
    const result = JSON.parse(
      await handleCreateTransaction(repo, {
        type: "expense",
        amount: 2500,
        accountId: "acc-1",
        categoryId: "cat-1",
        date: "2026-03-14",
        merchant: "Coffee Shop",
        note: "morning latte",
      }),
    )

    expect(result.success).toBe(true)
    expect(result.created).toHaveLength(1)
    expect(result.created[0].type).toBe("expense")
    expect(result.created[0].amount).toBe("-$25.00")
    expect(repo.saveTransactions).toHaveBeenCalledOnce()
  })

  it("creates a transfer with two legs", async () => {
    const repo = createMockRepo({})
    const result = JSON.parse(
      await handleCreateTransaction(repo, {
        type: "transfer",
        amount: 10000,
        accountId: "acc-1",
        toAccountId: "acc-2",
        date: "2026-03-14",
      }),
    )

    expect(result.success).toBe(true)
    expect(result.created).toHaveLength(2)
    expect(result.created[0].amount).toBe("-$100.00")
    expect(result.created[1].amount).toBe("$100.00")
  })

  it("creates income with positive amount", async () => {
    const repo = createMockRepo({})
    const result = JSON.parse(
      await handleCreateTransaction(repo, {
        type: "income",
        amount: 500000,
        accountId: "acc-1",
        categoryId: "cat-income",
        date: "2026-03-01",
        merchant: "Employer",
      }),
    )

    expect(result.created[0].amount).toBe("$5,000.00")
  })
})

describe("handleUpdateTransaction", () => {
  it("updates transaction fields", async () => {
    const repo = createMockRepo({
      transactions: [makeTxn({ id: "txn-1", amount: -5000, merchant: "Old" })],
    })
    const result = JSON.parse(
      await handleUpdateTransaction(repo, {
        id: "txn-1",
        merchant: "New Merchant",
        amount: 7500,
      }),
    )

    expect(result.success).toBe(true)
    const saved = (repo.saveTransactions as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(saved[0].merchant).toBe("New Merchant")
    expect(saved[0].amount).toBe(-7500)
  })

  it("returns error for missing transaction", async () => {
    const repo = createMockRepo({})
    const result = JSON.parse(
      await handleUpdateTransaction(repo, { id: "nonexistent" }),
    )
    expect(result.error).toMatch(/not found/)
  })
})

describe("handleDeleteTransactions", () => {
  it("deletes transactions by IDs", async () => {
    const repo = createMockRepo({
      transactions: [
        makeTxn({ id: "txn-1" }),
        makeTxn({ id: "txn-2" }),
        makeTxn({ id: "txn-3" }),
      ],
    })
    const result = JSON.parse(
      await handleDeleteTransactions(repo, { ids: ["txn-1", "txn-3"] }),
    )

    expect(result.success).toBe(true)
    const saved = (repo.saveTransactions as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(saved).toHaveLength(1)
    expect(saved[0].id).toBe("txn-2")
  })

  it("deletes transfer pairs automatically", async () => {
    const repo = createMockRepo({
      transactions: [
        makeTxn({ id: "txn-from", type: "transfer", transferPairId: "txn-to", amount: -10000 }),
        makeTxn({ id: "txn-to", type: "transfer", transferPairId: "txn-from", amount: 10000 }),
        makeTxn({ id: "txn-other" }),
      ],
    })
    const result = JSON.parse(
      await handleDeleteTransactions(repo, { ids: ["txn-from"] }),
    )

    expect(result.success).toBe(true)
    const saved = (repo.saveTransactions as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(saved).toHaveLength(1)
    expect(saved[0].id).toBe("txn-other")
  })
})

// ── Accounts ────────────────────────────────────────────────────

describe("handleCreateAccount", () => {
  it("creates an account", async () => {
    const repo = createMockRepo({})
    const result = JSON.parse(
      await handleCreateAccount(repo, {
        name: "Savings",
        type: "savings",
      }),
    )

    expect(result.success).toBe(true)
    expect(result.account.name).toBe("Savings")
    expect(result.account.type).toBe("savings")
    expect(repo.saveAccounts).toHaveBeenCalledOnce()
  })

  it("creates opening balance transaction when provided", async () => {
    const repo = createMockRepo({})
    await handleCreateAccount(repo, {
      name: "Checking",
      type: "checking",
      openingBalance: 50000,
    })

    expect(repo.saveAccounts).toHaveBeenCalledOnce()
    expect(repo.saveTransactions).toHaveBeenCalledOnce()
  })

  it("skips opening balance when zero", async () => {
    const repo = createMockRepo({})
    await handleCreateAccount(repo, {
      name: "Checking",
      type: "checking",
      openingBalance: 0,
    })

    expect(repo.saveTransactions).not.toHaveBeenCalled()
  })
})

describe("handleUpdateAccount", () => {
  it("updates account name", async () => {
    const repo = createMockRepo({
      accounts: [makeAccount({ id: "acc-1", name: "Old" })],
    })
    const result = JSON.parse(
      await handleUpdateAccount(repo, { id: "acc-1", name: "New Name" }),
    )

    expect(result.success).toBe(true)
    const saved = (repo.saveAccounts as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(saved[0].name).toBe("New Name")
  })
})

describe("handleDeleteAccount", () => {
  it("deletes account with no transactions", async () => {
    const repo = createMockRepo({
      accounts: [makeAccount({ id: "acc-1" })],
    })
    const result = JSON.parse(
      await handleDeleteAccount(repo, { id: "acc-1" }),
    )
    expect(result.success).toBe(true)
  })

  it("throws when account has transactions", async () => {
    const repo = createMockRepo({
      accounts: [makeAccount({ id: "acc-1" })],
      transactions: [makeTxn({ accountId: "acc-1" })],
    })

    await expect(
      handleDeleteAccount(repo, { id: "acc-1" }),
    ).rejects.toThrow(/Cannot delete/)
  })
})

describe("handleArchiveAccount", () => {
  it("archives account with zero balance", async () => {
    const repo = createMockRepo({
      accounts: [makeAccount({ id: "acc-1" })],
      transactions: [],
    })
    const result = JSON.parse(
      await handleArchiveAccount(repo, { id: "acc-1" }),
    )
    expect(result.success).toBe(true)
  })

  it("throws when balance is non-zero", async () => {
    const repo = createMockRepo({
      accounts: [makeAccount({ id: "acc-1" })],
      transactions: [makeTxn({ accountId: "acc-1", amount: 5000 })],
    })

    await expect(
      handleArchiveAccount(repo, { id: "acc-1" }),
    ).rejects.toThrow(/non-zero/)
  })
})

// ── Categories ──────────────────────────────────────────────────

describe("handleCreateCategory", () => {
  it("creates a category", async () => {
    const repo = createMockRepo({})
    const result = JSON.parse(
      await handleCreateCategory(repo, {
        name: "Coffee",
        group: "Daily Living",
      }),
    )

    expect(result.success).toBe(true)
    expect(result.category.name).toBe("Coffee")
    expect(result.category.group).toBe("Daily Living")
    expect(repo.saveCategories).toHaveBeenCalledOnce()
  })
})

describe("handleUpdateCategory", () => {
  it("updates category name and group", async () => {
    const repo = createMockRepo({
      categories: [makeCategory({ id: "cat-1", name: "Old", group: "Personal" })],
    })
    const result = JSON.parse(
      await handleUpdateCategory(repo, {
        id: "cat-1",
        name: "Dining Out",
        group: "Daily Living",
      }),
    )

    expect(result.success).toBe(true)
    const saved = (repo.saveCategories as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(saved[0].name).toBe("Dining Out")
    expect(saved[0].group).toBe("Daily Living")
  })
})

describe("handleDeleteCategory", () => {
  it("deletes category and clears transaction refs", async () => {
    const repo = createMockRepo({
      categories: [makeCategory({ id: "cat-1" })],
      transactions: [
        makeTxn({ id: "txn-1", categoryId: "cat-1" }),
        makeTxn({ id: "txn-2", categoryId: "cat-other" }),
      ],
    })
    const result = JSON.parse(
      await handleDeleteCategory(repo, { id: "cat-1" }),
    )

    expect(result.success).toBe(true)
    const savedCats = (repo.saveCategories as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(savedCats).toHaveLength(0)
    const savedTxns = (repo.saveTransactions as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(savedTxns[0].categoryId).toBe("")
    expect(savedTxns[1].categoryId).toBe("cat-other")
  })
})

describe("handleArchiveCategory", () => {
  it("archives a category", async () => {
    const repo = createMockRepo({
      categories: [makeCategory({ id: "cat-1", archived: false })],
    })
    const result = JSON.parse(
      await handleArchiveCategory(repo, { id: "cat-1" }),
    )

    expect(result.success).toBe(true)
    const saved = (repo.saveCategories as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(saved[0].archived).toBe(true)
  })
})

// ── Bulk ────────────────────────────────────────────────────────

describe("handleAssignCategories", () => {
  it("assigns category to multiple transactions", async () => {
    const repo = createMockRepo({
      transactions: [
        makeTxn({ id: "txn-1", categoryId: "" }),
        makeTxn({ id: "txn-2", categoryId: "" }),
        makeTxn({ id: "txn-3", categoryId: "cat-other" }),
      ],
    })
    const result = JSON.parse(
      await handleAssignCategories(repo, {
        transactionIds: ["txn-1", "txn-2"],
        categoryId: "cat-1",
      }),
    )

    expect(result.success).toBe(true)
    const saved = (repo.saveTransactions as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(saved[0].categoryId).toBe("cat-1")
    expect(saved[1].categoryId).toBe("cat-1")
    expect(saved[2].categoryId).toBe("cat-other")
  })

  it("skips transfer transactions", async () => {
    const repo = createMockRepo({
      transactions: [
        makeTxn({ id: "txn-1", type: "transfer", categoryId: "" }),
        makeTxn({ id: "txn-2", categoryId: "" }),
      ],
    })

    await handleAssignCategories(repo, {
      transactionIds: ["txn-1", "txn-2"],
      categoryId: "cat-1",
    })

    const saved = (repo.saveTransactions as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(saved[0].categoryId).toBe("") // transfer untouched
    expect(saved[1].categoryId).toBe("cat-1")
  })
})

// ── Unarchive ───────────────────────────────────────────────────

describe("handleUnarchiveAccount", () => {
  it("flips archived false", async () => {
    const repo = createMockRepo({
      accounts: [makeAccount({ id: "acc-1", archived: true })],
    })
    const result = JSON.parse(
      await handleUnarchiveAccount(repo, { id: "acc-1" }),
    )
    expect(result.success).toBe(true)
    const saved = (repo.saveAccounts as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(saved[0].archived).toBe(false)
  })

  it("no-ops when already unarchived (still succeeds)", async () => {
    const repo = createMockRepo({
      accounts: [makeAccount({ id: "acc-1", archived: false })],
    })
    const result = JSON.parse(
      await handleUnarchiveAccount(repo, { id: "acc-1" }),
    )
    expect(result.success).toBe(true)
  })

  it("returns error for unknown account", async () => {
    const repo = createMockRepo({ accounts: [makeAccount({ id: "acc-1" })] })
    const result = JSON.parse(
      await handleUnarchiveAccount(repo, { id: "nope" }),
    )
    expect(result.error).toMatch(/Invalid accountId/)
    expect(repo.saveAccounts).not.toHaveBeenCalled()
  })
})

describe("handleUnarchiveCategory", () => {
  it("flips archived false", async () => {
    const repo = createMockRepo({
      categories: [makeCategory({ id: "cat-1", archived: true })],
    })
    const result = JSON.parse(
      await handleUnarchiveCategory(repo, { id: "cat-1" }),
    )
    expect(result.success).toBe(true)
    const saved = (repo.saveCategories as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(saved[0].archived).toBe(false)
  })

  it("returns error for unknown category", async () => {
    const repo = createMockRepo({ categories: [makeCategory({ id: "cat-1" })] })
    const result = JSON.parse(
      await handleUnarchiveCategory(repo, { id: "nope" }),
    )
    expect(result.error).toMatch(/Invalid categoryId/)
  })
})

// ── set_net_worth_exclusions ────────────────────────────────────

describe("handleSetNetWorthExclusions", () => {
  it("excludes specified accounts", async () => {
    const repo = createMockRepo({
      accounts: [
        makeAccount({ id: "acc-1", excludeFromNetWorth: false }),
        makeAccount({ id: "acc-2", excludeFromNetWorth: false }),
        makeAccount({ id: "acc-3", excludeFromNetWorth: false }),
      ],
    })
    const result = JSON.parse(
      await handleSetNetWorthExclusions(repo, {
        accountIds: ["acc-1", "acc-2"],
        exclude: true,
      }),
    )
    expect(result.success).toBe(true)
    const saved = (repo.saveAccounts as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(saved.find((a: Account) => a.id === "acc-1").excludeFromNetWorth).toBe(true)
    expect(saved.find((a: Account) => a.id === "acc-2").excludeFromNetWorth).toBe(true)
    expect(saved.find((a: Account) => a.id === "acc-3").excludeFromNetWorth).toBe(false)
  })

  it("re-includes previously excluded accounts without touching others", async () => {
    const repo = createMockRepo({
      accounts: [
        makeAccount({ id: "acc-1", excludeFromNetWorth: true }),
        makeAccount({ id: "acc-2", excludeFromNetWorth: true }),
        makeAccount({ id: "acc-3", excludeFromNetWorth: false }),
      ],
    })
    await handleSetNetWorthExclusions(repo, {
      accountIds: ["acc-1"],
      exclude: false,
    })
    const saved = (repo.saveAccounts as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(saved.find((a: Account) => a.id === "acc-1").excludeFromNetWorth).toBe(false)
    // acc-2 stays excluded — not in the input list, prior state preserved
    expect(saved.find((a: Account) => a.id === "acc-2").excludeFromNetWorth).toBe(true)
    expect(saved.find((a: Account) => a.id === "acc-3").excludeFromNetWorth).toBe(false)
  })

  it("rejects invalid accountIds", async () => {
    const repo = createMockRepo({ accounts: [makeAccount({ id: "acc-1" })] })
    const result = JSON.parse(
      await handleSetNetWorthExclusions(repo, {
        accountIds: ["acc-1", "ghost"],
        exclude: true,
      }),
    )
    expect(result.error).toMatch(/Invalid accountId/)
    expect(repo.saveAccounts).not.toHaveBeenCalled()
  })

  it("rejects empty accountIds", async () => {
    const repo = createMockRepo({ accounts: [makeAccount({ id: "acc-1" })] })
    const result = JSON.parse(
      await handleSetNetWorthExclusions(repo, {
        accountIds: [],
        exclude: true,
      }),
    )
    expect(result.error).toMatch(/non-empty array/)
  })
})

// ── set_budget_basis ────────────────────────────────────────────

describe("handleSetBudgetBasis", () => {
  it("persists a valid basis, preserving other meta fields", async () => {
    const repo = createMockRepo({
      meta: makeMeta({ name: "My Budget", basis: "trailing3" }),
    })
    const result = JSON.parse(
      await handleSetBudgetBasis(repo, { basis: "sameMonthLastYear" }),
    )
    expect(result.success).toBe(true)
    expect(result.basis).toBe("sameMonthLastYear")
    const saved = (repo.saveBudgetMeta as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(saved.basis).toBe("sameMonthLastYear")
    // Other fields survive the round-trip.
    expect(saved.name).toBe("My Budget")
    expect(saved.schemaVersion).toBe(3)
    expect(saved.currency).toBe("USD")
  })

  it("rejects an unknown basis without saving", async () => {
    const repo = createMockRepo({})
    const result = JSON.parse(
      await handleSetBudgetBasis(repo, { basis: "trailing9" }),
    )
    expect(result.error).toMatch(/basis must be one of/)
    expect(repo.saveBudgetMeta).not.toHaveBeenCalled()
  })

  it("rejects a missing basis", async () => {
    const repo = createMockRepo({})
    const result = JSON.parse(await handleSetBudgetBasis(repo, {}))
    expect(result.error).toMatch(/basis must be one of/)
    expect(repo.saveBudgetMeta).not.toHaveBeenCalled()
  })
})

// ── set_category_budget ─────────────────────────────────────────

describe("handleSetCategoryBudget", () => {
  it("sets a numeric monthly target", async () => {
    const repo = createMockRepo({
      categories: [makeCategory({ id: "cat-1", assigned: null })],
    })
    const result = JSON.parse(
      await handleSetCategoryBudget(repo, {
        categoryId: "cat-1",
        assigned: 12500,
      }),
    )
    expect(result.success).toBe(true)
    const saved = (repo.saveCategories as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(saved[0].assigned).toBe(12500)
  })

  it("accepts assigned=0 as tracked at zero", async () => {
    const repo = createMockRepo({
      categories: [makeCategory({ id: "cat-1", assigned: 20000 })],
    })
    await handleSetCategoryBudget(repo, { categoryId: "cat-1", assigned: 0 })
    const saved = (repo.saveCategories as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(saved[0].assigned).toBe(0)
  })

  it("accepts assigned=null as untracked", async () => {
    const repo = createMockRepo({
      categories: [makeCategory({ id: "cat-1", assigned: 20000 })],
    })
    await handleSetCategoryBudget(repo, { categoryId: "cat-1", assigned: null })
    const saved = (repo.saveCategories as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(saved[0].assigned).toBeNull()
  })

  it("rejects missing assigned field (distinct from null)", async () => {
    const repo = createMockRepo({
      categories: [makeCategory({ id: "cat-1" })],
    })
    const result = JSON.parse(
      await handleSetCategoryBudget(repo, { categoryId: "cat-1" }),
    )
    expect(result.error).toMatch(/assigned is required/)
  })

  it("rejects negative assigned", async () => {
    const repo = createMockRepo({
      categories: [makeCategory({ id: "cat-1" })],
    })
    const result = JSON.parse(
      await handleSetCategoryBudget(repo, {
        categoryId: "cat-1",
        assigned: -100,
      }),
    )
    expect(result.error).toMatch(/non-negative/)
  })

  it("rejects unknown categoryId", async () => {
    const repo = createMockRepo({
      categories: [makeCategory({ id: "cat-1" })],
    })
    const result = JSON.parse(
      await handleSetCategoryBudget(repo, {
        categoryId: "ghost",
        assigned: 1000,
      }),
    )
    expect(result.error).toMatch(/Invalid categoryId/)
  })
})

// ── bulk_update_transactions ────────────────────────────────────

describe("handleBulkUpdateTransactions", () => {
  it("changes account on selected transactions, skips transfers", async () => {
    const repo = createMockRepo({
      accounts: [makeAccount({ id: "acc-1" }), makeAccount({ id: "acc-2" })],
      transactions: [
        makeTxn({ id: "t1", accountId: "acc-1" }),
        makeTxn({ id: "t2", accountId: "acc-1" }),
        // Transfer pair — t3 should be skipped on account move
        makeTxn({ id: "t3", type: "transfer", accountId: "acc-1", transferPairId: "t4" }),
        makeTxn({ id: "t4", type: "transfer", accountId: "acc-2", transferPairId: "t3" }),
      ],
    })
    const result = JSON.parse(
      await handleBulkUpdateTransactions(repo, {
        transactionIds: ["t1", "t2", "t3"],
        set: { accountId: "acc-2" },
      }),
    )
    expect(result.success).toBe(true)
    expect(result.counts.accountId).toBe(2)
    const saved = (repo.saveTransactions as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(saved.find((t: Transaction) => t.id === "t1").accountId).toBe("acc-2")
    expect(saved.find((t: Transaction) => t.id === "t2").accountId).toBe("acc-2")
    expect(saved.find((t: Transaction) => t.id === "t3").accountId).toBe("acc-1") // transfer untouched
  })

  it("changes date and preserves time-of-day", async () => {
    const repo = createMockRepo({
      transactions: [
        makeTxn({ id: "t1", datetime: "2025-01-15T09:30:00" }),
        makeTxn({ id: "t2", datetime: "2025-01-15T14:45:00" }),
      ],
    })
    const result = JSON.parse(
      await handleBulkUpdateTransactions(repo, {
        transactionIds: ["t1", "t2"],
        set: { date: "2025-06-01" },
      }),
    )
    expect(result.success).toBe(true)
    const saved = (repo.saveTransactions as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(saved.find((t: Transaction) => t.id === "t1").datetime).toBe("2025-06-01T09:30:00")
    expect(saved.find((t: Transaction) => t.id === "t2").datetime).toBe("2025-06-01T14:45:00")
  })

  it("changes date on a single transfer leg when only that leg is selected (matches UI)", async () => {
    const repo = createMockRepo({
      transactions: [
        makeTxn({
          id: "t1",
          type: "transfer",
          datetime: "2025-01-15T10:00:00",
          transferPairId: "t2",
        }),
        makeTxn({
          id: "t2",
          type: "transfer",
          datetime: "2025-01-15T10:00:00",
          transferPairId: "t1",
        }),
      ],
    })
    await handleBulkUpdateTransactions(repo, {
      transactionIds: ["t1"],
      set: { date: "2025-06-01" },
    })
    const saved = (repo.saveTransactions as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(saved.find((t: Transaction) => t.id === "t1").datetime).toBe("2025-06-01T10:00:00")
    // Matches useBulkChangeDate: only the selected leg moves
    expect(saved.find((t: Transaction) => t.id === "t2").datetime).toBe("2025-01-15T10:00:00")
  })

  it("changes merchant on non-transfers", async () => {
    const repo = createMockRepo({
      transactions: [
        makeTxn({ id: "t1", merchant: "Old" }),
        makeTxn({
          id: "t2",
          type: "transfer",
          merchant: "",
          transferPairId: "t3",
        }),
      ],
    })
    const result = JSON.parse(
      await handleBulkUpdateTransactions(repo, {
        transactionIds: ["t1", "t2"],
        set: { merchant: "Costco" },
      }),
    )
    expect(result.counts.merchant).toBe(1)
    const saved = (repo.saveTransactions as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(saved.find((t: Transaction) => t.id === "t1").merchant).toBe("Costco")
    expect(saved.find((t: Transaction) => t.id === "t2").merchant).toBe("") // transfer untouched
  })

  it("applies multiple fields in one call", async () => {
    const repo = createMockRepo({
      accounts: [makeAccount({ id: "acc-2" }), makeAccount({ id: "acc-1" })],
      transactions: [makeTxn({ id: "t1", merchant: "Old", accountId: "acc-1" })],
    })
    const result = JSON.parse(
      await handleBulkUpdateTransactions(repo, {
        transactionIds: ["t1"],
        set: { accountId: "acc-2", merchant: "Costco", date: "2026-04-01" },
      }),
    )
    expect(result.success).toBe(true)
    expect(result.counts.accountId).toBe(1)
    expect(result.counts.merchant).toBe(1)
    expect(result.counts.date).toBe(1)
    const saved = (repo.saveTransactions as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(saved[0].accountId).toBe("acc-2")
    expect(saved[0].merchant).toBe("Costco")
    expect(saved[0].datetime.startsWith("2026-04-01")).toBe(true)
  })

  it("rejects when set is empty", async () => {
    const repo = createMockRepo({
      transactions: [makeTxn({ id: "t1" })],
    })
    const result = JSON.parse(
      await handleBulkUpdateTransactions(repo, {
        transactionIds: ["t1"],
        set: {},
      }),
    )
    expect(result.error).toMatch(/at least one/)
    expect(repo.saveTransactions).not.toHaveBeenCalled()
  })

  it("rejects empty transactionIds", async () => {
    const repo = createMockRepo({})
    const result = JSON.parse(
      await handleBulkUpdateTransactions(repo, {
        transactionIds: [],
        set: { merchant: "X" },
      }),
    )
    expect(result.error).toMatch(/non-empty array/)
  })

  it("rejects unknown accountId", async () => {
    const repo = createMockRepo({
      accounts: [makeAccount({ id: "acc-1" })],
      transactions: [makeTxn({ id: "t1", accountId: "acc-1" })],
    })
    const result = JSON.parse(
      await handleBulkUpdateTransactions(repo, {
        transactionIds: ["t1"],
        set: { accountId: "ghost" },
      }),
    )
    expect(result.error).toMatch(/Invalid accountId/)
    expect(repo.saveTransactions).not.toHaveBeenCalled()
  })

  it("rejects malformed date", async () => {
    const repo = createMockRepo({
      transactions: [makeTxn({ id: "t1" })],
    })
    const result = JSON.parse(
      await handleBulkUpdateTransactions(repo, {
        transactionIds: ["t1"],
        set: { date: "06/01/2025" },
      }),
    )
    expect(result.error).toMatch(/YYYY-MM-DD/)
    expect(repo.saveTransactions).not.toHaveBeenCalled()
  })

  it("returns error when no IDs match", async () => {
    const repo = createMockRepo({
      transactions: [makeTxn({ id: "t1" })],
    })
    const result = JSON.parse(
      await handleBulkUpdateTransactions(repo, {
        transactionIds: ["ghost"],
        set: { merchant: "X" },
      }),
    )
    expect(result.error).toMatch(/None of the provided/)
  })
})
