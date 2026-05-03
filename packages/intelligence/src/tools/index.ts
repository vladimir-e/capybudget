// Definitions
export {
  DATA_TOOL_DEFS,
  MUTATION_TOOL_DEFS,
  RENDER_TOOL_DEFS,
  MUTATION_TOOL_NAMES,
  getToolDefinitions,
} from "./definitions"
export type { ToolDefinition } from "./definitions"

// Dispatch
export { runTool, isDispatchTool } from "./dispatch"
export type { ToolContext } from "./dispatch"

// Handlers (re-exported for transports that want to wire their own
// switch — currently MCP, which still owns import + csv handlers and
// merges those into the same try/catch path).
export {
  handleListAccounts,
  handleListTransactions,
  handleListCategories,
  handleSpendingSummary,
  handleSearchMerchants,
} from "./handlers/data"
export {
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
