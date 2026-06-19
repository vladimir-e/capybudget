import type { TFunction } from "i18next"

/**
 * Human-readable labels for tool-activity content blocks.
 *
 * Used by `capy-overlay` and `import-screen` to render `tool-activity`
 * blocks in chat history. Provider-agnostic — every adapter emits the
 * same tool names via `getToolDefinitions()`, so the label table
 * applies uniformly. Unknown tools fall back to their raw name.
 */

const KNOWN_TOOLS = [
  "list_accounts",
  "list_transactions",
  "list_categories",
  "search_transactions",
  "group_transactions",
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
  "render_chart",
  // Claude CLI built-in — surfaces when the CLI defers MCP tool schemas.
  "ToolSearch",
] as const

type KnownTool = (typeof KNOWN_TOOLS)[number]

const KNOWN_TOOL_SET = new Set<string>(KNOWN_TOOLS)

function isKnownTool(tool: string): tool is KnownTool {
  return KNOWN_TOOL_SET.has(tool)
}

export function getToolLabel(tool: string, t: TFunction<"capy">): string {
  return isKnownTool(tool) ? t(`tool.${tool}`) : tool
}
