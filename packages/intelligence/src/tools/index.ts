// Definitions
export {
  DATA_TOOL_DEFS,
  MUTATION_TOOL_DEFS,
  IMPORT_TOOL_DEFS,
  READ_FILE_TOOL_DEF,
  READ_SPEC_TOOL_DEF,
  RENDER_TOOL_DEFS,
  MUTATION_TOOL_NAMES,
  START_IMPORT_TOOL_NAME,
  getToolDefinitions,
} from "./definitions"
export type { ToolDefinition, ToolMode } from "./definitions"

// Dispatch
export { runTool, isDispatchTool } from "./dispatch"
export type { ToolContext } from "./dispatch"

/**
 * Per-session cap on the number of tool calls a single CapySession is
 * allowed to dispatch before it self-terminates with a clear error.
 *
 * A backstop, not the normal path. With idempotent enrich and well-
 * formed prompts, even a large multi-year import converges in tens of
 * calls. 100 leaves comfortable headroom for an extreme outlier while
 * still cutting off a true runaway loop within a few seconds.
 */
export const SESSION_TOOL_CALL_BUDGET = 100

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
