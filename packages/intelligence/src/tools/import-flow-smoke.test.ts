/**
 * Smoke test: full CSV import pipeline through `runTool` dispatch.
 * Confirms analyze_csv → preview_transform → transform_csv → auto_enrich
 * → enrich_status works against an in-memory FileAdapter, mirroring what
 * the API adapters do in production.
 */

import { describe, it, expect, beforeEach } from "vitest"
import type { Account, Category } from "@capybudget/core"
import type { BudgetRepository } from "@capybudget/persistence"
import { runTool } from "./dispatch"
import {
  makeFileAdapter,
  makeMemoryFs,
  type MemoryFs,
} from "./handlers/test-utils"
import { __resetEnrichmentCacheForTests } from "./handlers/csv"

const BUDGET_PATH = "/budget"

let fs: MemoryFs
let ctx: { repo: BudgetRepository; fileAdapter: ReturnType<typeof makeFileAdapter>; budgetPath: string }

function makeRepo(data: { accounts: Account[]; categories: Category[] }): BudgetRepository {
  return {
    getAccounts: async () => data.accounts,
    getCategories: async () => data.categories,
    getTransactions: async () => [],
    saveAccounts: async () => {},
    saveCategories: async () => {},
    saveTransactions: async () => {},
  }
}

beforeEach(() => {
  __resetEnrichmentCacheForTests()
  fs = makeMemoryFs()
  fs.dirs.add(`${BUDGET_PATH}/.capy/import/sources`)
  ctx = {
    repo: makeRepo({ accounts: [], categories: [] }),
    fileAdapter: makeFileAdapter(fs),
    budgetPath: BUDGET_PATH,
  }
})

describe("CSV import smoke", () => {
  it("walks analyze → preview → transform → auto_enrich → enrich_status", async () => {
    fs.files.set(
      `${BUDGET_PATH}/.capy/import/sources/2024.csv`,
      [
        "Date,Description,Amount,Category",
        "2024-01-01,Coffee Bean,-4.50,Coffee",
        "2024-01-02,Whole Foods,-32.50,Groceries",
        "2024-01-03,Salary,5000.00,Income",
      ].join("\n"),
    )

    const analyze = JSON.parse(
      await runTool("analyze_csv", { filename: "2024.csv" }, ctx),
    )
    expect(analyze.headers).toContain("Date")
    expect(analyze.totalRows).toBe(3)

    const mapping = {
      date: { column: "Date", format: "YYYY-MM-DD" },
      description: { column: "Description" },
      amount: { style: "single", column: "Amount", sign: "negative_expense" },
      amountFormat: { format: "plain" },
      typeDetection: { method: "amount_sign" },
      sourceAccount: { literal: "Cash" },
      sourceCategory: { column: "Category" },
      memo: null,
    }

    const preview = JSON.parse(
      await runTool("preview_transform", { filename: "2024.csv", mapping }, ctx),
    )
    expect(preview.transactions).toHaveLength(3)

    const transform = JSON.parse(
      await runTool("transform_csv", { filename: "2024.csv", mapping }, ctx),
    )
    expect(transform.success).toBe(true)

    const transactionsCsv = fs.files.get(`${BUDGET_PATH}/.capy/import/transactions.csv`)
    expect(transactionsCsv).toBeDefined()
    expect(transactionsCsv).toMatch(/imp-1/)
    expect(transactionsCsv).toMatch(/imp-3/)

    // Now run auto_enrich with a budget that has matching categories.
    ctx.repo = makeRepo({
      accounts: [],
      categories: [
        {
          id: "cat-coffee",
          name: "Coffee",
          group: "Daily Living" as const,
          archived: false,
          sortOrder: 1,
          assigned: null,
        },
        {
          id: "cat-grocery",
          name: "Groceries",
          group: "Daily Living" as const,
          archived: false,
          sortOrder: 2,
          assigned: null,
        },
        {
          id: "cat-income",
          name: "Income",
          group: "Income" as const,
          archived: false,
          sortOrder: 3,
          assigned: null,
        },
      ],
    })
    __resetEnrichmentCacheForTests()

    const enrich = await runTool("auto_enrich", {}, ctx)
    expect(enrich).toContain("Categories matched: 3")

    const stats = await runTool("enrich_status", {}, ctx)
    expect(stats).toContain("Total: 3 rows")
  })
})
