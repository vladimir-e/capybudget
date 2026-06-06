import { describe, it, expect, beforeEach } from "vitest"
import type { Account, Category, Transaction } from "@capybudget/core"
import type { BudgetRepository } from "@capybudget/persistence"
import {
  handleAnalyzeCsv,
  handlePreviewTransform,
  handleTransformCsv,
  handleAutoEnrich,
  handleApplyAccountAliases,
  handleEnrichStatus,
  handleEnrichUpdate,
  handleFindDuplicates,
  handleMarkDuplicates,
  handleAutoMarkDuplicates,
} from "./csv"
import { makeFileAdapter, makeMemoryFs, type MemoryFs } from "./test-utils"
import type { ToolContext } from "../dispatch"

const BUDGET_PATH = "/budget"
const SOURCES_DIR = `${BUDGET_PATH}/.capy/import/sources`
const IMPORT_DIR = `${BUDGET_PATH}/.capy/import`

let fs: MemoryFs
let ctx: ToolContext

function makeRepo(
  data: { accounts?: Account[]; categories?: Category[]; transactions?: Transaction[] } = {},
): BudgetRepository {
  return {
    getAccounts: async () => data.accounts ?? [],
    getCategories: async () => data.categories ?? [],
    getTransactions: async () => data.transactions ?? [],
    saveAccounts: async () => {},
    saveCategories: async () => {},
    saveTransactions: async () => {},
  }
}

