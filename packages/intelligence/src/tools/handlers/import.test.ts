import { describe, it, expect, beforeEach } from "vitest"
import type { BudgetRepository } from "@capybudget/persistence"
import {
  handleReadImportFile,
  handleWriteImportFile,
  handleListImportFiles,
} from "./import"
import { makeFileAdapter, makeMemoryFs, type MemoryFs } from "./test-utils"
import type { ToolContext } from "../dispatch"

const BUDGET_PATH = "/budget"

let fs: MemoryFs
let ctx: ToolContext

beforeEach(() => {
  fs = makeMemoryFs()
  ctx = {
    repo: {} as BudgetRepository,
    fileAdapter: makeFileAdapter(fs),
    budgetPath: BUDGET_PATH,
  }
})

// ── handleWriteImportFile ─────────────────────────────────────

describe("handleWriteImportFile", () => {
  it("creates a file in the import directory", async () => {
    const result = JSON.parse(
      await handleWriteImportFile(ctx, {
        filename: "transactions.csv",
        content: "date,amount\n2026-01-15,50.00\n",
      }),
    )

    expect(result.success).toBe(true)
    expect(result.filename).toBe("transactions.csv")

    const written = fs.files.get(`${BUDGET_PATH}/.capy/import/transactions.csv`)
    expect(written).toBe("date,amount\n2026-01-15,50.00\n")
  })

  it("overwrites an existing file", async () => {
    await handleWriteImportFile(ctx, { filename: "data.csv", content: "original" })
    await handleWriteImportFile(ctx, { filename: "data.csv", content: "overwritten" })

    expect(fs.files.get(`${BUDGET_PATH}/.capy/import/data.csv`)).toBe("overwritten")
  })

  it("defaults to overwrite when mode is omitted", async () => {
    await handleWriteImportFile(ctx, { filename: "data.csv", content: "first" })
    await handleWriteImportFile(ctx, {
      filename: "data.csv",
      content: "second",
      mode: "overwrite",
    })

    expect(fs.files.get(`${BUDGET_PATH}/.capy/import/data.csv`)).toBe("second")
  })

  it("appends with mode 'append', creating the file if absent", async () => {
    await handleWriteImportFile(ctx, {
      filename: "log.csv",
      content: "line1\n",
      mode: "append",
    })
    await handleWriteImportFile(ctx, {
      filename: "log.csv",
      content: "line2\n",
      mode: "append",
    })

    expect(fs.files.get(`${BUDGET_PATH}/.capy/import/log.csv`)).toBe("line1\nline2\n")
  })
})

// ── handleReadImportFile ──────────────────────────────────────

describe("handleReadImportFile", () => {
  it("reads a file from the import directory", async () => {
    await handleWriteImportFile(ctx, { filename: "notes.txt", content: "hello world" })

    expect(await handleReadImportFile(ctx, { filename: "notes.txt" })).toBe("hello world")
  })

  it("throws when file does not exist", async () => {
    await expect(handleReadImportFile(ctx, { filename: "missing.csv" })).rejects.toThrow()
  })
})

// ── handleListImportFiles ─────────────────────────────────────

describe("handleListImportFiles", () => {
  it("lists files in the import directory", async () => {
    await handleWriteImportFile(ctx, { filename: "a.csv", content: "a" })
    await handleWriteImportFile(ctx, { filename: "b.csv", content: "b" })

    const files: string[] = JSON.parse(await handleListImportFiles(ctx))
    expect(files.sort()).toEqual(["a.csv", "b.csv"])
  })

  it("returns empty array when no files exist", async () => {
    expect(JSON.parse(await handleListImportFiles(ctx))).toEqual([])
  })
})

// ── Path traversal protection ─────────────────────────────────

describe("path traversal protection", () => {
  it("rejects ../ in filename for read", async () => {
    await expect(
      handleReadImportFile(ctx, { filename: "../../etc/passwd" }),
    ).rejects.toThrow("Invalid filename")
  })

  it("rejects ../ in filename for write", async () => {
    await expect(
      handleWriteImportFile(ctx, { filename: "../escape.txt", content: "malicious" }),
    ).rejects.toThrow("Invalid filename")
  })

  it("rejects ../ in filename for append mode", async () => {
    await expect(
      handleWriteImportFile(ctx, {
        filename: "subdir/../../escape.txt",
        content: "malicious",
        mode: "append",
      }),
    ).rejects.toThrow("Invalid filename")
  })

  it("rejects absolute paths", async () => {
    await expect(
      handleReadImportFile(ctx, { filename: "/etc/passwd" }),
    ).rejects.toThrow("Invalid filename")
  })

  it("rejects backslash-laden paths", async () => {
    await expect(
      handleWriteImportFile(ctx, { filename: "..\\escape", content: "" }),
    ).rejects.toThrow("Invalid filename")
  })
})

// ── Auto-creation of import directory ─────────────────────────

describe("import directory auto-creation", () => {
  it("creates .capy/import/ if it does not exist", async () => {
    await handleWriteImportFile(ctx, { filename: "first.csv", content: "data" })
    expect(fs.dirs.has(`${BUDGET_PATH}/.capy/import`)).toBe(true)
  })
})
