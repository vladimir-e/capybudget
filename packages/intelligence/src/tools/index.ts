// Definitions
export {
  DATA_TOOL_DEFS,
  MUTATION_TOOL_DEFS,
  IMPORT_TOOL_DEFS,
  CSV_TOOL_DEFS,
  READ_FILE_TOOL_DEF,
  RENDER_TOOL_DEFS,
  MUTATION_TOOL_NAMES,
  getToolDefinitions,
} from "./definitions"
export type { ToolDefinition } from "./definitions"

// Dispatch
export { runTool, isDispatchTool } from "./dispatch"
export type { ToolContext } from "./dispatch"

// Handlers (re-exported for transports / tests that want to use them
// directly without going through dispatch).
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
export {
  handleReadImportFile,
  handleWriteImportFile,
  handleAppendImportFile,
  handleListImportFiles,
} from "./handlers/import"
export {
  handleAnalyzeCsv,
  handlePreviewTransform,
  handleTransformCsv,
  handleAutoEnrich,
  handleEnrichStats,
  handleEnrichSample,
  handleEnrichUpdate,
} from "./handlers/csv"
export { handleReadFile } from "./handlers/read-file"
