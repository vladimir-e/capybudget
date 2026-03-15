import { describe, it, expect, vi } from "vitest"
import type { Account, Category, Transaction } from "@capybudget/core"
import type { BudgetRepository } from "@capybudget/persistence"
import {
  handleCreateTransaction,
  handleUpdateTransaction,
  handleDeleteTransactions,
  handleCreateAccount,
  handleUpdateAccount,
  handleDeleteAccount,
  handleArchiveAccount,
  handleCreateCategory,
  handleUpdateCategory,
  handleDeleteCategory,
  handleArchiveCategory,
  handleAssignCategories,
} from "./mutation-tools"

// ── Test data factories ─────────────────────────────────────────

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: "acc-1",
    name: "Checking",
    type: "checking",
    archived: false,
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
