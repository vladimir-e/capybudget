/**
 * Single source of truth for tool descriptors that the model sees —
 * data, mutation, import, read_file, read_spec, and render tools all
 * live here. Both the MCP server and the in-process API adapters consume
 * these.
 *
 * One file per domain mirrors `tools/handlers/`; this index re-exports
 * them and owns the merged surface (`getToolDefinitions`, the
 * `ToolDefinition` type, `MUTATION_TOOL_NAMES`).
 */

import { DATA_TOOL_DEFS } from "./data"
import { MUTATION_TOOL_DEFS } from "./mutation"
import { IMPORT_TOOL_DEFS } from "./import"
import { READ_FILE_TOOL_DEF } from "./read-file"
import { READ_SPEC_TOOL_DEF } from "./spec"
import { RENDER_TOOL_DEFS } from "./render"

export { DATA_TOOL_DEFS } from "./data"
export { MUTATION_TOOL_DEFS } from "./mutation"
export { IMPORT_TOOL_DEFS, START_IMPORT_TOOL_NAME } from "./import"
export { READ_FILE_TOOL_DEF } from "./read-file"
export { READ_SPEC_TOOL_DEF } from "./spec"
export { RENDER_TOOL_DEFS } from "./render"

// ── Public surface ───────────────────────────────────────────────

export type ToolDefinition = {
  readonly name: string
  readonly description: string
  readonly inputSchema: {
    readonly type: "object"
    readonly properties: Readonly<Record<string, unknown>>
    readonly required?: ReadonlyArray<string>
  }
}

/**
 * In-process session modes. `chat` is the conversational overlay and owns
 * the agent-loop tool surface. `import` is the structured import session,
 * which calls the model statelessly (no tools, no loop) — it gates to no
 * agent-loop tools, so it carries no entries in {@link TOOL_MODES}.
 */
export type ToolMode = "chat" | "import"

const ALL_TOOL_DEFS: readonly ToolDefinition[] = [
  ...DATA_TOOL_DEFS,
  ...MUTATION_TOOL_DEFS,
  ...IMPORT_TOOL_DEFS,
  READ_FILE_TOOL_DEF,
  READ_SPEC_TOOL_DEF,
  ...RENDER_TOOL_DEFS,
]

/**
 * Which modes may reach for each tool. The source of truth is the mode's
 * system prompt (`prompts/chat.ts`): a tool is listed for a mode iff that
 * prompt tells the model to use it. Keep this map and the prompt coherent
 * — never advertise a tool a mode can't see, never gate one a prompt
 * tells the model to call.
 *
 * The render tools are chat-only; `start_import` is the chat on-ramp into
 * the import pipeline.
 */
const TOOL_MODES: Readonly<Record<string, readonly ToolMode[]>> = {
  // Data
  list_accounts: ["chat"],
  list_transactions: ["chat"],
  search_transactions: ["chat"],
  group_transactions: ["chat"],
  list_categories: ["chat"],
  // Mutation
  create_transaction: ["chat"],
  update_transaction: ["chat"],
  delete_transactions: ["chat"],
  create_account: ["chat"],
  update_account: ["chat"],
  delete_account: ["chat"],
  create_category: ["chat"],
  update_category: ["chat"],
  delete_category: ["chat"],
  bulk_update_transactions: ["chat"],
  // Chat on-ramp into the import pipeline (chat-only — the structured import
  // session is what start_import kicks off, it never calls back into itself)
  start_import: ["chat"],
  // Generic readers
  read_file: ["chat"],
  read_spec: ["chat"],
  // Render
  render_table: ["chat"],
  render_chart: ["chat"],
  render_followups: ["chat"],
}

/**
 * The tool list shipped to the model. With no argument, returns the
 * full surface — what the MCP server exposes to external agents. With a
 * `mode`, returns only that mode's tools (see `TOOL_MODES`), so an
 * in-process chat or import session pays for and sees only what its
 * prompt can use. Returned as a fresh array so callers can safely
 * mutate it.
 */
export function getToolDefinitions(mode?: ToolMode): ToolDefinition[] {
  if (!mode) return [...ALL_TOOL_DEFS]
  return ALL_TOOL_DEFS.filter((t) => TOOL_MODES[t.name]?.includes(mode))
}

/**
 * Names of mutation tools — the app uses this set to decide when to
 * invalidate cached data and refetch from disk.
 *
 * Scope is budget-data mutations only (accounts, categories, transactions,
 * budgets, net-worth exclusions). Import staging lives in `.capy/import/`,
 * which the budget UI doesn't read from, so the import on-ramp never
 * triggers a budget-data refetch.
 */
export const MUTATION_TOOL_NAMES: ReadonlySet<string> = new Set(
  MUTATION_TOOL_DEFS.map((t) => t.name),
)
