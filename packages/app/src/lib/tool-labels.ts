import type { TFunction } from "i18next"
import type { CapyKey } from "@/lib/i18n-keys"

/**
 * Human-readable labels for tool-activity content blocks.
 *
 * Used by `capy-overlay` and `import-screen` to render `tool-activity`
 * blocks in chat history. Provider-agnostic — every adapter emits the
 * same tool names via `getToolDefinitions()`, so the label table
 * applies uniformly. Unknown tools fall back to their raw name.
 */

const TOOL_KEY = {
  list_accounts: "tool.list_accounts",
  list_transactions: "tool.list_transactions",
  list_categories: "tool.list_categories",
  search_transactions: "tool.search_transactions",
  group_transactions: "tool.group_transactions",
  create_transaction: "tool.create_transaction",
  update_transaction: "tool.update_transaction",
  delete_transactions: "tool.delete_transactions",
  create_account: "tool.create_account",
  update_account: "tool.update_account",
  delete_account: "tool.delete_account",
  create_category: "tool.create_category",
  update_category: "tool.update_category",
  delete_category: "tool.delete_category",
  bulk_update_transactions: "tool.bulk_update_transactions",
  start_import: "tool.start_import",
  render_chart: "tool.render_chart",
  // Claude CLI built-in — surfaces when the CLI defers MCP tool schemas.
  ToolSearch: "tool.ToolSearch",
} satisfies Record<string, CapyKey>

function isKnownTool(tool: string): tool is keyof typeof TOOL_KEY {
  return tool in TOOL_KEY
}

export function getToolLabel(tool: string, t: TFunction<"capy">): string {
  return isKnownTool(tool) ? t(TOOL_KEY[tool]) : tool
}
