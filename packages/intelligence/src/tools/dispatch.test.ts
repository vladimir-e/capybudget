import { describe, it, expect, vi } from "vitest"
import type { Account, BudgetMeta, Category, Transaction } from "@capybudget/core"
import type { BudgetRepository, FileAdapter } from "@capybudget/persistence"
import { runTool, isDispatchTool, type ToolContext } from "./dispatch"
import { handleListAccounts } from "./handlers/data"

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: "acc-1",
    name: "Checking",
    type: "checking",
    archived: false,
    excludeFromNetWorth: false,
    sortOrder: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }
}

function makeMeta(overrides: Partial<BudgetMeta> = {}): BudgetMeta {
  return {
    schemaVersion: 3,
    name: "Test Budget",
    currency: "USD",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastModified: "2026-01-01T00:00:00.000Z",
    basis: "trailing3",
    ...overrides,
  }
}

function makeRepo(data: {
  accounts?: Account[]
  categories?: Category[]
  transactions?: Transaction[]
}): BudgetRepository {
  return {
    getAccounts: vi.fn().mockResolvedValue(data.accounts ?? []),
    getCategories: vi.fn().mockResolvedValue(data.categories ?? []),
    getTransactions: vi.fn().mockResolvedValue(data.transactions ?? []),
    getBudgetMeta: vi.fn().mockResolvedValue(makeMeta()),
    saveAccounts: vi.fn().mockResolvedValue(undefined),
    saveCategories: vi.fn().mockResolvedValue(undefined),
    saveTransactions: vi.fn().mockResolvedValue(undefined),
    saveBudgetMeta: vi.fn().mockResolvedValue(undefined),
  }
}

function makeFileAdapter(): FileAdapter {
  return {
    readFile: vi.fn().mockResolvedValue(""),
    writeFile: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    join: vi.fn().mockImplementation((...parts: string[]) =>
      Promise.resolve(parts.join("/")),
    ),
    mkdir: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(false),
    readDir: vi.fn().mockResolvedValue([]),
    appendFile: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({ size: 0, isFile: false, isDirectory: false }),
  }
}

function makeCtx(repo: BudgetRepository = makeRepo({})): ToolContext {
  return {
    repo,
    fileAdapter: makeFileAdapter(),
    budgetPath: "/budget",
  }
}

describe("isDispatchTool", () => {
  it("recognizes data tools", () => {
    expect(isDispatchTool("list_accounts")).toBe(true)
    expect(isDispatchTool("spending_summary")).toBe(true)
  })

  it("recognizes mutation tools", () => {
    expect(isDispatchTool("create_transaction")).toBe(true)
    expect(isDispatchTool("delete_account")).toBe(true)
    expect(isDispatchTool("set_budget_basis")).toBe(true)
  })

  it("recognizes render tools by prefix", () => {
    expect(isDispatchTool("render_table")).toBe(true)
    expect(isDispatchTool("render_anything")).toBe(true)
  })

  it("recognizes import + csv + read_file tools", () => {
    expect(isDispatchTool("read_import_file")).toBe(true)
    expect(isDispatchTool("analyze_csv")).toBe(true)
    expect(isDispatchTool("read_file")).toBe(true)
  })

  it("recognizes read_spec", () => {
    expect(isDispatchTool("read_spec")).toBe(true)
  })

  it("rejects unknown tools", () => {
    expect(isDispatchTool("nonsense")).toBe(false)
  })
})

describe("runTool", () => {
  it("returns 'Rendered.' for render tools without dispatching", async () => {
    expect(await runTool("render_table", { headers: [], rows: [] }, makeCtx())).toBe(
      "Rendered.",
    )
    expect(
      await runTool("render_donut_chart", { title: "x", data: [] }, makeCtx()),
    ).toBe("Rendered.")
  })

  it("dispatches data tools to their handlers", async () => {
    const repo = makeRepo({
      accounts: [makeAccount({ id: "acc-1", name: "Checking" })],
      transactions: [],
    })
    const ctx = makeCtx(repo)

    const dispatchedResult = await runTool("list_accounts", {}, ctx)
    const directResult = await handleListAccounts(repo)

    // Dispatch returns the same string the direct handler would have.
    expect(JSON.parse(dispatchedResult)).toEqual(JSON.parse(directResult))
  })

  it("passes args to mutation handlers", async () => {
    const repo = makeRepo({
      accounts: [makeAccount({ id: "acc-1" })],
      categories: [],
      transactions: [],
    })

    const result = await runTool(
      "create_transaction",
      {
        type: "expense",
        amount: 1500,
        accountId: "acc-1",
        categoryId: "",
        date: "2026-03-15",
        merchant: "Coffee",
      },
      makeCtx(repo),
    )

    const parsed = JSON.parse(result)
    expect(parsed.success).toBe(true)
    expect(repo.saveTransactions).toHaveBeenCalled()
  })

  it("routes set_budget_basis through to saveBudgetMeta", async () => {
    const repo = makeRepo({})
    const result = await runTool(
      "set_budget_basis",
      { basis: "trailing12" },
      makeCtx(repo),
    )

    const parsed = JSON.parse(result)
    expect(parsed.success).toBe(true)
    expect(parsed.basis).toBe("trailing12")
    const saved = (repo.saveBudgetMeta as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(saved.basis).toBe("trailing12")
  })

  it("throws on unknown tool", async () => {
    await expect(runTool("unknown_tool", {}, makeCtx())).rejects.toThrow(
      "Unknown tool: unknown_tool",
    )
  })

  it("dispatches read_spec from the bundled spec map", async () => {
    const out = await runTool(
      "read_spec",
      { filename: "DATA_MODEL.md" },
      makeCtx(),
    )
    expect(out).toContain("# Data Model")
  })
})
