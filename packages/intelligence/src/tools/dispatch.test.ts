import { describe, it, expect, vi } from "vitest"
import type { Account, Category, Transaction } from "@capybudget/core"
import { makeAccount } from "@capybudget/core/test-factories"
import type { BudgetRepository, FileAdapter } from "@capybudget/persistence"
import { runTool, isDispatchTool, type ToolContext } from "./dispatch"
import { handleListAccounts } from "./handlers/data"

function makeRepo(data: {
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
    currency: "USD",
  }
}

describe("isDispatchTool", () => {
  it("recognizes data tools", () => {
    expect(isDispatchTool("list_accounts")).toBe(true)
    expect(isDispatchTool("search_transactions")).toBe(true)
  })

  it("recognizes mutation tools", () => {
    expect(isDispatchTool("create_transaction")).toBe(true)
    expect(isDispatchTool("delete_account")).toBe(true)
  })

  it("recognizes render tools by prefix", () => {
    expect(isDispatchTool("render_table")).toBe(true)
    expect(isDispatchTool("render_anything")).toBe(true)
  })

  it("recognizes the import on-ramp + read_file tools", () => {
    expect(isDispatchTool("start_import")).toBe(true)
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
  it("returns 'Rendered.' for valid render input without dispatching", async () => {
    expect(
      await runTool("render_table", { headers: ["A"], rows: [["1"]] }, makeCtx()),
    ).toBe("Rendered.")
    expect(
      await runTool(
        "render_chart",
        { title: "x", type: "donut", data: [{ label: "a", value: 1 }] },
        makeCtx(),
      ),
    ).toBe("Rendered.")
    expect(
      await runTool(
        "render_followups",
        { chips: [{ label: "More", prompt: "Tell me more" }] },
        makeCtx(),
      ),
    ).toBe("Rendered.")
  })

  it("rejects empty-data render_table with an error naming the expected shape", async () => {
    await expect(
      runTool("render_table", { headers: [], rows: [] }, makeCtx()),
    ).rejects.toThrow("render_table expects {headers: [...], rows: [[...], ...]}")
  })

  it("rejects empty-data render_chart", async () => {
    await expect(
      runTool("render_chart", { title: "x", type: "donut", data: [] }, makeCtx()),
    ).rejects.toThrow("render_chart expects")
  })

  it("rejects malformed render_followups input (invented payload)", async () => {
    await expect(
      runTool(
        "render_followups",
        { followups: '[{"label":"a","prompt":"b"}]' },
        makeCtx(),
      ),
    ).rejects.toThrow("render_followups expects {chips: [{label, prompt}, ...]}")
  })

  it("dispatches data tools to their handlers", async () => {
    const repo = makeRepo({
      accounts: [makeAccount({ id: "acc-1", name: "Checking" })],
      transactions: [],
    })
    const ctx = makeCtx(repo)

    const dispatchedResult = await runTool("list_accounts", {}, ctx)
    const directResult = await handleListAccounts(repo, ctx.currency)

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
