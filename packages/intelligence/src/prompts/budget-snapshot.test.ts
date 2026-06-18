import { describe, it, expect } from "vitest"
import type { Account, Category, Transaction } from "@capybudget/core"
import { buildBudgetSnapshot, formatBudgetSnapshot } from "./budget-snapshot"

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: crypto.randomUUID(),
    name: "Checking",
    type: "checking",
    archived: false,
    excludeFromNetWorth: false,
    sortOrder: 0,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  }
}

function category(overrides: Partial<Category> = {}): Category {
  return {
    id: crypto.randomUUID(),
    name: "Groceries",
    group: "Daily Living",
    archived: false,
    sortOrder: 0,
    assigned: null,
    ...overrides,
  }
}

function txn(date: string): Transaction {
  return {
    id: crypto.randomUUID(),
    datetime: `${date}T12:00:00Z`,
    type: "expense",
    amount: 1000,
    categoryId: "",
    accountId: "",
    transferPairId: "",
    merchant: "",
    note: "",
    createdAt: `${date}T12:00:00Z`,
  }
}

describe("buildBudgetSnapshot", () => {
  it("counts only non-archived accounts", () => {
    const snap = buildBudgetSnapshot(
      [account(), account({ archived: true })],
      [],
      [],
      "USD",
    )
    expect(snap.accountCount).toBe(1)
  })

  it("derives the date range from earliest and latest transaction", () => {
    const snap = buildBudgetSnapshot(
      [],
      [txn("2026-03-15"), txn("2025-11-02"), txn("2026-01-20")],
      [],
      "USD",
    )
    expect(snap.transactionCount).toBe(3)
    expect(snap.earliestDate).toBe("2025-11-02")
    expect(snap.latestDate).toBe("2026-03-15")
  })

  it("reports nulls when there are no transactions", () => {
    const snap = buildBudgetSnapshot([], [], [], "USD")
    expect(snap.transactionCount).toBe(0)
    expect(snap.earliestDate).toBeNull()
    expect(snap.latestDate).toBeNull()
  })

  it("groups non-archived categories by group in canonical order", () => {
    const snap = buildBudgetSnapshot(
      [],
      [],
      [
        category({ name: "Travel", group: "Irregular" }),
        category({ name: "Paycheck", group: "Income" }),
        category({ name: "Housing", group: "Fixed" }),
        category({ name: "Archived", group: "Fixed", archived: true }),
      ],
      "USD",
    )
    expect(snap.categoriesByGroup).toEqual([
      { group: "Income", names: ["Paycheck"] },
      { group: "Fixed", names: ["Housing"] },
      { group: "Irregular", names: ["Travel"] },
    ])
  })
})

describe("formatBudgetSnapshot", () => {
  it("renders a compact block with currency, counts, range, and grouped categories", () => {
    const out = formatBudgetSnapshot(
      buildBudgetSnapshot(
        [account()],
        [txn("2026-01-01"), txn("2026-02-01")],
        [category({ name: "Groceries", group: "Daily Living" })],
        "EUR",
      ),
    )
    expect(out).toContain("[Budget snapshot]")
    expect(out).toContain("Currency: EUR")
    expect(out).toContain("Accounts: 1 active")
    expect(out).toContain("Transactions: 2 (2026-01-01 → 2026-02-01)")
    expect(out).toContain("Daily Living: Groceries")
  })

  it("says 'none yet' for an empty log", () => {
    const out = formatBudgetSnapshot(buildBudgetSnapshot([], [], [], "USD"))
    expect(out).toContain("Transactions: 0 (none yet)")
  })
})
