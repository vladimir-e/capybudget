/**
 * `start_import` — the chat on-ramp. Verified through `runTool` dispatch (the
 * production path the API adapters take) so the wiring is covered alongside the
 * handler: a configured turn stages the attachments + marks the run Capy-staged;
 * the gates (unsupported provider, no attachment, PDF under a provider that
 * can't read PDFs, staging already owned by another import) return guidance and
 * stage nothing. The one replace case — a prior chat staging that never ran —
 * is cleared and restaged.
 */

import { describe, it, expect, beforeEach } from "vitest"
import type { BudgetRepository } from "@capybudget/persistence"
import type { FileAttachment } from "../../types"
import { runTool, type ToolContext } from "../dispatch"
import { makeFileAdapter, makeMemoryFs, type MemoryFs } from "./test-utils"

const BUDGET_PATH = "/budget"
const SOURCES_DIR = `${BUDGET_PATH}/.capy/import/sources`
const STATE_PATH = `${BUDGET_PATH}/.capy/import/state.json`

const noopRepo: BudgetRepository = {
  getAccounts: async () => [],
  getCategories: async () => [],
  getTransactions: async () => [],
  saveAccounts: async () => {},
  saveCategories: async () => {},
  saveTransactions: async () => {},
}

function csv(name: string, content: string): FileAttachment {
  return { name, content, size: content.length, mediaType: "text/csv" }
}

function pdf(name: string, content: string): FileAttachment {
  return { name, content, size: content.length, mediaType: "application/pdf" }
}

let fs: MemoryFs
let ctx: ToolContext

beforeEach(() => {
  fs = makeMemoryFs()
  ctx = {
    repo: noopRepo,
    fileAdapter: makeFileAdapter(fs),
    budgetPath: BUDGET_PATH,
    importSupported: true,
    pdfSupported: true,
    attachments: [],
  }
})

