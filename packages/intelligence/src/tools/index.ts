// Definitions
export {
  DATA_TOOL_DEFS,
  MUTATION_TOOL_DEFS,
  importToolDefs,
  READ_FILE_TOOL_DEF,
  READ_SPEC_TOOL_DEF,
  RENDER_TOOL_DEFS,
  MUTATION_TOOL_NAMES,
  START_IMPORT_TOOL_NAME,
  getToolDefinitions,
} from "./definitions"
export type { ToolDefinition } from "./definitions"

// Dispatch
export { runTool, isDispatchTool } from "./dispatch"
export type { ToolContext } from "./dispatch"

/**
 * Cap on the tool calls one reply may dispatch — a runaway-loop backstop,
 * reset on every send. A well-formed answer converges in a handful of calls.
 */
export const REPLY_TOOL_CALL_BUDGET = 100

// Handlers (re-exported for transports / tests that want to use them
// directly without going through dispatch).
export {
  handleListAccounts,
  handleListTransactions,
  handleSearchTransactions,
  handleGroupTransactions,
  handleListCategories,
} from "./handlers/data"
export {
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
export { handleReadFile } from "./handlers/read-file"
export { handleReadSpec } from "./handlers/spec"
