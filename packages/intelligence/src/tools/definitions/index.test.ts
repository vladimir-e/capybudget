import { describe, it, expect } from "vitest"
import { getToolDefinitions } from "./index"
import { buildSystemPrompt } from "../../prompts/chat"

const ALL_TOOLS = [
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
  it("returns the one tool surface — the MCP server and the chat agent loop share it", () => {
    const names = getToolDefinitions().map((t) => t.name)
    expect(new Set(names)).toEqual(new Set(ALL_TOOLS))
    expect(names).toHaveLength(ALL_TOOLS.length)
  })

  it("returns a fresh array each call", () => {
    expect(getToolDefinitions()).not.toBe(getToolDefinitions())
  })
})

describe("prompt/surface coherence", () => {
  // The dangerous drift is advertised-but-absent: the prompt tells the model to
  // call a tool that isn't in the surface. The prompt cites the tools it drives
  // in backticks (`search_transactions`, `group_transactions`, …); prose
  // mentions of CRUD-as-a-category aren't actionable names. So extract the
  // backticked tokens that match a real tool name and assert each is in the
  // surface — a true cross-check, not a tautology.
  const ALL_TOOL_NAMES = new Set(getToolDefinitions().map((t) => t.name))

  function advertisedTools(prompt: string): string[] {
    const found = new Set<string>()
    for (const m of prompt.matchAll(/`([a-z_]+)`/g)) {
      if (ALL_TOOL_NAMES.has(m[1])) found.add(m[1])
    }
    return [...found]
  }

  it("every tool the chat prompt cites is in the tool surface", () => {
    const advertised = advertisedTools(
      buildSystemPrompt("USD", { decimals: 2, symbolPosition: "before" }),
    )
    expect(advertised.length).toBeGreaterThan(0)
    for (const name of advertised) {
      expect(ALL_TOOL_NAMES, `chat prompt cites \`${name}\` but it isn't in the surface`).toContain(
        name,
      )
    }
  })
})
