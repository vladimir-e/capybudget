/**
 * Single dispatch entrypoint for tool calls. Both the MCP server and the
 * in-process API adapters call `runTool(name, input, ctx)` and get back
 * a string result — which is the same string the model would have seen
 * had the call gone through MCP.
 *
 * Render tools (`render_*`) return "Rendered." here; the frontend
 * intercepts the `tool_use` event before dispatch sees it and renders
 * the corresponding ContentBlock.
 *
 * Tools this dispatch knows about:
 *   - data tools  (list_*, spending_summary, search_merchants)
 *   - mutation tools (create/update/delete/archive/assign_*)
 *   - render tools (render_*)
 *
 * Import + CSV tools (read_import_file, analyze_csv, ...) are NOT
 * routed here for now; they remain in @capybudget/mcp until Phase B
 * because they currently use node fs directly.
 */

import type { BudgetRepository, FileAdapter } from "@capybudget/persistence"
import {
  handleListAccounts,
  handleListTransactions,
  handleListCategories,
  handleSpendingSummary,
  handleSearchMerchants,
} from "./handlers/data"
import {
  handleCreateTransaction,
  handleUpdateTransaction,
  handleDeleteTransactions,
  handleCreateAccount,
  handleUpdateAccount,
  handleDeleteAccount,
  handleArchiveAccount,
  handleCreateCategory,
  handleUpdateCategory,
  handleDeleteCategory,
  handleArchiveCategory,
  handleAssignCategories,
} from "./handlers/mutation"

export interface ToolContext {
  repo: BudgetRepository
  fileAdapter: FileAdapter
  budgetPath: string
}

type ToolHandler = (
  ctx: ToolContext,
  args: Record<string, unknown>,
) => Promise<string>

const HANDLERS: Record<string, ToolHandler> = {
  // Data
  list_accounts: ({ repo }) => handleListAccounts(repo),
  list_transactions: ({ repo }, args) => handleListTransactions(repo, args),
  list_categories: ({ repo }) => handleListCategories(repo),
  spending_summary: ({ repo }, args) => handleSpendingSummary(repo, args),
  search_merchants: ({ repo }, args) => handleSearchMerchants(repo, args),

  // Mutations
  create_transaction: ({ repo }, args) => handleCreateTransaction(repo, args),
  update_transaction: ({ repo }, args) => handleUpdateTransaction(repo, args),
  delete_transactions: ({ repo }, args) => handleDeleteTransactions(repo, args),
  create_account: ({ repo }, args) => handleCreateAccount(repo, args),
  update_account: ({ repo }, args) => handleUpdateAccount(repo, args),
  delete_account: ({ repo }, args) => handleDeleteAccount(repo, args),
  archive_account: ({ repo }, args) => handleArchiveAccount(repo, args),
  create_category: ({ repo }, args) => handleCreateCategory(repo, args),
  update_category: ({ repo }, args) => handleUpdateCategory(repo, args),
  delete_category: ({ repo }, args) => handleDeleteCategory(repo, args),
  archive_category: ({ repo }, args) => handleArchiveCategory(repo, args),
  assign_categories: ({ repo }, args) => handleAssignCategories(repo, args),
}

/**
 * Run a tool by name. Returns the string the model should see as the
 * tool result. Throws if the tool is unknown — callers decide whether
 * to surface that as an MCP error or a stream `error` event.
 */
export async function runTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  // Render tools are no-ops on dispatch — the frontend renders them.
  if (name.startsWith("render_")) return "Rendered."

  const handler = HANDLERS[name]
  if (!handler) {
    throw new Error(`Unknown tool: ${name}`)
  }
  return handler(ctx, input)
}

/** True if dispatch knows this tool name. Useful for transports that
 *  want to fall through to a different handler set (e.g. MCP delegating
 *  import + csv tools to its local node-fs handlers). */
export function isDispatchTool(name: string): boolean {
  return name.startsWith("render_") || name in HANDLERS
}
