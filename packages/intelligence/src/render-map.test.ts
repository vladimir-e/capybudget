import { describe, it, expect } from "vitest"
import { buildRenderToolMap } from "./render-map"

const map = buildRenderToolMap()

describe("render_transactions builder", () => {
  it("builds a TransactionsBlock with explicit IDs", () => {
    const block = map.render_transactions({
      label: "Groceries this month",
      count: 12,
      filter: { transactionIds: ["t1", "t2"] },
      summary: "$432.10 across 2 stores",
    })
    expect(block).toEqual({
      type: "transactions",
      label: "Groceries this month",
      count: 12,
      filter: { transactionIds: ["t1", "t2"] },
      summary: "$432.10 across 2 stores",
    })
  })

  it("accepts category + date filter without IDs", () => {
    const block = map.render_transactions({
      label: "Groceries this month",
      count: 12,
      filter: {
        categoryId: "cat-groceries",
        dateRange: { from: "2026-03-01", to: "2026-03-31" },
      },
    })
    expect(block).not.toBeNull()
    if (block?.type !== "transactions") throw new Error("expected transactions block")
    expect(block.filter.categoryId).toBe("cat-groceries")
    expect(block.filter.dateRange).toEqual({ from: "2026-03-01", to: "2026-03-31" })
  })

  it("returns null on malformed input", () => {
    expect(map.render_transactions({ label: 42, count: 1, filter: {} })).toBeNull()
    expect(map.render_transactions({ label: "x", count: "1", filter: {} })).toBeNull()
    expect(map.render_transactions({ label: "x", count: 1 })).toBeNull()
  })
})

describe("render_duplicate_groups builder", () => {
  it("builds a DuplicateGroupsBlock", () => {
    const block = map.render_duplicate_groups({
      groups: [
        {
          transactionIds: ["t1", "t2"],
          confidence: "high",
          reason: "Same date, amount, merchant, account",
          amount: -1500,
          merchant: "Starbucks",
          date: "2026-03-10",
        },
      ],
    })
    expect(block).not.toBeNull()
    if (block?.type !== "duplicate-groups") throw new Error("expected duplicate-groups block")
    expect(block.groups).toHaveLength(1)
    expect(block.groups[0].confidence).toBe("high")
  })

  it("rejects single-member groups", () => {
    const block = map.render_duplicate_groups({
      groups: [
        {
          transactionIds: ["t1"],
          confidence: "high",
          reason: "?",
          amount: -1500,
          merchant: "Starbucks",
          date: "2026-03-10",
        },
      ],
    })
    expect(block).toBeNull()
  })

  it("returns null on malformed input", () => {
    expect(map.render_duplicate_groups({ groups: "x" })).toBeNull()
    expect(map.render_duplicate_groups({})).toBeNull()
  })
})

describe("render_recurring_patterns builder", () => {
  it("builds a RecurringPatternsBlock", () => {
    const block = map.render_recurring_patterns({
      patterns: [
        {
          merchant: "Netflix",
          cadence: "monthly",
          averageAmount: -1599,
          amountVariance: "stable",
          transactionIds: ["t1", "t2", "t3"],
          firstSeen: "2026-01-15",
          lastSeen: "2026-03-15",
          nextExpected: "2026-04-14",
          totalSpent: 4797,
        },
      ],
    })
    expect(block).not.toBeNull()
    if (block?.type !== "recurring-patterns") throw new Error("expected recurring-patterns block")
    expect(block.patterns).toHaveLength(1)
    expect(block.patterns[0].cadence).toBe("monthly")
    expect(block.patterns[0].nextExpected).toBe("2026-04-14")
  })

  it("skips entries with invalid cadence", () => {
    const block = map.render_recurring_patterns({
      patterns: [
        {
          merchant: "Netflix",
          cadence: "biweekly",
          averageAmount: -1599,
          amountVariance: "stable",
          transactionIds: ["t1"],
          firstSeen: "2026-01-15",
          lastSeen: "2026-03-15",
          totalSpent: 1599,
        },
      ],
    })
    expect(block).toBeNull()
  })

  it("returns null on malformed input", () => {
    expect(map.render_recurring_patterns({})).toBeNull()
    expect(map.render_recurring_patterns({ patterns: [] })).toBeNull()
  })
})
