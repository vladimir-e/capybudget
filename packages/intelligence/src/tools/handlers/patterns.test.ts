import { describe, it, expect, vi } from "vitest"
import type { Account, Category, Transaction } from "@capybudget/core"
import type { BudgetRepository } from "@capybudget/persistence"
import { handleFindDuplicates, handleFindRecurring } from "./patterns"

function makeTxn(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "txn-1",
    datetime: "2026-01-15T12:00:00.000Z",
    type: "expense",
    amount: -5000,
    categoryId: "",
    accountId: "acc-1",
    transferPairId: "",
    merchant: "Starbucks",
    note: "",
    createdAt: "2026-01-15T00:00:00.000Z",
    ...overrides,
  }
}

function makeRepo(transactions: Transaction[]): BudgetRepository {
  return {
    getAccounts: vi.fn().mockResolvedValue([] as Account[]),
    getCategories: vi.fn().mockResolvedValue([] as Category[]),
    getTransactions: vi.fn().mockResolvedValue(transactions),
    saveAccounts: vi.fn().mockResolvedValue(undefined),
    saveCategories: vi.fn().mockResolvedValue(undefined),
    saveTransactions: vi.fn().mockResolvedValue(undefined),
  }
}

describe("handleFindDuplicates", () => {
  it("returns shaped JSON with groupCount + groups", async () => {
    const txns = [
      makeTxn({ id: "t1", datetime: "2026-03-10T10:00:00.000Z" }),
      makeTxn({ id: "t2", datetime: "2026-03-10T14:00:00.000Z" }),
    ]
    const json = await handleFindDuplicates(makeRepo(txns), {})
    const parsed = JSON.parse(json) as {
      groupCount: number
      groups: Array<{ confidence: string; amount: string; amountCents: number }>
    }
    expect(parsed.groupCount).toBe(1)
    expect(parsed.groups[0].confidence).toBe("high")
    expect(parsed.groups[0].amount).toBe("-$50.00")
    expect(parsed.groups[0].amountCents).toBe(-5000)
  })

  it("filters by confidence", async () => {
    const txns = [
      // High pair on 03-10
      makeTxn({ id: "h1", merchant: "A", accountId: "acc-1", datetime: "2026-03-10T10:00:00.000Z" }),
      makeTxn({ id: "h2", merchant: "A", accountId: "acc-1", datetime: "2026-03-10T11:00:00.000Z" }),
      // Possible pair on 03-15 (same account, same amount, 1 day apart)
      makeTxn({ id: "p1", merchant: "B", accountId: "acc-2", datetime: "2026-03-15T10:00:00.000Z" }),
      makeTxn({ id: "p2", merchant: "B Marketplace", accountId: "acc-2", datetime: "2026-03-16T10:00:00.000Z" }),
    ]
    const repo = makeRepo(txns)
    const high = JSON.parse(await handleFindDuplicates(repo, { confidence: "high" }))
    expect(high.groupCount).toBe(1)
    const possible = JSON.parse(await handleFindDuplicates(repo, { confidence: "possible" }))
    expect(possible.groupCount).toBe(1)
  })

  it("filters by accountId before running detection", async () => {
    const txns = [
      makeTxn({ id: "t1", accountId: "acc-1", datetime: "2026-03-10T10:00:00.000Z" }),
      makeTxn({ id: "t2", accountId: "acc-2", datetime: "2026-03-10T11:00:00.000Z" }),
    ]
    const result = JSON.parse(
      await handleFindDuplicates(makeRepo(txns), { accountId: "acc-1" }),
    )
    expect(result.groupCount).toBe(0)
  })
})

describe("handleFindRecurring", () => {
  function monthly(merchant: string, count: number): Transaction[] {
    const result: Transaction[] = []
    for (let i = 0; i < count; i++) {
      const month = (i + 1).toString().padStart(2, "0")
      result.push(
        makeTxn({
          id: `${merchant}-${i}`,
          merchant,
          amount: -1599,
          datetime: `2026-${month}-15T10:00:00.000Z`,
        }),
      )
    }
    return result
  }

  it("returns shaped JSON with patternCount + patterns", async () => {
    const json = await handleFindRecurring(makeRepo(monthly("Netflix", 6)), {})
    const parsed = JSON.parse(json) as {
      patternCount: number
      patterns: Array<{ cadence: string; totalSpent: string; averageAmount: string }>
    }
    expect(parsed.patternCount).toBe(1)
    expect(parsed.patterns[0].cadence).toBe("monthly")
    expect(parsed.patterns[0].averageAmount).toBe("-$15.99")
  })

  it("filters by cadence", async () => {
    const txns = monthly("Netflix", 6)
    const result = JSON.parse(
      await handleFindRecurring(makeRepo(txns), { cadence: "weekly" }),
    )
    expect(result.patternCount).toBe(0)
  })

  it("respects minTransactions", async () => {
    const result = JSON.parse(
      await handleFindRecurring(makeRepo(monthly("Netflix", 4)), {
        minTransactions: 5,
      }),
    )
    expect(result.patternCount).toBe(0)
  })
})