describe("start_import", () => {
  it("stages the turn's attachments and marks the run Capy-staged", async () => {
    ctx.attachments = [
      csv("apple-card.csv", "Date,Amount\n2026-01-01,-4.50"),
      csv("amex.csv", "Date,Amount\n2026-01-02,-9.00"),
    ]

    const result = JSON.parse(await runTool("start_import", {}, ctx))
    expect(result.started).toBe(true)
    expect(result.files).toEqual(["apple-card.csv", "amex.csv"])

    // Sources landed verbatim.
    expect(fs.files.get(`${SOURCES_DIR}/apple-card.csv`)).toBe("Date,Amount\n2026-01-01,-4.50")
    expect(fs.files.get(`${SOURCES_DIR}/amex.csv`)).toBe("Date,Amount\n2026-01-02,-9.00")

    // state.json carries the chat marker the Import screen auto-starts on.
    const state = JSON.parse(fs.files.get(STATE_PATH)!)
    expect(state.phase).toBe("reading")
    expect(state.source).toBe("chat")
  })

  it("replaces a prior chat-staged import that never ran", async () => {
    // A stale chat staging — `state.json` marked "chat", no transactions.csv:
    // the user shared a file earlier and the run never started.
    fs.dirs.add(SOURCES_DIR)
    fs.files.set(`${SOURCES_DIR}/old.csv`, "stale")
    fs.files.set(
      STATE_PATH,
      JSON.stringify({ phase: "reading", source: "chat", updatedAt: "2026-03-01T00:00:00Z" }),
    )

    ctx.attachments = [csv("new.csv", "Date,Amount\n2026-03-01,-5.00")]
    const result = JSON.parse(await runTool("start_import", {}, ctx))
    expect(result.started).toBe(true)

    expect(fs.files.has(`${SOURCES_DIR}/old.csv`)).toBe(false)
    expect(fs.files.get(`${SOURCES_DIR}/new.csv`)).toBe("Date,Amount\n2026-03-01,-5.00")
    expect(JSON.parse(fs.files.get(STATE_PATH)!).source).toBe("chat")
  })

  it("refuses when an import is in progress or parked (transactions.csv exists)", async () => {
    const staged = "id,date,description,amount,type\nimp-1,2025-01-01,Coffee,-450,expense"
    fs.files.set(`${BUDGET_PATH}/.capy/import/transactions.csv`, staged)

    ctx.attachments = [csv("new.csv", "Date,Amount\n2026-03-01,-5.00")]
    const result = JSON.parse(await runTool("start_import", {}, ctx))
    expect(result.started).toBe(false)
    expect(result.reason).toBe("import_in_progress")
    expect(result.message).toMatch(/Import tab/)

    // The existing run's staging is untouched and nothing new was staged.
    expect(fs.files.get(`${BUDGET_PATH}/.capy/import/transactions.csv`)).toBe(staged)
    expect(fs.files.has(`${SOURCES_DIR}/new.csv`)).toBe(false)
  })

  it("refuses when a run is in flight pre-History (state.json without the chat marker)", async () => {
    // The Import screen strips the "chat" marker before auto-starting, so a
    // marker-less state.json with no transactions.csv is a run mid-pipeline.
    fs.dirs.add(SOURCES_DIR)
    fs.files.set(`${SOURCES_DIR}/running.csv`, "Date,Amount\n2026-02-01,-3.00")
    fs.files.set(STATE_PATH, JSON.stringify({ phase: "reading", updatedAt: "2026-03-01T00:00:00Z" }))

    ctx.attachments = [csv("new.csv", "Date,Amount\n2026-03-01,-5.00")]
    const result = JSON.parse(await runTool("start_import", {}, ctx))
    expect(result.started).toBe(false)
    expect(result.reason).toBe("import_in_progress")

    expect(fs.files.get(`${SOURCES_DIR}/running.csv`)).toBe("Date,Amount\n2026-02-01,-3.00")
    expect(fs.files.has(`${SOURCES_DIR}/new.csv`)).toBe(false)
  })

  it("refuses when files are staged in the Import tab but not started", async () => {
    // A manual drop writes only sources/ — no state.json until the user starts.
    fs.dirs.add(SOURCES_DIR)
    fs.files.set(`${SOURCES_DIR}/dropped.csv`, "Date,Amount\n2026-02-01,-3.00")

    ctx.attachments = [csv("new.csv", "Date,Amount\n2026-03-01,-5.00")]
    const result = JSON.parse(await runTool("start_import", {}, ctx))
    expect(result.started).toBe(false)
    expect(result.reason).toBe("files_already_staged")
    expect(result.message).toMatch(/Import tab/)

    expect(fs.files.get(`${SOURCES_DIR}/dropped.csv`)).toBe("Date,Amount\n2026-02-01,-3.00")
    expect(fs.files.has(`${SOURCES_DIR}/new.csv`)).toBe(false)
    expect(fs.files.has(STATE_PATH)).toBe(false)
  })

  it("gates on an import-incapable provider without staging", async () => {
    ctx.importSupported = false
    ctx.attachments = [csv("apple-card.csv", "Date,Amount\n2026-01-01,-4.50")]

    const result = JSON.parse(await runTool("start_import", {}, ctx))
    expect(result.started).toBe(false)
    expect(result.reason).toBe("provider_unsupported")
    expect(result.message).toMatch(/Anthropic or OpenAI/)
    expect(fs.files.has(STATE_PATH)).toBe(false)
  })

  it("gates when the message carried no attachment", async () => {
    ctx.attachments = []

    const result = JSON.parse(await runTool("start_import", {}, ctx))
    expect(result.started).toBe(false)
    expect(result.reason).toBe("no_attachment")
    expect(fs.files.has(STATE_PATH)).toBe(false)
  })

  it("gates a PDF under a provider that can't read PDFs without staging", async () => {
    ctx.pdfSupported = false
    ctx.attachments = [pdf("statement.pdf", "%PDF-1.4 …")]

    const result = JSON.parse(await runTool("start_import", {}, ctx))
    expect(result.started).toBe(false)
    expect(result.reason).toBe("pdf_unsupported")
    expect(result.message).toMatch(/Anthropic/)
    expect(fs.files.has(STATE_PATH)).toBe(false)
  })

  it("stages a PDF when the provider can read PDFs", async () => {
    ctx.pdfSupported = true
    ctx.attachments = [pdf("statement.pdf", "%PDF-1.4 …")]

    const result = JSON.parse(await runTool("start_import", {}, ctx))
    expect(result.started).toBe(true)
    expect(result.files).toEqual(["statement.pdf"])
    expect(fs.files.get(`${SOURCES_DIR}/statement.pdf`)).toBe("%PDF-1.4 …")
  })
})