beforeEach(() => {
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

// ── enrich_status ────────────────────────────────────────────────

describe("handleEnrichStatus", () => {
  it("counts merchants, categories, accounts, and transfers (sampleSize 0 = stats only)", async () => {
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

    const result = await handleEnrichStatus(ctx, { sampleSize: 0 })
    expect(result).toContain("Total: 4 rows")
    // Transfers excluded from both denominators — they don't get merchants
    // or categories (merge code clears them in import-merge.ts).
    expect(result).toContain("Merchants: 1/2 (2 transfers excluded)")
    expect(result).toContain("Categories: 1/2 (2 transfers excluded)")
    expect(result).toContain("Unmatched transfers: 1")
    // No sample requested — stats only.
    expect(result).not.toContain("Sample:")
  })

  it("defaults to stats-only when sampleSize is omitted", async () => {
    fs.files.set(
      `${IMPORT_DIR}/transactions.csv`,
      [
        "id,date,description,amount,type,sourceAccount,sourceCategory,memo,merchant,accountId,targetAccountId,categoryId,categoryConfidence",
        "imp-1,2024-01-01,Coffee,-450,expense,,,,,,,,",
      ].join("\n"),
    )

    const result = await handleEnrichStatus(ctx)
    expect(result).toContain("Total: 1 rows")
    expect(result).not.toContain("Sample:")
  })

  it("appends a sample of rows still needing work when sampleSize > 0", async () => {
    fs.files.set(
      `${IMPORT_DIR}/transactions.csv`,
      [
        "id,date,description,amount,type,sourceAccount,sourceCategory,memo,merchant,accountId,targetAccountId,categoryId,categoryConfidence",
        "imp-1,2024-01-01,Coffee,-450,expense,,,,,,,,",
        "imp-2,2024-01-02,Pay,500000,income,,,,Pay,,,cat-1,low",
      ].join("\n"),
    )

    const result = await handleEnrichStatus(ctx, { sampleSize: 20 })
    expect(result).toContain("Total: 2 rows")
    expect(result).toContain("Sample:")
    expect(result).toContain("Coffee")
    // Fully enriched rows are excluded from the sample.
    expect(result).not.toContain("Pay,")
  })

  it("excludes duplicate-marked rows from the counts and the sample", async () => {
    // imp-2 is a duplicate with an empty category — it must not be counted as
    // needing work, nor appear in the work sample (it won't be merged and was
    // already dup-enriched).
    fs.files.set(
      `${IMPORT_DIR}/transactions.csv`,
      [
        "id,date,description,amount,type,sourceAccount,sourceCategory,memo,merchant,accountId,targetAccountId,categoryId,categoryConfidence,duplicate,duplicateOf,duplicateConfidence",
        "imp-1,2024-01-01,Coffee,-450,expense,,,,,,,,,,,",
        "imp-2,2024-01-02,DUPLICATE ROW,-999,expense,,,,,,,,,true,tx-1,high",
      ].join("\n"),
    )

    const result = await handleEnrichStatus(ctx, { sampleSize: 20 })
    // Only the one non-duplicate row is in scope.
    expect(result).toContain("Total: 1 rows")
    expect(result).toContain("Still need category: 1")
    // The duplicate row is absent from the sample.
    expect(result).toContain("Coffee")
    expect(result).not.toContain("DUPLICATE ROW")
  })

  it("filters the sample by sampleField (targetAccountId for unmatched transfers)", async () => {
    fs.files.set(
      `${IMPORT_DIR}/transactions.csv`,
      [
        "id,date,description,amount,type,sourceAccount,sourceCategory,memo,merchant,accountId,targetAccountId,categoryId,categoryConfidence",
        "imp-1,2024-01-01,Coffee,-450,expense,,,,,,,,",
        "imp-2,2024-01-02,Move to savings,10000,transfer,Checking,,,,acc-1,,,",
      ].join("\n"),
    )

    const result = await handleEnrichStatus(ctx, {
      sampleSize: 20,
      sampleField: "targetAccountId",
    })
    expect(result).toContain("Sample:")
    // Transfer-target header + the unmatched transfer row.
    expect(result).toContain("description,amount,type,sourceAccount,targetAccountId")
    expect(result).toContain("Move to savings")
    // Non-transfer rows aren't in a targetAccountId sample.
    expect(result).not.toContain("Coffee")
  })
})

// ── cross-process read coherence (no stale cache) ────────────────
// For the Claude CLI provider the model's tool calls run in the MCP
// subprocess while the orchestrator's pre-steps run in the renderer —
// two module instances over one transactions.csv on disk. A read-through
// cache in either instance goes stale the moment the other writes, and
// the next read+writeback silently clobbers the other's edits. These
// tests pin that reads always reflect what's on disk by writing a
// MODIFIED staging file DIRECTLY via the fileAdapter (simulating the
// other process) between two reads.

describe("staging reads reflect external writes", () => {
  it("handleEnrichStatus sees an accountId written by another process", async () => {
    fs.files.set(
      `${IMPORT_DIR}/transactions.csv`,
      [
        "id,date,description,amount,type,sourceAccount,sourceCategory,memo,merchant,accountId,targetAccountId,categoryId,categoryConfidence",
        "imp-1,2024-01-01,Coffee,-450,expense,Cash,,,,,,,",
      ].join("\n"),
    )

    // First read: no account resolved yet.
    const before = await handleEnrichStatus(ctx, { sampleSize: 0 })
    expect(before).toContain("Accounts: 0/1")

    // The MCP subprocess resolves accountId and writes to disk directly,
    // bypassing this instance's writeImportCsv. A stale cache would miss it.
    fs.files.set(
      `${IMPORT_DIR}/transactions.csv`,
      [
        "id,date,description,amount,type,sourceAccount,sourceCategory,memo,merchant,accountId,targetAccountId,categoryId,categoryConfidence",
        "imp-1,2024-01-01,Coffee,-450,expense,Cash,,,,acc-1,,,",
      ].join("\n"),
    )

    // Second read must reflect the external write.
    const after = await handleEnrichStatus(ctx, { sampleSize: 0 })
    expect(after).toContain("Accounts: 1/1")
  })

  it("handleFindDuplicates sees rows added by another process", async () => {
    const repo = makeRepo({
      transactions: [
        makeExisting({ id: "tx-1", amount: -3000, note: "WHOLE FOODS" }),
      ],
    })
    const findCtx = { ...ctx, repo }

    fs.files.set(
      `${IMPORT_DIR}/transactions.csv`,
      [CSV_HEADER, "imp-1,2024-01-01,COFFEE,-450,expense,Chk,,,,acct-1,,,"].join("\n"),
    )

    // No staging row matches the existing transaction yet.
    const before = JSON.parse(await handleFindDuplicates(findCtx, repo))
    expect(before.summary.total).toBe(0)

    // Another process appends a row that DOES match — written to disk directly.
    fs.files.set(
      `${IMPORT_DIR}/transactions.csv`,
      [
        CSV_HEADER,
        "imp-1,2024-01-01,COFFEE,-450,expense,Chk,,,,acct-1,,,",
        "imp-2,2024-01-01,WHOLE FOODS,-3000,expense,Chk,,,,acct-1,,,",
      ].join("\n"),
    )

    const after = JSON.parse(await handleFindDuplicates(findCtx, repo))
    expect(after.summary.total).toBe(1)
    expect(after.high[0]).toMatchObject({ importId: "imp-2", matchedTransactionId: "tx-1" })
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

    const repo = makeRepo({
      categories: [
        { id: "cat-coffee", name: "Dining Out", group: "Daily Living", archived: false, sortOrder: 1, assigned: null },
      ],
    })
    const result = await handleEnrichUpdate(
      { ...ctx, repo },
      {
        set: { categoryId: "cat-coffee", categoryConfidence: "low" },
        where: { field: "description", contains: "STARBUCKS" },
      },
      repo,
    )

    expect(result).toContain("Matched 1 rows.")
    expect(result).toContain("categoryId: 1 set, 0 skipped")
    expect(result).toContain("categoryConfidence: 1 set, 0 skipped")
    const csv = fs.files.get(`${IMPORT_DIR}/transactions.csv`)!
    expect(csv).toMatch(/STARBUCKS.*cat-coffee/)
    expect(csv).not.toMatch(/WHOLE FOODS.*cat-coffee/)
  })

  it("never matches duplicate-marked rows", async () => {
    // imp-1 is a duplicate — excluded from the merge and already dup-enriched.
    // Even when it satisfies the WHERE, it must not be matched or touched.
    fs.files.set(
      `${IMPORT_DIR}/transactions.csv`,
      [
        "id,date,description,amount,type,sourceAccount,sourceCategory,memo,merchant,accountId,targetAccountId,categoryId,categoryConfidence,duplicate,duplicateOf,duplicateConfidence",
        "imp-1,2024-01-01,STARBUCKS COFFEE,-450,expense,,,,,,,,,true,tx-1,high",
        "imp-2,2024-01-02,STARBUCKS COFFEE,-450,expense,,,,,,,,,,,",
      ].join("\n"),
    )

    const repo = makeRepo({
      categories: [
        { id: "cat-coffee", name: "Dining Out", group: "Daily Living", archived: false, sortOrder: 1, assigned: null },
      ],
    })
    const result = await handleEnrichUpdate(
      { ...ctx, repo },
      {
        set: { categoryId: "cat-coffee" },
        where: { field: "description", contains: "STARBUCKS" },
      },
      repo,
    )

    // Only the non-duplicate row counts toward the match — the duplicate is
    // invisible to enrich.
    expect(result).toContain("Matched 1 rows.")
    const csv = fs.files.get(`${IMPORT_DIR}/transactions.csv`)!
    const imp1 = csv.split("\n").find((l) => l.startsWith("imp-1"))!
    expect(imp1).not.toContain("cat-coffee")
  })

  it("returns per-field counts including skipped-already-populated fields", async () => {
    fs.files.set(
      `${IMPORT_DIR}/transactions.csv`,
      [
        "id,date,description,amount,type,sourceAccount,sourceCategory,memo,merchant,accountId,targetAccountId,categoryId,categoryConfidence",
        // Row already has merchant set but no categoryId — model trying to set both
        "imp-1,2024-01-01,STARBUCKS COFFEE,-450,expense,,,,Starbucks,,,,",
      ].join("\n"),
    )

    const repo = makeRepo({
      categories: [
        { id: "cat-coffee", name: "Dining Out", group: "Daily Living", archived: false, sortOrder: 1, assigned: null },
      ],
    })
    const result = await handleEnrichUpdate(
      { ...ctx, repo },
      {
        set: { merchant: "Starbucks Coffee", categoryId: "cat-coffee", categoryConfidence: "high" },
        where: { field: "description", contains: "STARBUCKS" },
      },
      repo,
    )

    expect(result).toContain("Matched 1 rows.")
    expect(result).toContain("merchant: 0 set, 1 skipped")
    expect(result).toContain("categoryId: 1 set, 0 skipped")
    expect(result).toContain("categoryConfidence: 1 set, 0 skipped")
    const csv = fs.files.get(`${IMPORT_DIR}/transactions.csv`)!
    // Merchant kept its existing value, categoryId got the new one.
    expect(csv).toMatch(/STARBUCKS COFFEE.*Starbucks(?!.*Coffee).*cat-coffee/)
  })

  it("returns 'Matched 0 rows.' when no row matches the WHERE", async () => {
    fs.files.set(
      `${IMPORT_DIR}/transactions.csv`,
      [
        "id,date,description,amount,type,sourceAccount,sourceCategory,memo,merchant,accountId,targetAccountId,categoryId,categoryConfidence",
        "imp-1,2024-01-01,STARBUCKS COFFEE,-450,expense,,,,,,,,",
      ].join("\n"),
    )

    const result = await handleEnrichUpdate(ctx, {
      set: { merchant: "Whatever" },
      where: { field: "description", contains: "NETFLIX" },
    })

    expect(result).toBe("Matched 0 rows.")
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

  it("rejects categoryId not present in the budget's categories", async () => {
    fs.files.set(
      `${IMPORT_DIR}/transactions.csv`,
      [
        "id,date,description,amount,type,sourceAccount,sourceCategory,memo,merchant,accountId,targetAccountId,categoryId,categoryConfidence",
        "imp-1,2024-01-01,STARBUCKS COFFEE,-450,expense,,,,,,,,",
      ].join("\n"),
    )

    const repo = makeRepo({
      categories: [
        { id: "cat-real", name: "Dining Out", group: "Daily Living", archived: false, sortOrder: 1, assigned: null },
      ],
    })

    const result = await handleEnrichUpdate(
      { ...ctx, repo },
      {
        set: { categoryId: "cat-invented" },
        where: { field: "description", contains: "STARBUCKS" },
      },
      repo,
    )

    expect(result).toContain("Error: invalid categoryId")
    expect(result).toContain("list_categories")
    // Should NOT have written the row.
    const csv = fs.files.get(`${IMPORT_DIR}/transactions.csv`)!
    expect(csv).not.toContain("cat-invented")
  })

  it("accepts categoryId when present in the budget's categories", async () => {
    fs.files.set(
      `${IMPORT_DIR}/transactions.csv`,
      [
        "id,date,description,amount,type,sourceAccount,sourceCategory,memo,merchant,accountId,targetAccountId,categoryId,categoryConfidence",
        "imp-1,2024-01-01,STARBUCKS COFFEE,-450,expense,,,,,,,,",
      ].join("\n"),
    )

    const repo = makeRepo({
      categories: [
        { id: "cat-real", name: "Dining Out", group: "Daily Living", archived: false, sortOrder: 1, assigned: null },
      ],
    })

    const result = await handleEnrichUpdate(
      { ...ctx, repo },
      {
        set: { categoryId: "cat-real" },
        where: { field: "description", contains: "STARBUCKS" },
      },
      repo,
    )

    expect(result).toContain("Matched 1 rows.")
    expect(result).toContain("categoryId: 1 set")
  })
})

// ── auto_enrich ──────────────────────────────────────────────────

describe("handleAutoEnrich", () => {
  it("matches sourceCategory to budget category", async () => {
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
          assigned: null,
        },
      ],
    })
    const enrichCtx = { ...ctx, repo }

    const result = await handleAutoEnrich(enrichCtx, repo)
    expect(result).toContain("Categories matched: 1")
    const csv = fs.files.get(`${IMPORT_DIR}/transactions.csv`)!
    expect(csv).toMatch(/Whole Foods.*cat-grocery/)
  })

  it("does NOT copy description into merchant — leaves merchant empty for the model", async () => {
    fs.files.set(
      `${IMPORT_DIR}/transactions.csv`,
      [
        "id,date,description,amount,type,sourceAccount,sourceCategory,memo,merchant,accountId,targetAccountId,categoryId,categoryConfidence",
        "imp-1,2024-01-01,CHECKCARD 0315 TRADER JOE'S #123 SEATTLE WA,-3000,expense,,,,,,,,",
      ].join("\n"),
    )

    const repo = makeRepo({ accounts: [], categories: [] })

    const result = await handleAutoEnrich({ ...ctx, repo }, repo)
    expect(result).not.toContain("Merchants set")
    const csv = fs.files.get(`${IMPORT_DIR}/transactions.csv`)!
    // After the description / amount / type, every remaining column
    // must be empty — most importantly `merchant`. If auto_enrich had
    // copied the description in we'd see CHECKCARD-prefixed text
    // showing up again in the trailing columns.
    expect(csv).toMatch(/TRADER JOE'S #123 SEATTLE WA,-3000,expense,,,,,,,,/)
    // Defense in depth: count how many times the raw description token
    // appears. Exactly once — in the description column itself.
    expect(csv.match(/CHECKCARD/g)?.length).toBe(1)
  })
})

// ── apply_account_aliases (accounts-phase pre-step) ──────────────

const CSV_HEADER =
  "id,date,description,amount,type,sourceAccount,sourceCategory,memo,merchant,accountId,targetAccountId,categoryId,categoryConfidence"

function setStaging(rows: string[]) {
  fs.files.set(`${IMPORT_DIR}/transactions.csv`, [CSV_HEADER, ...rows].join("\n"))
}

function setAliases(accounts: Record<string, string>) {
  fs.files.set(`${BUDGET_PATH}/.capy/aliases.json`, JSON.stringify({ accounts }))
}

function stagingCsv(): string {
  return fs.files.get(`${IMPORT_DIR}/transactions.csv`)!
}

describe("handleApplyAccountAliases", () => {
  it("sets accountId on rows whose sourceAccount has a stored alias", async () => {
    setStaging([
      "imp-1,2024-01-01,COFFEE,-450,expense,Chase Checking,,,,,,,",
      "imp-2,2024-01-02,RENT,-150000,expense,Chase Checking,,,,,,,",
    ])
    setAliases({ "Chase Checking": "acct-chase" })

    const result = await handleApplyAccountAliases(ctx)

    expect(result).toBe("Applied 2 account aliases.")
    const csv = stagingCsv()
    expect(csv.match(/acct-chase/g)?.length).toBe(2)
  })

  it("leaves unmapped source accounts untouched (the agent turn handles them)", async () => {
    setStaging([
      "imp-1,2024-01-01,COFFEE,-450,expense,Chase Checking,,,,,,,",
      "imp-2,2024-01-02,GAS,-4000,expense,💰 BofA Savings,,,,,,,",
    ])
    setAliases({ "Chase Checking": "acct-chase" })

    await handleApplyAccountAliases(ctx)

    const csv = stagingCsv()
    expect(csv).toMatch(/Chase Checking,,,,acct-chase,/)
    // The unaliased row's accountId stays empty for the agent to fill.
    expect(csv).toMatch(/💰 BofA Savings,,,,,,,/)
  })

  it("does not overwrite an accountId already set (alias precedence over a pre-set value)", async () => {
    setStaging([
      "imp-1,2024-01-01,COFFEE,-450,expense,Chase Checking,,,,acct-prior,,,",
    ])
    setAliases({ "Chase Checking": "acct-alias" })

    await handleApplyAccountAliases(ctx)

    const csv = stagingCsv()
    expect(csv).toMatch(/acct-prior/)
    expect(csv).not.toMatch(/acct-alias/)
  })

  it("skips __create__ aliases (no UUID to persist; the merge step creates the account)", async () => {
    setStaging([
      "imp-1,2024-01-01,COFFEE,-450,expense,New Bank,,,,,,,",
    ])
    setAliases({ "New Bank": "__create__" })

    const result = await handleApplyAccountAliases(ctx)

    expect(result).toBe("Applied 0 account aliases.")
    expect(stagingCsv()).toMatch(/New Bank,,,,,,,/)
  })

  it("reports cleanly when no aliases file exists", async () => {
    setStaging([
      "imp-1,2024-01-01,COFFEE,-450,expense,Chase Checking,,,,,,,",
    ])

    const result = await handleApplyAccountAliases(ctx)

    expect(result).toBe("No stored aliases.")
  })
})

// ── dedup: find_duplicates / mark_duplicates / auto_mark_duplicates ──
// By the time dedup runs, the accounts phase has resolved `accountId` (col 10)
// on every staging row, so the engine's account-keyed rules work. Staging rows
// below carry a resolved accountId to exercise that path.

function makeExisting(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: crypto.randomUUID(),
    datetime: "2024-01-01T00:00:00.000",
    type: "expense",
    amount: -450,
    categoryId: "",
    accountId: "acct-1",
    transferPairId: "",
    merchant: "",
    note: "",
    createdAt: "2024-01-01T00:00:00.000",
    ...overrides,
  }
}

