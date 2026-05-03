import { describe, it, expect, beforeEach } from "vitest"
import type { Account, Category } from "@capybudget/core"
import type { BudgetRepository } from "@capybudget/persistence"
import {
  handleAnalyzeCsv,
  handlePreviewTransform,
  handleTransformCsv,
  handleAutoEnrich,
  handleEnrichStats,
  handleEnrichSample,
  handleEnrichUpdate,
  __resetEnrichmentCacheForTests,
} from "./csv"
import { makeFileAdapter, makeMemoryFs, type MemoryFs } from "./test-utils"
import type { ToolContext } from "../dispatch"

const BUDGET_PATH = "/budget"
const SOURCES_DIR = `${BUDGET_PATH}/.capy/import/sources`
const IMPORT_DIR = `${BUDGET_PATH}/.capy/import`

let fs: MemoryFs
let ctx: ToolContext

function makeRepo(data: { accounts?: Account[]; categories?: Category[] } = {}): BudgetRepository {
  return {
    getAccounts: async () => data.accounts ?? [],
    getCategories: async () => data.categories ?? [],
    getTransactions: async () => [],
    saveAccounts: async () => {},
    saveCategories: async () => {},
    saveTransactions: async () => {},
  }
}

beforeEach(() => {
  __resetEnrichmentCacheForTests()
  fs = makeMemoryFs()
  // Pre-create sources dir so tests can drop source files in directly.
  fs.dirs.add(IMPORT_DIR)
  fs.dirs.add(SOURCES_DIR)
  ctx = {
    repo: makeRepo(),
    fileAdapter: makeFileAdapter(fs),
    budgetPath: BUDGET_PATH,
  }
})

// ── analyze_csv ──────────────────────────────────────────────────

describe("handleAnalyzeCsv", () => {
  it("returns headers, sample rows, and total row count", async () => {
    fs.files.set(
      `${SOURCES_DIR}/2024.csv`,
      "Date,Description,Amount\n2024-01-01,Coffee,-4.50\n2024-01-02,Salary,5000.00\n",
    )

    const result = JSON.parse(await handleAnalyzeCsv(ctx, { filename: "2024.csv" }))

    expect(result.headers).toEqual(["Date", "Description", "Amount"])
    expect(result.totalRows).toBe(2)
    expect(result.sampleRows).toHaveLength(2)
    expect(result.sampleRows[0].Description).toBe("Coffee")
  })

  it("rejects path traversal", async () => {
    await expect(
      handleAnalyzeCsv(ctx, { filename: "../escape.csv" }),
    ).rejects.toThrow("Invalid filename")
  })
})

// ── preview_transform ────────────────────────────────────────────

describe("handlePreviewTransform", () => {
  it("transforms a sample using the provided mapping", async () => {
    fs.files.set(
      `${SOURCES_DIR}/2024.csv`,
      "Date,Description,Amount\n2024-01-01,Coffee,-4.50\n2024-01-02,Salary,5000.00\n",
    )

    const result = JSON.parse(
      await handlePreviewTransform(ctx, {
        filename: "2024.csv",
        mapping: {
          date: { column: "Date", format: "YYYY-MM-DD" },
          description: { column: "Description" },
          amount: { style: "single", column: "Amount", sign: "negative_expense" },
          amountFormat: { format: "plain" },
          typeDetection: { method: "amount_sign" },
          sourceAccount: { literal: "Checking" },
          sourceCategory: null,
          memo: null,
        },
        limit: 10,
      }),
    )

    expect(result.transactions).toHaveLength(2)
    expect(result.transactions[0].description).toBe("Coffee")
    expect(result.transactions[0].type).toBe("expense")
    expect(result.transactions[1].type).toBe("income")
  })
})

// ── transform_csv ────────────────────────────────────────────────

describe("handleTransformCsv", () => {
  it("writes transactions.csv with all rows", async () => {
    fs.files.set(
      `${SOURCES_DIR}/2024.csv`,
      "Date,Description,Amount\n2024-01-01,Coffee,-4.50\n2024-01-02,Salary,5000.00\n",
    )

    const result = JSON.parse(
      await handleTransformCsv(ctx, {
        filename: "2024.csv",
        mapping: {
          date: { column: "Date", format: "YYYY-MM-DD" },
          description: { column: "Description" },
          amount: { style: "single", column: "Amount", sign: "negative_expense" },
          amountFormat: { format: "plain" },
          typeDetection: { method: "amount_sign" },
          sourceAccount: { literal: "Checking" },
          sourceCategory: null,
          memo: null,
        },
      }),
    )

    expect(result.success).toBe(true)
    const csv = fs.files.get(`${IMPORT_DIR}/transactions.csv`)!
    expect(csv).toContain("imp-1")
    expect(csv).toContain("imp-2")
    expect(csv).toContain("Coffee")
  })

  it("appends to an existing transactions.csv with continuing IDs", async () => {
    fs.files.set(
      `${SOURCES_DIR}/file1.csv`,
      "Date,Description,Amount\n2024-01-01,A,-1.00\n",
    )
    fs.files.set(
      `${SOURCES_DIR}/file2.csv`,
      "Date,Description,Amount\n2024-02-01,B,-2.00\n",
    )

    const mapping = {
      date: { column: "Date", format: "YYYY-MM-DD" },
      description: { column: "Description" },
      amount: { style: "single" as const, column: "Amount", sign: "negative_expense" as const },
      amountFormat: { format: "plain" as const },
      typeDetection: { method: "amount_sign" as const },
      sourceAccount: { literal: "Checking" },
      sourceCategory: null,
      memo: null,
    }

    await handleTransformCsv(ctx, { filename: "file1.csv", mapping })
    const second = JSON.parse(
      await handleTransformCsv(ctx, { filename: "file2.csv", mapping }),
    )

    expect(second.appended).toBe(true)
    expect(second.startId).toBe(2)
    const csv = fs.files.get(`${IMPORT_DIR}/transactions.csv`)!
    expect(csv).toContain("imp-1")
    expect(csv).toContain("imp-2")
    expect(csv.match(/imp-\d+/g)?.length).toBe(2)
  })
})

