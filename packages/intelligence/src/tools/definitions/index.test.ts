import { describe, it, expect } from "vitest"
import { getToolDefinitions } from "./index"
import { SYSTEM_PROMPT } from "../../prompts/chat"
import { IMPORT_SYSTEM_PROMPT } from "../../prompts/import"
import { ACCOUNTS_INSTRUCTION } from "../../prompts/accounts"
import { DEDUP_INSTRUCTION } from "../../prompts/dedup"
import { ENRICH_SYSTEM_PROMPT } from "../../prompts/enrich"

const CHAT_TOOLS = [
  "list_accounts",
  "list_transactions",
  "search_transactions",
  "group_transactions",
  "list_categories",
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
  "search_transactions",
  "write_import_file",
  "analyze_csv",
  "preview_transform",
  "transform_csv",
  "enrich_status",
  "enrich_update",
  "find_duplicates",
  "mark_duplicates",
  "report_status",
  "read_file",
  "read_spec",
]

describe("getToolDefinitions", () => {
  it("returns the full 34-tool surface with no mode (MCP server is ungated)", () => {
    const all = getToolDefinitions()
    expect(all).toHaveLength(34)
  })

  it("exposes code-triggered tools on the MCP surface but no advertised mode", () => {
    for (const tool of ["auto_enrich", "apply_account_aliases", "auto_mark_duplicates"]) {
      const all = getToolDefinitions().map((t) => t.name)
      expect(all).toContain(tool)
      expect(getToolDefinitions("chat").map((t) => t.name)).not.toContain(tool)
      expect(getToolDefinitions("import").map((t) => t.name)).not.toContain(tool)
    }
  })

  it("gates chat mode to its 22 tools", () => {
    const names = getToolDefinitions("chat").map((t) => t.name)
    expect(new Set(names)).toEqual(new Set(CHAT_TOOLS))
    expect(names).toHaveLength(22)
  })

  it("gates import mode to its 14 tools", () => {
    const names = getToolDefinitions("import").map((t) => t.name)
    expect(new Set(names)).toEqual(new Set(IMPORT_TOOLS))
    expect(names).toHaveLength(14)
  })

  it("keeps chat free of the import/csv/enrich pipeline", () => {
    const names = getToolDefinitions("chat").map((t) => t.name)
    for (const t of [
      "write_import_file",
      "analyze_csv",
      "preview_transform",
      "transform_csv",
      "auto_enrich",
      "enrich_status",
      "enrich_update",
    ]) {
      expect(names).not.toContain(t)
    }
  })

  it("drops staged-file readers from import (chat-only, still on MCP)", () => {
    const importNames = getToolDefinitions("import").map((t) => t.name)
    const chatNames = getToolDefinitions("chat").map((t) => t.name)
    const allNames = getToolDefinitions().map((t) => t.name)
    for (const t of ["read_import_file", "list_import_files"]) {
      expect(importNames).not.toContain(t)
      expect(chatNames).toContain(t)
      expect(allNames).toContain(t)
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
  // The dangerous drift is advertised-but-gated-out: a prompt tells the model
  // to call a tool the mode can't see. The prompts cite the specific tools
  // they drive in backticks (`analyze_csv`, `enrich_update`, …); prose
  // mentions of CRUD-as-a-category aren't actionable names. So extract the
  // backticked tokens that match a real tool name and assert each one is in
  // that mode's gated set — a true cross-check, not a tautology.
  const ALL_TOOL_NAMES = new Set(getToolDefinitions().map((t) => t.name))

  function advertisedTools(prompt: string): string[] {
    const found = new Set<string>()
    for (const m of prompt.matchAll(/`([a-z_]+)`/g)) {
      if (ALL_TOOL_NAMES.has(m[1])) found.add(m[1])
    }
    return [...found]
  }

  it("every tool the chat prompt cites is in the chat surface", () => {
    const chat = new Set(getToolDefinitions("chat").map((t) => t.name))
    const advertised = advertisedTools(SYSTEM_PROMPT)
    expect(advertised.length).toBeGreaterThan(0)
    for (const name of advertised) {
      expect(chat, `chat prompt cites \`${name}\` but it is gated out of chat`).toContain(name)
    }
  })

  it("every tool the import prompts cite is in the import surface", () => {
    const imp = new Set(getToolDefinitions("import").map((t) => t.name))
    const advertised = advertisedTools(
      `${IMPORT_SYSTEM_PROMPT}\n${ACCOUNTS_INSTRUCTION}\n${DEDUP_INSTRUCTION}\n${ENRICH_SYSTEM_PROMPT}`,
    )
    expect(advertised.length).toBeGreaterThan(0)
    for (const name of advertised) {
      expect(imp, `import prompt cites \`${name}\` but it is gated out of import`).toContain(name)
    }
  })

  it("the chat prompt does not cite an import-only tool", () => {
    const chatOnly = advertisedTools(SYSTEM_PROMPT)
    const imp = new Set(getToolDefinitions("import").map((t) => t.name))
    const chat = new Set(getToolDefinitions("chat").map((t) => t.name))
    for (const name of chatOnly) {
      // Anything chat cites must be reachable in chat; if it's also absent
      // from chat's surface it'd be a leak of an import-only tool into chat.
      expect(chat.has(name) || !imp.has(name)).toBe(true)
    }
    for (const t of ["analyze_csv", "transform_csv", "enrich_update", "auto_enrich"]) {
      expect(SYSTEM_PROMPT).not.toContain(`\`${t}\``)
    }
  })
})
