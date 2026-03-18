import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtemp, rm, readFile, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  handleReadImportFile,
  handleWriteImportFile,
  handleAppendImportFile,
  handleListImportFiles,
} from "./import-tools"

let budgetPath: string

beforeEach(async () => {
  budgetPath = await mkdtemp(join(tmpdir(), "capy-import-test-"))
})

afterEach(async () => {
  await rm(budgetPath, { recursive: true, force: true })
})

// ── handleWriteImportFile ─────────────────────────────────────

describe("handleWriteImportFile", () => {
  it("creates a file in the import directory", async () => {
    const result = JSON.parse(
      await handleWriteImportFile(budgetPath, {
        filename: "transactions.csv",
        content: "date,amount\n2026-01-15,50.00\n",
      }),
    )

    expect(result.success).toBe(true)
    expect(result.filename).toBe("transactions.csv")

    const written = await readFile(
      join(budgetPath, ".capy/import/transactions.csv"),
      "utf-8",
    )
    expect(written).toBe("date,amount\n2026-01-15,50.00\n")
  })

  it("overwrites an existing file", async () => {
    await handleWriteImportFile(budgetPath, {
      filename: "data.csv",
      content: "original",
    })

    await handleWriteImportFile(budgetPath, {
      filename: "data.csv",
      content: "overwritten",
    })

    const written = await readFile(
      join(budgetPath, ".capy/import/data.csv"),
      "utf-8",
    )
    expect(written).toBe("overwritten")
  })
})

// ── handleReadImportFile ──────────────────────────────────────

describe("handleReadImportFile", () => {
  it("reads a file from the import directory", async () => {
    await handleWriteImportFile(budgetPath, {
      filename: "notes.txt",
      content: "hello world",
    })

    const content = await handleReadImportFile(budgetPath, {
      filename: "notes.txt",
    })
    expect(content).toBe("hello world")
  })

  it("throws when file does not exist", async () => {
    await expect(
      handleReadImportFile(budgetPath, { filename: "missing.csv" }),
    ).rejects.toThrow()
  })
})

// ── handleAppendImportFile ────────────────────────────────────

describe("handleAppendImportFile", () => {
  it("appends to an existing file", async () => {
    await handleWriteImportFile(budgetPath, {
      filename: "log.csv",
      content: "line1\n",
    })

    const result = JSON.parse(
      await handleAppendImportFile(budgetPath, {
        filename: "log.csv",
        content: "line2\n",
      }),
    )

    expect(result.success).toBe(true)
    expect(result.filename).toBe("log.csv")

    const content = await readFile(
      join(budgetPath, ".capy/import/log.csv"),
      "utf-8",
    )
    expect(content).toBe("line1\nline2\n")
  })

  it("creates the file if it does not exist", async () => {
    await handleAppendImportFile(budgetPath, {
      filename: "new.csv",
      content: "first line\n",
    })

    const content = await readFile(
      join(budgetPath, ".capy/import/new.csv"),
      "utf-8",
    )
    expect(content).toBe("first line\n")
  })
})

// ── handleListImportFiles ─────────────────────────────────────

describe("handleListImportFiles", () => {
  it("lists files in the import directory", async () => {
    await handleWriteImportFile(budgetPath, {
      filename: "a.csv",
      content: "a",
    })
    await handleWriteImportFile(budgetPath, {
      filename: "b.csv",
      content: "b",
    })

    const files: string[] = JSON.parse(await handleListImportFiles(budgetPath))
    expect(files.sort()).toEqual(["a.csv", "b.csv"])
  })

  it("returns empty array when no files exist", async () => {
    const files = JSON.parse(await handleListImportFiles(budgetPath))
    expect(files).toEqual([])
  })
})

// ── Import directory auto-creation ────────────────────────────

describe("import directory auto-creation", () => {
  it("creates .capy/import/ if it does not exist", async () => {
    const importDir = join(budgetPath, ".capy/import")

    // Directory does not exist yet
    await expect(stat(importDir)).rejects.toThrow()

    // Any handler call should create it
    await handleListImportFiles(budgetPath)

    const info = await stat(importDir)
    expect(info.isDirectory()).toBe(true)
  })

  it("succeeds when .capy/import/ already exists", async () => {
    // First call creates the directory
    await handleWriteImportFile(budgetPath, {
      filename: "first.csv",
      content: "data",
    })

    // Second call should not fail
    await handleWriteImportFile(budgetPath, {
      filename: "second.csv",
      content: "more data",
    })

    const files: string[] = JSON.parse(await handleListImportFiles(budgetPath))
    expect(files.sort()).toEqual(["first.csv", "second.csv"])
  })
})