// ── enrich_stats ─────────────────────────────────────────────────

describe("handleEnrichStats", () => {
  it("counts merchants, categories, accounts, and transfers", async () => {
    fs.files.set(
      `${IMPORT_DIR}/transactions.csv`,
      [
        "id,date,description,amount,type,sourceAccount,sourceCategory,memo,merchant,accountId,targetAccountId,categoryId,categoryConfidence",
        "imp-1,2024-01-01,Coffee,-450,expense,Cash,,,Coffee,acc-1,,cat-1,low",
        "imp-2,2024-01-02,Pay,500000,income,Cash,,,,acc-1,,,",
        "imp-3,2024-01-03,Move,10000,transfer,Cash,,,,acc-1,acc-2,,",
        "imp-4,2024-01-04,Move,5000,transfer,Cash,,,,acc-1,,,",
      ].join("\n"),
    )

    const result = await handleEnrichStats(ctx)
    expect(result).toContain("Total: 4 rows")
    expect(result).toContain("Merchants: 1/4")
    expect(result).toContain("Categories: 1/2")
    expect(result).toContain("Unmatched transfers: 1")
  })
})

// ── enrich_sample ────────────────────────────────────────────────

describe("handleEnrichSample", () => {
  it("returns rows missing merchant + categoryId by default", async () => {
    fs.files.set(
      `${IMPORT_DIR}/transactions.csv`,
      [
        "id,date,description,amount,type,sourceAccount,sourceCategory,memo,merchant,accountId,targetAccountId,categoryId,categoryConfidence",
        "imp-1,2024-01-01,Coffee,-450,expense,,,,,,,,",
        "imp-2,2024-01-02,Pay,500000,income,,,,Pay,,,cat-1,low",
      ].join("\n"),
    )

    const result = await handleEnrichSample(ctx, {})
    expect(result).toContain("Coffee")
    expect(result).not.toContain("Pay,")
  })
})

// ── enrich_update ────────────────────────────────────────────────

describe("handleEnrichUpdate", () => {
  it("sets fields on rows matching a contains condition", async () => {
    fs.files.set(
      `${IMPORT_DIR}/transactions.csv`,
      [
        "id,date,description,amount,type,sourceAccount,sourceCategory,memo,merchant,accountId,targetAccountId,categoryId,categoryConfidence",
        "imp-1,2024-01-01,STARBUCKS COFFEE,-450,expense,,,,,,,,",
        "imp-2,2024-01-02,WHOLE FOODS,-3000,expense,,,,,,,,",
      ].join("\n"),
    )

    const result = await handleEnrichUpdate(ctx, {
      set: { categoryId: "cat-coffee", categoryConfidence: "low" },
      where: { field: "description", contains: "STARBUCKS" },
    })

    expect(result).toBe("Updated 1 rows.")
    const csv = fs.files.get(`${IMPORT_DIR}/transactions.csv`)!
    expect(csv).toMatch(/STARBUCKS.*cat-coffee/)
    expect(csv).not.toMatch(/WHOLE FOODS.*cat-coffee/)
  })

  it("rejects unknown fields", async () => {
    fs.files.set(
      `${IMPORT_DIR}/transactions.csv`,
      "id,date,description,amount,type,sourceAccount,sourceCategory,memo,merchant,accountId,targetAccountId,categoryId,categoryConfidence\n",
    )

    const result = await handleEnrichUpdate(ctx, {
      set: { description: "evil" },
      where: { field: "id", contains: "imp-" },
    })
    expect(result).toContain("Error")
  })
})

// ── auto_enrich ──────────────────────────────────────────────────

describe("handleAutoEnrich", () => {
  it("matches sourceCategory to budget category and sets merchant from description", async () => {
    fs.files.set(
      `${IMPORT_DIR}/transactions.csv`,
      [
        "id,date,description,amount,type,sourceAccount,sourceCategory,memo,merchant,accountId,targetAccountId,categoryId,categoryConfidence",
        "imp-1,2024-01-01,Whole Foods,-3000,expense,,Groceries,,,,,,",
      ].join("\n"),
    )

    const repo = makeRepo({
      accounts: [],
      categories: [
        {
          id: "cat-grocery",
          name: "Groceries",
          group: "Daily Living",
          archived: false,
          sortOrder: 1,
        },
      ],
    })
    const enrichCtx = { ...ctx, repo }

    const result = await handleAutoEnrich(enrichCtx, repo)
    expect(result).toContain("Categories matched: 1")
    const csv = fs.files.get(`${IMPORT_DIR}/transactions.csv`)!
    expect(csv).toMatch(/Whole Foods.*cat-grocery/)
  })
})
