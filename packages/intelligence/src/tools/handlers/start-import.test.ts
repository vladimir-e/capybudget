/**
 * `start_import` — the chat on-ramp. Verified through `runTool` dispatch (the
 * production path the API adapters take) so the wiring is covered alongside the
 * handler: a configured turn stages the attachments + marks the run Capy-staged;
 * the three gates (unsupported provider, no attachment, PDF under a provider that
 * can't read PDFs) return guidance and stage nothing.
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

  it("clears a prior run's staging before staging the new sources", async () => {
    // A stale run sitting in staging — transactions + an old source file.
    fs.files.set(`${BUDGET_PATH}/.capy/import/transactions.csv`, "id,date\nimp-1,2025-01-01")
    fs.dirs.add(SOURCES_DIR)
    fs.files.set(`${SOURCES_DIR}/old.csv`, "stale")

    ctx.attachments = [csv("new.csv", "Date,Amount\n2026-03-01,-5.00")]
    const result = JSON.parse(await runTool("start_import", {}, ctx))
    expect(result.started).toBe(true)

    expect(fs.files.has(`${BUDGET_PATH}/.capy/import/transactions.csv`)).toBe(false)
    expect(fs.files.has(`${SOURCES_DIR}/old.csv`)).toBe(false)
    expect(fs.files.get(`${SOURCES_DIR}/new.csv`)).toBe("Date,Amount\n2026-03-01,-5.00")
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
