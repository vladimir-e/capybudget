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

const ALL_TOOL_DEFS: readonly ToolDefinition[] = [
  ...DATA_TOOL_DEFS,
  ...MUTATION_TOOL_DEFS,
  ...IMPORT_TOOL_DEFS,
  READ_FILE_TOOL_DEF,
  READ_SPEC_TOOL_DEF,
  ...RENDER_TOOL_DEFS,
]

/**
 * The full tool surface — what the MCP server exposes to external agents and
 * what the in-process chat agent loop sees. There is one surface: the
 * structured import session calls the model statelessly (no tools), so it
 * doesn't draw from here. Returned as a fresh array so callers can safely
 * mutate it.
 */
export function getToolDefinitions(): ToolDefinition[] {
  return [...ALL_TOOL_DEFS]
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