describe("handleFindDuplicates", () => {
  it("groups candidates by confidence with the matched original's merchant + categoryId", async () => {
    // imp-1: exact (date+amount+desc+account) → high.
    // imp-2: date ±1, amount, same account, no desc match → low.
    setStaging([
      "imp-1,2024-01-01,WHOLE FOODS,-3000,expense,Chk,,,,acct-1,,,",
      "imp-2,2024-01-05,UNKNOWN,-1200,expense,Chk,,,,acct-1,,,",
    ])
    const repo = makeRepo({
      transactions: [
        makeExisting({
          id: "tx-high",
          amount: -3000,
          note: "WHOLE FOODS",
          merchant: "Whole Foods",
          categoryId: "cat-grocery",
        }),
        makeExisting({
          id: "tx-low",
          datetime: "2024-01-06T00:00:00.000",
          amount: -1200,
          note: "DIFFERENT TEXT",
          merchant: "Costco",
          categoryId: "cat-shopping",
        }),
      ],
    })

    const result = JSON.parse(await handleFindDuplicates({ ...ctx, repo }, repo))

    expect(result.summary).toEqual({ total: 2, high: 1, low: 1 })
    expect(result.high).toHaveLength(1)
    expect(result.high[0]).toMatchObject({
      importId: "imp-1",
      matchedTransactionId: "tx-high",
      matchedMerchant: "Whole Foods",
      matchedCategoryId: "cat-grocery",
    })
    expect(result.low).toHaveLength(1)
    expect(result.low[0]).toMatchObject({
      importId: "imp-2",
      matchedTransactionId: "tx-low",
      matchedMerchant: "Costco",
      matchedCategoryId: "cat-shopping",
    })
  })

  it("returns an empty candidate set when nothing matches", async () => {
    setStaging(["imp-1,2024-01-01,COFFEE,-450,expense,Chk,,,,acct-1,,,"])
    const repo = makeRepo({ transactions: [] })

    const result = JSON.parse(await handleFindDuplicates({ ...ctx, repo }, repo))
    expect(result.summary).toEqual({ total: 0, high: 0, low: 0 })
  })
})

