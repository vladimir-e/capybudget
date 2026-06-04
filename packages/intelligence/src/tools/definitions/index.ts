/**
 * Single source of truth for tool descriptors that the model sees —
 * data, mutation, import, csv, read_file, read_spec, and render tools
 * all live here. Both the MCP server and the in-process API adapters
 * consume these.
 *
 * One file per domain mirrors `tools/handlers/`; this index re-exports
 * them and owns the merged surface (`getToolDefinitions`, the
 * `ToolDefinition` type, `MUTATION_TOOL_NAMES`).
 */

import { DATA_TOOL_DEFS } from "./data"
import { MUTATION_TOOL_DEFS } from "./mutation"
import { IMPORT_TOOL_DEFS } from "./import"
import { CSV_TOOL_DEFS } from "./csv"
import { READ_FILE_TOOL_DEF } from "./read-file"
import { READ_SPEC_TOOL_DEF } from "./spec"
import { RENDER_TOOL_DEFS } from "./render"

export { DATA_TOOL_DEFS } from "./data"
export { MUTATION_TOOL_DEFS } from "./mutation"
export { IMPORT_TOOL_DEFS } from "./import"
export { CSV_TOOL_DEFS } from "./csv"
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
 * In-process session modes. Each runs one system prompt and sees only
 * the tools that prompt advertises. `chat` is the conversational
 * overlay; `import` covers both Smart Import sessions (normalize and
 * enrich), which share a tool surface.
 */
export type ToolMode = "chat" | "import"

const ALL_TOOL_DEFS: readonly ToolDefinition[] = [
  ...DATA_TOOL_DEFS,
  ...MUTATION_TOOL_DEFS,
  ...IMPORT_TOOL_DEFS,
  ...CSV_TOOL_DEFS,
  READ_FILE_TOOL_DEF,
  READ_SPEC_TOOL_DEF,
  ...RENDER_TOOL_DEFS,
]

/**
 * Which modes may reach for each tool. The source of truth is each
 * mode's system prompt (`prompts/chat.ts`, `prompts/import.ts`,
 * `prompts/enrich.ts`): a tool is listed for a mode iff that prompt
 * tells the model to use it. Keep this map and those prompts coherent —
 * never advertise a tool a mode can't see, never gate one a prompt
 * tells the model to call.
 *
 * Notable cross-mode tools: both modes see `search_transactions` — chat
 * to find a set ("all my Apple charges"), import to look up a cryptic
 * description in budget history and inherit its merchant + category. Chat
 * also gets read-only import visibility (`list_import_files` /
 * `read_import_file`) for staged-import questions; import also gets
 * `list_accounts` / `list_categories` for transfer-target and category
 * UUIDs. The render tools are chat-only; the CSV / enrich / write tools
 * are import-only.
 */
const TOOL_MODES: Readonly<Record<string, readonly ToolMode[]>> = {
  // Data
  list_accounts: ["chat", "import"],
  list_transactions: ["chat"],
  search_transactions: ["chat", "import"],
  group_transactions: ["chat"],
  list_categories: ["chat", "import"],
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
  // Import working directory
  read_import_file: ["chat", "import"],
  write_import_file: ["import"],
  append_import_file: ["import"],
  list_import_files: ["chat", "import"],
  // CSV transform + enrichment
  analyze_csv: ["import"],
  preview_transform: ["import"],
  transform_csv: ["import"],
  auto_enrich: ["import"],
  enrich_stats: ["import"],
  enrich_sample: ["import"],
  enrich_update: ["import"],
  // Generic readers
  read_file: ["chat", "import"],
  read_spec: ["chat", "import"],
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
 * budgets, net-worth exclusions). Import/CSV workspace writes
 * (`write_import_file`, `append_import_file`, `transform_csv`, `auto_enrich`,
 * `enrich_update`, etc.) are intentionally excluded — they touch
 * `.capy/import/`, which the budget UI doesn't read from. Invalidating
 * on those would refetch budget CSVs that haven't changed.
 */
export const MUTATION_TOOL_NAMES: ReadonlySet<string> = new Set(
  MUTATION_TOOL_DEFS.map((t) => t.name),
)
