import { describe, it, expect, vi } from "vitest"
import type { Account, Category, Transaction } from "@capybudget/core"
import {
  makeAccount,
  makeCategory,
  makeTransaction as makeTxn,
} from "@capybudget/core/test-factories"
import type { BudgetRepository } from "@capybudget/persistence"
import {
  handleCreateTransaction,
  handleUpdateTransaction,
  handleDeleteTransactions,
  handleCreateAccount,
  handleUpdateAccount,
  handleDeleteAccount,
  handleCreateCategory,
  handleUpdateCategory,
  handleDeleteCategory,
  handleBulkUpdateTransactions,
} from "./mutation"

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
      await handleCreateTransaction(repo, "USD", undefined, {
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
      await handleCreateTransaction(repo, "USD", undefined, {
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

  it("creates a cross-currency transfer with independent legs and per-leg rates", async () => {
    const repo = createMockRepo({
      accounts: [
        makeAccount({ id: "acc-usd", currency: "USD" }),
        makeAccount({ id: "acc-eur", currency: "EUR" }),
      ],
    })
    await handleCreateTransaction(
      repo,
      "USD",
      { USD: { decimals: 2, symbolPosition: "before" }, EUR: { decimals: 2, symbolPosition: "before" } },
      {
        type: "transfer",
        amount: 10000,
        accountId: "acc-usd",
        toAccountId: "acc-eur",
        toAmount: 9200,
        date: "2026-03-14",
      },
    )
    const saved = (repo.saveTransactions as ReturnType<typeof vi.fn>).mock.calls[0][0] as Transaction[]
    const from = saved.find((t) => t.accountId === "acc-usd")!
    const to = saved.find((t) => t.accountId === "acc-eur")!
    expect(from.amount).toBe(-10000)
    expect(from.fxRate).toBeUndefined() // default leg
    expect(to.amount).toBe(9200)
    expect(to.fxRate).toBeCloseTo(10000 / 9200, 12) // derived bank rate
  })

  it("infers the received amount from today's rate when toAmount is omitted", async () => {
    const repo = createMockRepo({
      accounts: [
        makeAccount({ id: "acc-usd", currency: "USD" }),
        makeAccount({ id: "acc-eur", currency: "EUR" }),
      ],
    })
    await handleCreateTransaction(
      repo,
      "USD",
      { USD: { decimals: 2, symbolPosition: "before" }, EUR: { decimals: 2, symbolPosition: "before" } },
      { type: "transfer", amount: 10000, accountId: "acc-usd", toAccountId: "acc-eur", date: "2026-03-14" },
    )
    const saved = (repo.saveTransactions as ReturnType<typeof vi.fn>).mock.calls[0][0] as Transaction[]
    const to = saved.find((t) => t.accountId === "acc-eur")!
    // rate(USD→EUR) = 1 / (1/0.92) = 0.92, so $100 → €92.
    expect(to.amount).toBe(9200)
    expect(to.fxRate).toBeCloseTo(10000 / 9200, 10)
  })

  it("creates income with positive amount", async () => {
    const repo = createMockRepo({})
    const result = JSON.parse(
      await handleCreateTransaction(repo, "USD", undefined, {
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

  it("stamps today's rate on a transaction created for a foreign account", async () => {
    const repo = createMockRepo({
      accounts: [makeAccount({ id: "acc-rub", currency: "RUB" })],
    })
    await handleCreateTransaction(
      repo,
      "USD",
      { USD: { decimals: 2, symbolPosition: "before" }, RUB: { decimals: 0, symbolPosition: "after" } },
      { type: "expense", amount: 500000, accountId: "acc-rub", categoryId: "cat-1", date: "2026-03-14" },
    )
    const saved = (repo.saveTransactions as ReturnType<typeof vi.fn>).mock.calls[0][0] as Transaction[]
    // RUB→USD via the seed table (1/91), frozen on the transaction.
    expect(saved[0].fxRate).toBeCloseTo(1 / 91, 10)
  })

  it("leaves fxRate empty for a default-currency account", async () => {
    const repo = createMockRepo({
      accounts: [makeAccount({ id: "acc-usd", currency: "USD" })],
    })
    await handleCreateTransaction(
      repo,
      "USD",
      { USD: { decimals: 2, symbolPosition: "before" } },
      { type: "expense", amount: 2500, accountId: "acc-usd", categoryId: "cat-1", date: "2026-03-14" },
    )
    const saved = (repo.saveTransactions as ReturnType<typeof vi.fn>).mock.calls[0][0] as Transaction[]
    expect(saved[0].fxRate).toBeUndefined()
  })
})

describe("handleUpdateTransaction", () => {
  it("updates transaction fields", async () => {
    const repo = createMockRepo({
      transactions: [makeTxn({ id: "txn-1", amount: -5000, merchant: "Old" })],
    })
    const result = JSON.parse(
      await handleUpdateTransaction(repo, "USD", undefined, {
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
      await handleUpdateTransaction(repo, "USD", undefined, { id: "nonexistent" }),
    )
    expect(result.error).toMatch(/not found/)
  })

  it("leaves both legs of a cross-currency transfer untouched on an unrelated edit", async () => {
    // Executed at €90-for-$100 (toFxRate 10000/9000 ≈ 1.111), worse than today's
    // seed (1/0.92 ≈ 1.087). A note-only edit must NOT re-rate to today's rate —
    // the received amount and its derived rate are real history.
    const repo = createMockRepo({
      accounts: [
        makeAccount({ id: "acc-usd", currency: "USD" }),
        makeAccount({ id: "acc-eur", currency: "EUR" }),
      ],
      transactions: [
        makeTxn({ id: "xc-from", type: "transfer", amount: -10000, accountId: "acc-usd", transferPairId: "xc-to", fxRate: undefined }),
        makeTxn({ id: "xc-to", type: "transfer", amount: 9000, accountId: "acc-eur", transferPairId: "xc-from", fxRate: 10000 / 9000 }),
      ],
    })
    await handleUpdateTransaction(
      repo,
      "USD",
      { USD: { decimals: 2, symbolPosition: "before" }, EUR: { decimals: 2, symbolPosition: "before" } },
      { id: "xc-from", note: "vacation cash" },
    )
    const saved = (repo.saveTransactions as ReturnType<typeof vi.fn>).mock.calls[0][0] as Transaction[]
    const from = saved.find((t) => t.id === "xc-from")!
    const to = saved.find((t) => t.id === "xc-to")!
    expect(from.amount).toBe(-10000)
    expect(from.fxRate).toBeUndefined()
    expect(to.amount).toBe(9000) // stored received amount preserved, not re-inferred
    expect(to.fxRate).toBeCloseTo(10000 / 9000, 12) // real executed rate, not today's
    expect(to.note).toBe("vacation cash")
  })

  it("preserves a plain flow's stamp on an amount/merchant edit when the account is unchanged", async () => {
    // RUB account, stamped the day it happened at a rate deliberately off today's
    // seed (1/91). An amount + merchant edit must carry that historical stamp.
    const repo = createMockRepo({
      accounts: [makeAccount({ id: "acc-rub", currency: "RUB" })],
      transactions: [
        makeTxn({ id: "t1", amount: -100000, accountId: "acc-rub", merchant: "Old", fxRate: 1 / 80 }),
      ],
    })
    await handleUpdateTransaction(
      repo,
      "USD",
      { USD: { decimals: 2, symbolPosition: "before" }, RUB: { decimals: 0, symbolPosition: "after" } },
      { id: "t1", amount: 1500, merchant: "New" },
    )
    const saved = (repo.saveTransactions as ReturnType<typeof vi.fn>).mock.calls[0][0] as Transaction[]
    const t = saved.find((x) => x.id === "t1")!
    expect(t.merchant).toBe("New")
    expect(t.amount).toBe(-1500)
    expect(t.fxRate).toBe(1 / 80) // historical stamp, not re-rated to today's seed
  })

  it("rejects moving a plain flow to a different-currency account", async () => {
    const repo = createMockRepo({
      accounts: [
        makeAccount({ id: "acc-usd", currency: "USD" }),
        makeAccount({ id: "acc-rub", currency: "RUB" }),
      ],
      transactions: [makeTxn({ id: "t1", amount: -5000, accountId: "acc-usd", fxRate: undefined })],
    })
    const result = JSON.parse(
      await handleUpdateTransaction(
        repo,
        "USD",
        { USD: { decimals: 2, symbolPosition: "before" }, RUB: { decimals: 0, symbolPosition: "after" } },
        { id: "t1", accountId: "acc-rub" },
      ),
    )
    expect(result.error).toMatch(/same currency|transfer/i)
    expect(repo.saveTransactions).not.toHaveBeenCalled()
  })

  it("preserves a plain flow's stamp when moved between same-currency accounts", async () => {
    const repo = createMockRepo({
      accounts: [
        makeAccount({ id: "acc-usd", currency: "USD" }),
        makeAccount({ id: "acc-usd2", currency: "USD" }),
      ],
      transactions: [makeTxn({ id: "t1", amount: -5000, accountId: "acc-usd", fxRate: 1 / 91 })],
    })
    await handleUpdateTransaction(
      repo,
      "RUB",
      { RUB: { decimals: 0, symbolPosition: "after" }, USD: { decimals: 2, symbolPosition: "before" } },
      { id: "t1", accountId: "acc-usd2" },
    )
    const saved = (repo.saveTransactions as ReturnType<typeof vi.fn>).mock.calls[0][0] as Transaction[]
    const t = saved.find((x) => x.id === "t1")!
    expect(t.accountId).toBe("acc-usd2")
    expect(t.fxRate).toBe(1 / 91) // historical stamp, not re-resolved to today's
  })

  it("re-derives both legs when the from-amount of a cross-currency transfer changes", async () => {
    const repo = createMockRepo({
      accounts: [
        makeAccount({ id: "acc-usd", currency: "USD" }),
        makeAccount({ id: "acc-eur", currency: "EUR" }),
      ],
      transactions: [
        makeTxn({ id: "xc-from", type: "transfer", amount: -10000, accountId: "acc-usd", transferPairId: "xc-to", fxRate: undefined }),
        makeTxn({ id: "xc-to", type: "transfer", amount: 9000, accountId: "acc-eur", transferPairId: "xc-from", fxRate: 10000 / 9000 }),
      ],
    })
    // Change the from-amount to $200 with no explicit toAmount → infer at today's
    // rate (0.92) → €184, and re-derive the to-leg rate from the two amounts.
    await handleUpdateTransaction(
      repo,
      "USD",
      { USD: { decimals: 2, symbolPosition: "before" }, EUR: { decimals: 2, symbolPosition: "before" } },
      { id: "xc-from", type: "transfer", amount: 20000, accountId: "acc-usd", toAccountId: "acc-eur" },
    )
    const saved = (repo.saveTransactions as ReturnType<typeof vi.fn>).mock.calls[0][0] as Transaction[]
    const to = saved.find((t) => t.id === "xc-to")!
    expect(to.amount).toBe(18400) // $200 at today's 0.92
    expect(to.fxRate).toBeCloseTo(20000 / 18400, 12)
  })

  it("mirrors the amount and shares one rate across both legs of a same-currency transfer edit", async () => {
    // RUB → RUB: an amount edit re-derives the shape, but a same-currency
    // transfer takes the one resolver rate on both legs (no cross-rate from the
    // amounts) and mirrors the from-amount onto the to leg.
    const repo = createMockRepo({
      accounts: [
        makeAccount({ id: "acc-rub1", currency: "RUB" }),
        makeAccount({ id: "acc-rub2", currency: "RUB" }),
      ],
      transactions: [
        makeTxn({ id: "rr-from", type: "transfer", amount: -500000, accountId: "acc-rub1", transferPairId: "rr-to", fxRate: 1 / 80 }),
        makeTxn({ id: "rr-to", type: "transfer", amount: 500000, accountId: "acc-rub2", transferPairId: "rr-from", fxRate: 1 / 80 }),
      ],
    })
    await handleUpdateTransaction(
      repo,
      "USD",
      { USD: { decimals: 2, symbolPosition: "before" }, RUB: { decimals: 0, symbolPosition: "after" } },
      { id: "rr-from", amount: 700000 },
    )
    const saved = (repo.saveTransactions as ReturnType<typeof vi.fn>).mock.calls[0][0] as Transaction[]
    const from = saved.find((t) => t.id === "rr-from")!
    const to = saved.find((t) => t.id === "rr-to")!
    expect(from.amount).toBe(-700000)
    expect(to.amount).toBe(700000) // mirrored, not cross-rated
    // Both legs share the resolver rate (RUB→USD seed 1/91), re-derived from the
    // edit — not the old 1/80 stamp, and not a rate split from the two amounts.
    expect(from.fxRate).toBeCloseTo(1 / 91, 12)
    expect(to.fxRate).toBeCloseTo(1 / 91, 12)
    expect(to.fxRate).toBe(from.fxRate) // same-currency → both legs the same rate
  })

  it("leaves both legs untouched when a note-only edit targets the INFLOW leg of a cross-currency transfer", async () => {
    // The model can target either leg. A note-only edit on the inflow (positive)
    // leg must normalize to outflow-as-from / inflow-as-to before core sees it —
    // otherwise core writes the inflow account/magnitude onto the from leg and
    // corrupts the pair. RUB out → USD in.
    const repo = createMockRepo({
      accounts: [
        makeAccount({ id: "acc-rub", currency: "RUB" }),
        makeAccount({ id: "acc-usd", currency: "USD" }),
      ],
      transactions: [
        makeTxn({ id: "rub-from", type: "transfer", amount: -900000, accountId: "acc-rub", transferPairId: "usd-to", fxRate: 1 / 90 }),
        makeTxn({ id: "usd-to", type: "transfer", amount: 10000, accountId: "acc-usd", transferPairId: "rub-from", fxRate: undefined }),
      ],
    })
    await handleUpdateTransaction(
      repo,
      "USD",
      { USD: { decimals: 2, symbolPosition: "before" }, RUB: { decimals: 0, symbolPosition: "after" } },
      { id: "usd-to", note: "moving day" }, // targets the inflow leg
    )
    const saved = (repo.saveTransactions as ReturnType<typeof vi.fn>).mock.calls[0][0] as Transaction[]
    const from = saved.find((t) => t.id === "rub-from")!
    const to = saved.find((t) => t.id === "usd-to")!
    // Both legs' amounts, accounts, and rates are byte-identical — only the note moved.
    expect(from.amount).toBe(-900000)
    expect(from.accountId).toBe("acc-rub")
    expect(from.fxRate).toBe(1 / 90)
    expect(to.amount).toBe(10000)
    expect(to.accountId).toBe("acc-usd")
    expect(to.fxRate).toBeUndefined()
    expect(from.note).toBe("moving day")
    expect(to.note).toBe("moving day")
  })

  it("rejects converting a plain flow to a transfer", async () => {
    const repo = createMockRepo({
      transactions: [makeTxn({ id: "exp-1", type: "expense", amount: -5000, accountId: "acc-1" })],
    })
    const result = JSON.parse(
      await handleUpdateTransaction(repo, "USD", undefined, {
        id: "exp-1",
        type: "transfer",
        toAccountId: "acc-2",
      }),
    )
    expect(result.error).toMatch(/delete .* create|to or from transfer/i)
    expect(repo.saveTransactions).not.toHaveBeenCalled()
  })

  it("rejects converting a transfer to a plain flow", async () => {
    const repo = createMockRepo({
      transactions: [
        makeTxn({ id: "tf-from", type: "transfer", amount: -5000, accountId: "acc-1", transferPairId: "tf-to" }),
        makeTxn({ id: "tf-to", type: "transfer", amount: 5000, accountId: "acc-2", transferPairId: "tf-from" }),
      ],
    })
    const result = JSON.parse(
      await handleUpdateTransaction(repo, "USD", undefined, {
        id: "tf-from",
        type: "expense",
      }),
    )
    expect(result.error).toMatch(/delete .* create|to or from transfer/i)
    expect(repo.saveTransactions).not.toHaveBeenCalled()
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
  it("creates an account in the budget default currency", async () => {
    const repo = createMockRepo({})
    const result = JSON.parse(
      await handleCreateAccount(repo, "EUR", undefined, {
        name: "Savings",
        type: "savings",
      }),
    )

    expect(result.success).toBe(true)
    expect(result.account.name).toBe("Savings")
    expect(result.account.type).toBe("savings")
    expect(repo.saveAccounts).toHaveBeenCalledOnce()
    const saved = (repo.saveAccounts as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(saved[0].currency).toBe("EUR")
  })

  it("creates opening balance transaction when provided", async () => {
    const repo = createMockRepo({})
    await handleCreateAccount(repo, "USD", undefined, {
      name: "Checking",
      type: "checking",
      openingBalance: 50000,
    })

    expect(repo.saveAccounts).toHaveBeenCalledOnce()
    expect(repo.saveTransactions).toHaveBeenCalledOnce()
  })

  it("skips opening balance when zero", async () => {
    const repo = createMockRepo({})
    await handleCreateAccount(repo, "USD", undefined, {
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

  it("archives an account with zero balance", async () => {
    const repo = createMockRepo({
      accounts: [makeAccount({ id: "acc-1", archived: false })],
      transactions: [],
    })
    const result = JSON.parse(
      await handleUpdateAccount(repo, { id: "acc-1", archived: true }),
    )
    expect(result.success).toBe(true)
    const saved = (repo.saveAccounts as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(saved[0].archived).toBe(true)
  })

  it("throws when archiving an account with non-zero balance", async () => {
    const repo = createMockRepo({
      accounts: [makeAccount({ id: "acc-1" })],
      transactions: [makeTxn({ accountId: "acc-1", amount: 5000 })],
    })
    await expect(
      handleUpdateAccount(repo, { id: "acc-1", archived: true }),
    ).rejects.toThrow(/non-zero/)
  })

  it("does not persist a name change when a combined archive fails on balance", async () => {
    const repo = createMockRepo({
      accounts: [makeAccount({ id: "acc-1", name: "Old" })],
      transactions: [makeTxn({ accountId: "acc-1", amount: 5000 })],
    })
    await expect(
      handleUpdateAccount(repo, { id: "acc-1", name: "New Name", archived: true }),
    ).rejects.toThrow(/non-zero/)
    expect(repo.saveAccounts).not.toHaveBeenCalled()
  })

  it("unarchives an account", async () => {
    const repo = createMockRepo({
      accounts: [makeAccount({ id: "acc-1", archived: true })],
    })
    const result = JSON.parse(
      await handleUpdateAccount(repo, { id: "acc-1", archived: false }),
    )
    expect(result.success).toBe(true)
    const saved = (repo.saveAccounts as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(saved[0].archived).toBe(false)
  })

  it("toggles excludeFromNetWorth on the targeted account only", async () => {
    const repo = createMockRepo({
      accounts: [
        makeAccount({ id: "acc-1", excludeFromNetWorth: false }),
        makeAccount({ id: "acc-2", excludeFromNetWorth: false }),
      ],
    })
    await handleUpdateAccount(repo, { id: "acc-1", excludeFromNetWorth: true })
    const saved = (repo.saveAccounts as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(saved.find((a: Account) => a.id === "acc-1").excludeFromNetWorth).toBe(true)
    expect(saved.find((a: Account) => a.id === "acc-2").excludeFromNetWorth).toBe(false)
  })

  it("leaves an archived account's excludeFromNetWorth unchanged (mirrors core)", async () => {
    const repo = createMockRepo({
      accounts: [makeAccount({ id: "acc-1", archived: true, excludeFromNetWorth: false })],
    })
    await handleUpdateAccount(repo, { id: "acc-1", excludeFromNetWorth: true })
    const saved = (repo.saveAccounts as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(saved[0].excludeFromNetWorth).toBe(false)
  })

  it("returns error for unknown account", async () => {
    const repo = createMockRepo({ accounts: [makeAccount({ id: "acc-1" })] })
    const result = JSON.parse(
      await handleUpdateAccount(repo, { id: "ghost", name: "X" }),
    )
    expect(result.error).toMatch(/not found/)
    expect(repo.saveAccounts).not.toHaveBeenCalled()
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

  it("archives and unarchives a category", async () => {
    const repo = createMockRepo({
      categories: [makeCategory({ id: "cat-1", archived: false })],
    })
    await handleUpdateCategory(repo, { id: "cat-1", archived: true })
    expect(
      (repo.saveCategories as ReturnType<typeof vi.fn>).mock.calls[0][0][0].archived,
    ).toBe(true)

    await handleUpdateCategory(repo, { id: "cat-1", archived: false })
    expect(
      (repo.saveCategories as ReturnType<typeof vi.fn>).mock.calls[1][0][0].archived,
    ).toBe(false)
  })

  it("sets a numeric monthly budget via budgetCents", async () => {
    const repo = createMockRepo({
      categories: [makeCategory({ id: "cat-1", assigned: null })],
    })
    const result = JSON.parse(
      await handleUpdateCategory(repo, { id: "cat-1", budgetCents: 12500 }),
    )
    expect(result.success).toBe(true)
    const saved = (repo.saveCategories as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(saved[0].assigned).toBe(12500)
  })

  it("treats budgetCents=0 as tracked-at-zero", async () => {
    const repo = createMockRepo({
      categories: [makeCategory({ id: "cat-1", assigned: 20000 })],
    })
    await handleUpdateCategory(repo, { id: "cat-1", budgetCents: 0 })
    const saved = (repo.saveCategories as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(saved[0].assigned).toBe(0)
  })

  it("treats budgetCents=null as untracked", async () => {
    const repo = createMockRepo({
      categories: [makeCategory({ id: "cat-1", assigned: 20000 })],
    })
    await handleUpdateCategory(repo, { id: "cat-1", budgetCents: null })
    const saved = (repo.saveCategories as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(saved[0].assigned).toBeNull()
  })

  it("leaves the budget unchanged when budgetCents is omitted", async () => {
    const repo = createMockRepo({
      categories: [makeCategory({ id: "cat-1", assigned: 20000 })],
    })
    await handleUpdateCategory(repo, { id: "cat-1", name: "Renamed" })
    const saved = (repo.saveCategories as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(saved[0].assigned).toBe(20000)
  })

  it("rejects negative budgetCents", async () => {
    const repo = createMockRepo({
      categories: [makeCategory({ id: "cat-1" })],
    })
    const result = JSON.parse(
      await handleUpdateCategory(repo, { id: "cat-1", budgetCents: -100 }),
    )
    expect(result.error).toMatch(/non-negative/)
    expect(repo.saveCategories).not.toHaveBeenCalled()
  })

  it("returns error for unknown category", async () => {
    const repo = createMockRepo({ categories: [makeCategory({ id: "cat-1" })] })
    const result = JSON.parse(
      await handleUpdateCategory(repo, { id: "ghost", name: "X" }),
    )
    expect(result.error).toMatch(/not found/)
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

// ── bulk_update_transactions ────────────────────────────────────

describe("handleBulkUpdateTransactions", () => {
  it("assigns category to non-transfers and skips transfers", async () => {
    const repo = createMockRepo({
      categories: [makeCategory({ id: "cat-1" })],
      transactions: [
        makeTxn({ id: "txn-1", categoryId: "" }),
        makeTxn({ id: "txn-2", categoryId: "cat-other" }),
        makeTxn({ id: "txn-3", type: "transfer", categoryId: "", transferPairId: "txn-4" }),
      ],
    })
    const result = JSON.parse(
      await handleBulkUpdateTransactions(repo, {
        transactionIds: ["txn-1", "txn-2", "txn-3"],
        set: { categoryId: "cat-1" },
      }),
    )

    expect(result.success).toBe(true)
    expect(result.counts.categoryId).toBe(2) // transfer skipped
    const saved = (repo.saveTransactions as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(saved.find((t: Transaction) => t.id === "txn-1").categoryId).toBe("cat-1")
    expect(saved.find((t: Transaction) => t.id === "txn-2").categoryId).toBe("cat-1")
    expect(saved.find((t: Transaction) => t.id === "txn-3").categoryId).toBe("") // transfer untouched
  })

  it("rejects unknown categoryId", async () => {
    const repo = createMockRepo({
      categories: [makeCategory({ id: "cat-1" })],
      transactions: [makeTxn({ id: "txn-1", categoryId: "" })],
    })
    const result = JSON.parse(
      await handleBulkUpdateTransactions(repo, {
        transactionIds: ["txn-1"],
        set: { categoryId: "ghost" },
      }),
    )
    expect(result.error).toMatch(/Invalid categoryId/)
    expect(repo.saveTransactions).not.toHaveBeenCalled()
  })

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

  it("rejects a bulk move when any flow's currency differs from the target", async () => {
    const repo = createMockRepo({
      accounts: [
        makeAccount({ id: "acc-usd", currency: "USD" }),
        makeAccount({ id: "acc-rub", currency: "RUB" }),
      ],
      transactions: [
        makeTxn({ id: "t1", accountId: "acc-usd" }),
        makeTxn({ id: "t2", accountId: "acc-rub" }),
      ],
    })
    const result = JSON.parse(
      await handleBulkUpdateTransactions(repo, {
        transactionIds: ["t1", "t2"],
        set: { accountId: "acc-rub" }, // t1 is USD → mismatch
      }),
    )
    expect(result.error).toMatch(/same currency|transfer/i)
    expect(repo.saveTransactions).not.toHaveBeenCalled()
  })

  it("preserves every stamp on a same-currency bulk move", async () => {
    const repo = createMockRepo({
      accounts: [
        makeAccount({ id: "acc-usd", currency: "USD" }),
        makeAccount({ id: "acc-usd2", currency: "USD" }),
      ],
      transactions: [
        makeTxn({ id: "t1", accountId: "acc-usd", fxRate: 1 / 91 }),
        makeTxn({ id: "t2", accountId: "acc-usd", fxRate: 1 / 90 }),
      ],
    })
    const result = JSON.parse(
      await handleBulkUpdateTransactions(repo, {
        transactionIds: ["t1", "t2"],
        set: { accountId: "acc-usd2" },
      }),
    )
    expect(result.success).toBe(true)
    const saved = (repo.saveTransactions as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(saved.find((t: Transaction) => t.id === "t1").fxRate).toBe(1 / 91) // each kept
    expect(saved.find((t: Transaction) => t.id === "t2").fxRate).toBe(1 / 90)
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
