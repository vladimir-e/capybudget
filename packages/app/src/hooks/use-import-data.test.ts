/**
 * The import preview's account-mapping overlay (Unit 4).
 *
 * The run resolves account mapping onto the staging CSV — aliases applied in
 * the accounts phase's pre-step, then the agent maps the rest, both persisting
 * `accountId`. The preview renders that, no name-match recompute. These tests
 * pin the contract:
 *   - dropdowns seed from the persisted `accountId` on staging rows;
 *   - the alias file is the authoritative top layer of the overlay;
 *   - a manual map writes a new alias; the agent's seeded mapping does not.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { Account, Category, ImportAliases, ImportTransaction } from "@capybudget/core"

// ── Mocks ───────────────────────────────────────────────────────────

const accounts: Account[] = [
  { id: "acct-chase", name: "Chase Checking", type: "checking", archived: false, excludeFromNetWorth: false, sortOrder: 0, createdAt: "" },
  { id: "acct-bofa", name: "BofA Savings", type: "savings", archived: false, excludeFromNetWorth: false, sortOrder: 1, createdAt: "" },
]
const categories: Category[] = [
  { id: "cat-1", name: "Groceries", group: "Daily Living", archived: false, sortOrder: 0, assigned: null },
]

vi.mock("@/hooks/use-budget-data", () => ({
  useAccounts: () => ({ data: accounts }),
  useCategories: () => ({ data: categories }),
  useTransactions: () => ({ data: [] }),
}))

let stagingRows: ImportTransaction[] = []
let aliasFile: ImportAliases = { accounts: {} }
const writeAliases = vi.fn(async (a: ImportAliases) => { aliasFile = a })
const writeTransactionsCsv = vi.fn(async () => {})

vi.mock("@/hooks/use-import-repository", () => ({
  useImportRepository: () => ({
    readTransactionsCsv: async () => stagingRows,
    writeTransactionsCsv,
    readAliases: async () => aliasFile,
    writeAliases,
  }),
}))

import { useImportData } from "./use-import-data"

function makeRow(overrides: Partial<ImportTransaction>): ImportTransaction {
  return {
    id: crypto.randomUUID(),
    date: "2026-03-01",
    description: "PURCHASE",
    amount: -1000,
    type: "expense",
    sourceAccount: "Chase Checking",
    sourceCategory: "",
    memo: "",
    merchant: "",
    accountId: "",
    targetAccountId: "",
    categoryId: "",
    categoryConfidence: "",
    duplicate: false,
    duplicateOf: "",
    duplicateConfidence: "",
    ...overrides,
  }
}

beforeEach(() => {
  stagingRows = []
  aliasFile = { accounts: {} }
  writeAliases.mockClear()
  writeTransactionsCsv.mockClear()
})

describe("useImportData account overlay", () => {
  it("seeds the dropdowns from the persisted accountId on staging rows", async () => {
    // The agent already mapped "Chase Checking" → acct-chase onto the CSV.
    stagingRows = [makeRow({ sourceAccount: "Chase Checking", accountId: "acct-chase" })]

    const { result } = renderHook(() => useImportData("/budget"))

    await waitFor(() =>
      expect(result.current.accountMapping["Chase Checking"]).toBe("acct-chase"),
    )
  })

  it("lets the stored alias win over the persisted accountId", async () => {
    // Staging carries an agent-set accountId, but the alias file says otherwise
    // (the user previously remapped this source). Aliases are the top layer.
    stagingRows = [makeRow({ sourceAccount: "Chase Checking", accountId: "acct-chase" })]
    aliasFile = { accounts: { "Chase Checking": "acct-bofa" } }

    const { result } = renderHook(() => useImportData("/budget"))

    await waitFor(() =>
      expect(result.current.accountMapping["Chase Checking"]).toBe("acct-bofa"),
    )
  })

  it("does not write an alias just because staging carried an agent mapping", async () => {
    stagingRows = [makeRow({ sourceAccount: "Chase Checking", accountId: "acct-chase" })]

    const { result } = renderHook(() => useImportData("/budget"))
    await waitFor(() =>
      expect(result.current.accountMapping["Chase Checking"]).toBe("acct-chase"),
    )

    // The overlay merely renders the agent's persisted mapping — it must not
    // promote it into the alias file.
    expect(writeAliases).not.toHaveBeenCalled()
  })

  it("writes a new alias when the user manually maps an account", async () => {
    stagingRows = [makeRow({ sourceAccount: "Chase Checking", accountId: "" })]

    const { result } = renderHook(() => useImportData("/budget"))
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => {
      result.current.handleAccountMappingChange({ "Chase Checking": "acct-chase" })
    })

    await waitFor(() => expect(writeAliases).toHaveBeenCalled())
    expect(aliasFile.accounts["Chase Checking"]).toBe("acct-chase")
  })

  it("does not write an alias for a manual __create__ selection (merge mints the UUID)", async () => {
    stagingRows = [makeRow({ sourceAccount: "New Bank", accountId: "" })]

    const { result } = renderHook(() => useImportData("/budget"))
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => {
      result.current.handleAccountMappingChange({ "New Bank": "__create__" })
    })

    // Give any async alias write a chance to fire.
    await new Promise((r) => setTimeout(r, 0))
    expect(writeAliases).not.toHaveBeenCalled()
  })
})
