import { describe, it, expect } from "vitest"
import { getToolDefinitions } from "./index"
import { SYSTEM_PROMPT } from "../../prompts/chat"

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
  "start_import",
  "read_file",
  "read_spec",
  "render_table",
  "render_chart",
  "render_followups",
]

describe("getToolDefinitions", () => {
  it("returns the full tool surface with no mode (MCP server is ungated)", () => {
    const all = getToolDefinitions()
    expect(new Set(all.map((t) => t.name))).toEqual(new Set(CHAT_TOOLS))
  })

  it("gates chat mode to its full surface", () => {
    const names = getToolDefinitions("chat").map((t) => t.name)
    expect(new Set(names)).toEqual(new Set(CHAT_TOOLS))
    expect(names).toHaveLength(CHAT_TOOLS.length)
  })

  it("returns a fresh array each call", () => {
    expect(getToolDefinitions()).not.toBe(getToolDefinitions())
  })
})

describe("prompt/gating coherence", () => {
  // The dangerous drift is advertised-but-gated-out: the prompt tells the model
  // to call a tool the mode can't see. The prompt cites the tools it drives in
  // backticks (`search_transactions`, `group_transactions`, …); prose mentions
  // of CRUD-as-a-category aren't actionable names. So extract the backticked
  // tokens that match a real tool name and assert each is in the chat surface —
  // a true cross-check, not a tautology.
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
})
