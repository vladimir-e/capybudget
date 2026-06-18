/**
 * Single dispatch entrypoint for tool calls. Both the MCP server and the
 * in-process API adapters call `runTool(name, input, ctx)` and get back
 * a string result — which is the same string the model would have seen
 * had the call gone through MCP.
 *
 * Render tools (`render_*`) are validated against the render-map
 * builders and return "Rendered."; the frontend intercepts the
 * `tool_use` event before dispatch sees it and renders the
 * corresponding ContentBlock. Invalid render input throws, so the
 * model sees an error tool result and can retry with the right shape.
 *
 * Tools this dispatch knows about:
 *   - data tools  (list_*, search_transactions, group_transactions)
 *   - mutation tools (create/update/delete + bulk_update_transactions)
 *   - start_import (chat on-ramp: stage attachments → kick the orchestrator)
 *   - read_file (generic budget-folder text reader)
 *   - read_spec (bundled spec doc reader)
 *   - render tools (render_*)
 */

import type { BudgetRepository, FileAdapter } from "@capybudget/persistence"
import {
  handleListAccounts,
  handleListTransactions,
  handleSearchTransactions,
  handleGroupTransactions,
  handleListCategories,
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
import { validateRenderInput } from "../render-map"
import { handleReadFile } from "./handlers/read-file"
import { handleReadSpec } from "./handlers/spec"
import { handleStartImport } from "./handlers/start-import"
import type { FileAttachment } from "../types"

export interface ToolContext {
  repo: BudgetRepository
  fileAdapter: FileAdapter
  budgetPath: string
  /**
   * The budget's display currency (ISO 4217, e.g. "EUR"). The code the model
   * reasons with; the symbol comes from it. Tool-result money is formatted in
   * this currency's default convention. Set once per session from
   * `BudgetMeta.currency`.
   */
  currency: string
  /**
   * Attachments on the in-flight chat turn — the bytes `start_import` stages.
   * Threaded by the API adapters from the message that triggered the tool call;
   * absent on the MCP / structured paths, which have no chat turn.
   */
  attachments?: FileAttachment[]
  /**
   * Whether the active provider can run the import pipeline (Anthropic / OpenAI).
   * `start_import` reads this to gate cleanly — false (claude-cli / off / MCP)
   * returns switch-provider guidance instead of staging. Mirrors `canImport`.
   */
  importSupported?: boolean
  /**
   * Whether the active provider can read PDF attachments (Anthropic only).
   * `start_import` reads this to reject a PDF shared in chat under a provider
   * that can't see it (OpenAI swaps PDFs for a placeholder note), mirroring the
   * Import tab's PDF-drop gate. Mirrors `canReadPdf`.
   */
  pdfSupported?: boolean
}

type ToolHandler = (
  ctx: ToolContext,
  args: Record<string, unknown>,
) => Promise<string>

const HANDLERS: Record<string, ToolHandler> = {
  // Data
  list_accounts: ({ repo, currency }) => handleListAccounts(repo, currency),
  list_transactions: ({ repo, currency }, args) =>
    handleListTransactions(repo, currency, args),
  search_transactions: ({ repo }, args) => handleSearchTransactions(repo, args),
  group_transactions: ({ repo }, args) => handleGroupTransactions(repo, args),
  list_categories: ({ repo }) => handleListCategories(repo),

  // Mutations
  create_transaction: ({ repo, currency }, args) =>
    handleCreateTransaction(repo, currency, args),
  update_transaction: ({ repo }, args) => handleUpdateTransaction(repo, args),
  delete_transactions: ({ repo }, args) => handleDeleteTransactions(repo, args),
  create_account: ({ repo }, args) => handleCreateAccount(repo, args),
  update_account: ({ repo }, args) => handleUpdateAccount(repo, args),
  delete_account: ({ repo }, args) => handleDeleteAccount(repo, args),
  create_category: ({ repo }, args) => handleCreateCategory(repo, args),
  update_category: ({ repo }, args) => handleUpdateCategory(repo, args),
  delete_category: ({ repo }, args) => handleDeleteCategory(repo, args),
  bulk_update_transactions: ({ repo }, args) => handleBulkUpdateTransactions(repo, args),

  // Chat on-ramp into the import pipeline (stages the turn's attachments;
  // gated to Anthropic / OpenAI via ctx.importSupported)
  start_import: (ctx) => handleStartImport(ctx),

  // Generic file reader (claude-cli has Read built-in; api adapters get this
  // for generic budget-folder reads)
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
  // Still validate the input: a malformed call must fail loudly for the
  // model to retry, not "succeed" while nothing renders.
  if (name.startsWith("render_")) {
    const invalid = validateRenderInput(name, input)
    if (invalid) throw new Error(invalid)
    return "Rendered."
  }

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
