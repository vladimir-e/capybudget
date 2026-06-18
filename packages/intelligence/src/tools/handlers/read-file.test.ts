import { describe, it, expect, beforeEach } from "vitest"
import type { BudgetRepository } from "@capybudget/persistence"
import { handleReadFile } from "./read-file"
import { makeFileAdapter, makeMemoryFs, type MemoryFs } from "./test-utils"
import type { ToolContext } from "../dispatch"

const BUDGET_PATH = "/budget"

let fs: MemoryFs
let ctx: ToolContext

beforeEach(() => {
  fs = makeMemoryFs()
  fs.dirs.add(BUDGET_PATH)
  fs.dirs.add(`${BUDGET_PATH}/.capy/import/sources`)
  ctx = {
    repo: {} as BudgetRepository,
    fileAdapter: makeFileAdapter(fs),
    budgetPath: BUDGET_PATH,
    currency: "USD",
    format: { decimals: 2, symbolPosition: "before" },
  }
})

describe("handleReadFile", () => {
  it("reads a file from the import sources directory by bare name", async () => {
    fs.files.set(`${BUDGET_PATH}/.capy/import/sources/2024.csv`, "header,row\n1,2\n")

    expect(await handleReadFile(ctx, { filename: "2024.csv" })).toBe("header,row\n1,2\n")
  })

  it("reads a file from the budget folder by relative path", async () => {
    fs.files.set(`${BUDGET_PATH}/accounts.csv`, "id,name\n")

    expect(await handleReadFile(ctx, { filename: "accounts.csv" })).toBe("id,name\n")
  })

  it("rejects absolute paths", async () => {
    await expect(
      handleReadFile(ctx, { filename: "/etc/passwd" }),
    ).rejects.toThrow("Invalid filename")
  })

  it("rejects ../ traversal", async () => {
    await expect(
      handleReadFile(ctx, { filename: "../../etc/passwd" }),
    ).rejects.toThrow("Invalid filename")
  })

  it("rejects Windows-style absolute paths", async () => {
    await expect(
      handleReadFile(ctx, { filename: "C:\\Windows\\system.ini" }),
    ).rejects.toThrow("Invalid filename")
  })

  it("throws when the file is nowhere", async () => {
    await expect(
      handleReadFile(ctx, { filename: "missing.csv" }),
    ).rejects.toThrow("File not found")
  })
})
