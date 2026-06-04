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
 *   - data tools  (list_*, search_merchants)
 *   - mutation tools (create/update/delete + bulk_update_transactions)
 *   - import tools (read/write/append/list_import_file)
 *   - csv tools (analyze_csv, preview_transform, transform_csv,
 *                auto_enrich, enrich_*)
 *   - read_file (generic budget-folder text reader)
 *   - read_spec (bundled spec doc reader)
 *   - render tools (render_*)
 */

import type { BudgetRepository, FileAdapter } from "@capybudget/persistence"
import {
  handleListAccounts,
  handleListTransactions,
  handleListCategories,
  handleSearchMerchants,
} from "./handlers/data"
import {
  handleCreateTransaction,
  handleUpdateTransaction,
  handleDeleteTransactions,
  handleCreateAccount,
  handleUpdateAccount,
  handleDeleteAccount,
  handleCreateCategory,
  handleUpdateCategory,
  handleDeleteCategory,
  handleBulkUpdateTransactions,
} from "./handlers/mutation"
import {
  handleReadImportFile,
  handleWriteImportFile,
  handleAppendImportFile,
  handleListImportFiles,
} from "./handlers/import"
import {
  handleAnalyzeCsv,
  handlePreviewTransform,
  handleTransformCsv,
  handleAutoEnrich,
  handleEnrichStats,
  handleEnrichSample,
  handleEnrichUpdate,
} from "./handlers/csv"
import { handleReadFile } from "./handlers/read-file"
import { handleReadSpec } from "./handlers/spec"

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
  search_merchants: ({ repo }, args) => handleSearchMerchants(repo, args),

  // Mutations
  create_transaction: ({ repo }, args) => handleCreateTransaction(repo, args),
  update_transaction: ({ repo }, args) => handleUpdateTransaction(repo, args),
  delete_transactions: ({ repo }, args) => handleDeleteTransactions(repo, args),
  create_account: ({ repo }, args) => handleCreateAccount(repo, args),
  update_account: ({ repo }, args) => handleUpdateAccount(repo, args),
  delete_account: ({ repo }, args) => handleDeleteAccount(repo, args),
  create_category: ({ repo }, args) => handleCreateCategory(repo, args),
  update_category: ({ repo }, args) => handleUpdateCategory(repo, args),
  delete_category: ({ repo }, args) => handleDeleteCategory(repo, args),
  bulk_update_transactions: ({ repo }, args) => handleBulkUpdateTransactions(repo, args),

  // Import working directory
  read_import_file: (ctx, args) => handleReadImportFile(ctx, args),
  write_import_file: (ctx, args) => handleWriteImportFile(ctx, args),
  append_import_file: (ctx, args) => handleAppendImportFile(ctx, args),
  list_import_files: (ctx) => handleListImportFiles(ctx),

  // CSV transform + enrichment
  analyze_csv: (ctx, args) => handleAnalyzeCsv(ctx, args),
  preview_transform: (ctx, args) => handlePreviewTransform(ctx, args),
  transform_csv: (ctx, args) => handleTransformCsv(ctx, args),
  auto_enrich: (ctx) => handleAutoEnrich(ctx, ctx.repo),
  enrich_stats: (ctx) => handleEnrichStats(ctx),
  enrich_sample: (ctx, args) => handleEnrichSample(ctx, args),
  enrich_update: (ctx, args) => handleEnrichUpdate(ctx, args, ctx.repo),

  // Generic file reader (claude-cli has Read built-in; api adapters
  // get this so the import flow's text-file ingestion works)
  read_file: (ctx, args) => handleReadFile(ctx, args),

  // Spec reader (bundled at build time; scope-locked to specs/*.md)
  read_spec: (_ctx, args) => handleReadSpec(args),
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

/** True if dispatch knows this tool name. */
export function isDispatchTool(name: string): boolean {
  return name.startsWith("render_") || name in HANDLERS
}