describe("handleMarkDuplicates", () => {
  it("sets the dup flags AND copies merchant/categoryId from the matched original", async () => {
    setStaging(["imp-1,2024-01-01,WHOLE FOODS,-3000,expense,Chk,,,,acct-1,,,"])
    const repo = makeRepo({
      transactions: [
        makeExisting({
          id: "tx-1",
          amount: -3000,
          note: "WHOLE FOODS",
          merchant: "Whole Foods",
          categoryId: "cat-grocery",
        }),
      ],
    })

    const result = await handleMarkDuplicates({ ...ctx, repo }, { ids: ["imp-1"] }, repo)
    expect(result).toContain("Marked 1 row")

    const csv = stagingCsv()
    // duplicate=true, duplicateOf=tx-1, duplicateConfidence=high, and the
    // matched original's merchant + categoryId dup-enriched onto the row.
    expect(csv).toContain("Whole Foods")
    expect(csv).toContain("cat-grocery")
    expect(csv).toContain("tx-1")
    expect(csv).toMatch(/true,tx-1,high/)
  })

  it("skips ids that aren't current duplicate candidates", async () => {
    setStaging(["imp-1,2024-01-01,COFFEE,-450,expense,Chk,,,,acct-1,,,"])
    const repo = makeRepo({ transactions: [] }) // nothing matches

    const result = await handleMarkDuplicates({ ...ctx, repo }, { ids: ["imp-1"] }, repo)
    expect(result).toContain("Marked 0 rows")
    expect(result).toContain("1 id skipped")
    expect(stagingCsv()).not.toMatch(/true,/)
  })

  it("errors on a missing or empty ids array", async () => {
    setStaging(["imp-1,2024-01-01,COFFEE,-450,expense,Chk,,,,acct-1,,,"])
    const repo = makeRepo({ transactions: [] })
    expect(await handleMarkDuplicates({ ...ctx, repo }, {}, repo)).toContain("Error")
    expect(await handleMarkDuplicates({ ...ctx, repo }, { ids: [] }, repo)).toContain("Error")
  })

  it("does not clobber an existing merchant/categoryId already on the staging row", async () => {
    // Row already enriched (merchant=Existing Name, categoryId=cat-keep) inline
    // during normalize; dup-enrich must fill only empties.
    setStaging([
      "imp-1,2024-01-01,WHOLE FOODS,-3000,expense,Chk,,,Existing Name,acct-1,,cat-keep,high",
    ])
    const repo = makeRepo({
      transactions: [
        makeExisting({
          id: "tx-1",
          amount: -3000,
          note: "WHOLE FOODS",
          merchant: "Whole Foods",
          categoryId: "cat-grocery",
        }),
      ],
    })

    await handleMarkDuplicates({ ...ctx, repo }, { ids: ["imp-1"] }, repo)
    const csv = stagingCsv()
    expect(csv).toContain("Existing Name")
    expect(csv).toContain("cat-keep")
    expect(csv).not.toContain("cat-grocery")
  })
})

