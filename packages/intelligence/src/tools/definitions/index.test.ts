import { describe, it, expect } from "vitest"
import { getToolDefinitions } from "./index"
import { SYSTEM_PROMPT } from "../../prompts/chat"
import { IMPORT_SYSTEM_PROMPT } from "../../prompts/import"
import { ENRICH_SYSTEM_PROMPT } from "../../prompts/enrich"

const CHAT_TOOLS = [
  "list_accounts",
  "list_transactions",
  "list_categories",
  "search_merchants",
  "create_transaction",
  "update_transaction",
  "delete_transactions",
  "create_account",
  "update_account",
  "delete_account",
  "create_category",
  "update_category",
  "delete_category",
  "bulk_update_transactions",
  "read_import_file",
  "list_import_files",
  "read_file",
  "read_spec",
  "render_table",
  "render_chart",
  "render_followups",
]

const IMPORT_TOOLS = [
  "list_accounts",
  "list_categories",
  "search_merchants",
  "read_import_file",
  "write_import_file",
  "append_import_file",
  "list_import_files",
  "analyze_csv",
  "preview_transform",
  "transform_csv",
  "auto_enrich",
  "enrich_stats",
  "enrich_sample",
  "enrich_update",
  "read_file",
  "read_spec",
]

describe("getToolDefinitions", () => {
  it("returns the full 30-tool surface with no mode (MCP server is ungated)", () => {
    const all = getToolDefinitions()
    expect(all).toHaveLength(30)
  })

  it("gates chat mode to its 21 tools", () => {
    const names = getToolDefinitions("chat").map((t) => t.name)
    expect(new Set(names)).toEqual(new Set(CHAT_TOOLS))
    expect(names).toHaveLength(21)
  })

  it("gates import mode to its 16 tools", () => {
    const names = getToolDefinitions("import").map((t) => t.name)
    expect(new Set(names)).toEqual(new Set(IMPORT_TOOLS))
    expect(names).toHaveLength(16)
  })

  it("keeps chat free of the import/csv/enrich pipeline", () => {
    const names = getToolDefinitions("chat").map((t) => t.name)
    for (const t of [
      "write_import_file",
      "append_import_file",
      "analyze_csv",
      "preview_transform",
      "transform_csv",
      "auto_enrich",
      "enrich_stats",
      "enrich_sample",
      "enrich_update",
    ]) {
      expect(names).not.toContain(t)
    }
  })

  it("keeps import free of render and live-budget mutations", () => {
    const names = getToolDefinitions("import").map((t) => t.name)
    for (const t of [
      "render_table",
      "render_chart",
      "render_followups",
      "create_transaction",
      "update_transaction",
      "delete_transactions",
      "list_transactions",
      "bulk_update_transactions",
    ]) {
      expect(names).not.toContain(t)
    }
  })

  it("returns a fresh array each call", () => {
    expect(getToolDefinitions()).not.toBe(getToolDefinitions())
  })
})

describe("prompt/gating coherence", () => {
  // A tool a prompt names but the mode can't see (advertised-but-gated), or a
  // tool the mode exposes that no prompt mentions (gated-but-unadvertised),
  // is a drift bug. These guard both directions on the tools that carry
  // semantic guidance in the prompts.
  const chatPrompt = SYSTEM_PROMPT
  const importPrompts = `${IMPORT_SYSTEM_PROMPT}\n${ENRICH_SYSTEM_PROMPT}`

  it("every tool the chat prompt names is in the chat surface", () => {
    const chat = new Set(getToolDefinitions("chat").map((t) => t.name))
    for (const name of chat) {
      if (chatPrompt.includes(name)) expect(chat.has(name)).toBe(true)
    }
    // Spot-check the tools the chat prompt explicitly tells the model to use.
    for (const t of ["search_merchants", "list_import_files", "read_import_file", "read_spec"]) {
      expect(chatPrompt).toContain(t)
      expect(chat.has(t)).toBe(true)
    }
  })

  it("every tool the import prompts name is in the import surface", () => {
    const imp = new Set(getToolDefinitions("import").map((t) => t.name))
    for (const t of [
      "analyze_csv",
      "preview_transform",
      "transform_csv",
      "auto_enrich",
      "enrich_stats",
      "enrich_sample",
      "enrich_update",
      "write_import_file",
      "append_import_file",
      "search_merchants",
      "list_categories",
      "list_accounts",
    ]) {
      expect(importPrompts).toContain(t)
      expect(imp.has(t)).toBe(true)
    }
  })

  it("the chat prompt does not advertise an import-only tool", () => {
    for (const t of ["analyze_csv", "transform_csv", "enrich_update", "auto_enrich"]) {
      expect(chatPrompt).not.toContain(t)
    }
  })
})
