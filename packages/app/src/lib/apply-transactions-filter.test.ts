import { describe, it, expect } from "vitest"
import { applyTransactionsFilter } from "@/lib/apply-transactions-filter"
import type { Transaction } from "@capybudget/core"
import type { TransactionsFilter } from "@capybudget/intelligence"

const txn = (
  overrides: Partial<Transaction> & Pick<Transaction, "id" | "amount">,
): Transaction => ({
  datetime: "2026-03-15T12:00:00.000Z",
  type: "expense",
  categoryId: "cat-1",
  accountId: "acc-1",
  transferPairId: "",
  merchant: "Store",
  note: "",
  createdAt: "2026-03-15T00:00:00.000Z",
  ...overrides,
})

const txns: Transaction[] = [
  txn({ id: "t1", amount: -5000, merchant: "Trader Joe's", categoryId: "cat-food", datetime: "2026-02-10T12:00:00.000Z", type: "expense" }),
  txn({ id: "t2", amount: -185000, merchant: "Landlord", categoryId: "cat-rent", datetime: "2026-02-15T12:00:00.000Z", type: "expense" }),
  txn({ id: "t3", amount: 420000, merchant: "Acme Corp", categoryId: "cat-income", datetime: "2026-03-01T12:00:00.000Z", type: "income" }),
  txn({ id: "t4", amount: -1200, merchant: "Netflix", categoryId: "cat-fun", datetime: "2026-03-10T12:00:00.000Z", type: "expense" }),
  txn({ id: "t5", amount: -50000, merchant: "Transfer Out", categoryId: "", datetime: "2026-03-12T12:00:00.000Z", type: "transfer" }),
]

describe("applyTransactionsFilter", () => {
  it("returns all transactions with empty filter", () => {
    const result = applyTransactionsFilter(txns, {})
    expect(result).toEqual(txns)
  })

  it("filters by transactionIds", () => {
    const filter: TransactionsFilter = { transactionIds: ["t1", "t3"] }
    const result = applyTransactionsFilter(txns, filter)
    expect(result.map((t) => t.id)).toEqual(["t1", "t3"])
  })

  it("filters by merchant (case-insensitive exact match)", () => {
    const result = applyTransactionsFilter(txns, { merchant: "TRADER JOE'S" })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("t1")
  })

  it("filters by categoryId", () => {
    const result = applyTransactionsFilter(txns, { categoryId: "cat-rent" })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("t2")
  })

  it("filters by dateRange", () => {
    const result = applyTransactionsFilter(txns, {
      dateRange: { from: "2026-02-01", to: "2026-02-28" },
    })
    expect(result).toHaveLength(2)
    expect(result.map((t) => t.id)).toEqual(["t1", "t2"])
  })

  it("filters by amountRange — min only", () => {
    const result = applyTransactionsFilter(txns, {
      amountRange: { min: 10000 },
    })
    expect(result.map((t) => t.id)).toEqual(["t2", "t3", "t5"])
  })

  it("filters by amountRange — max only", () => {
    const result = applyTransactionsFilter(txns, {
      amountRange: { max: 5000 },
    })
    expect(result.map((t) => t.id)).toEqual(["t1", "t4"])
  })

  it("filters by amountRange — min and max", () => {
    const result = applyTransactionsFilter(txns, {
      amountRange: { min: 1000, max: 10000 },
    })
    expect(result.map((t) => t.id)).toEqual(["t1", "t4"])
  })

  it("filters by type", () => {
    const result = applyTransactionsFilter(txns, { type: "income" })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("t3")
  })

  it("combines multiple filters", () => {
    const result = applyTransactionsFilter(txns, {
      type: "expense",
      dateRange: { from: "2026-03-01", to: "2026-03-31" },
    })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("t4")
  })

  it("returns empty when no transactions match", () => {
    const result = applyTransactionsFilter(txns, { merchant: "Nonexistent" })
    expect(result).toHaveLength(0)
  })
})
