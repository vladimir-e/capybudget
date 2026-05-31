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
 * The merged tool list shipped to the model: data + mutation + import +
 * csv + read_file + read_spec + render. Returned as a fresh array so
 * callers can safely mutate it.
 *
 * Both chat and import sessions use the same surface. The system prompt
 * (chat vs. import) tells the model which tools are appropriate to
 * reach for — exposing the full set is simpler than switching toolsets
 * per session and matches what MCP-based external agents see.
 */
export function getToolDefinitions(): ToolDefinition[] {
  return [
    ...DATA_TOOL_DEFS,
    ...MUTATION_TOOL_DEFS,
    ...IMPORT_TOOL_DEFS,
    ...CSV_TOOL_DEFS,
    READ_FILE_TOOL_DEF,
    READ_SPEC_TOOL_DEF,
    ...RENDER_TOOL_DEFS,
  ]
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