describe("handleAutoMarkDuplicates", () => {
  it("auto-marks high-confidence matches only, leaving low for the agent", async () => {
    setStaging([
      "imp-1,2024-01-01,WHOLE FOODS,-3000,expense,Chk,,,,acct-1,,,", // exact → high
      "imp-2,2024-01-05,UNKNOWN,-1200,expense,Chk,,,,acct-1,,,", // date±1, amount-only → low
    ])
    const repo = makeRepo({
      transactions: [
        makeExisting({
          id: "tx-high",
          amount: -3000,
          note: "WHOLE FOODS",
          merchant: "Whole Foods",
          categoryId: "cat-grocery",
        }),
        makeExisting({
          id: "tx-low",
          datetime: "2024-01-06T00:00:00.000",
          amount: -1200,
          note: "DIFFERENT TEXT",
        }),
      ],
    })

    const result = await handleAutoMarkDuplicates({ ...ctx, repo }, repo)
    expect(result).toContain("Auto-marked 1 high-confidence duplicate")

    const csv = stagingCsv()
    const lines = csv.trim().split("\n")
    const imp1 = lines.find((l) => l.startsWith("imp-1"))!
    const imp2 = lines.find((l) => l.startsWith("imp-2"))!
    // imp-1 (high) marked + dup-enriched; imp-2 (low) untouched.
    expect(imp1).toMatch(/true,tx-high,high/)
    expect(imp1).toContain("Whole Foods")
    expect(imp2).not.toContain("true")
    expect(imp2).not.toContain("tx-low")
  })
})
