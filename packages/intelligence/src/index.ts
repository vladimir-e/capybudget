// Types
export type {
  FileAttachment,
  CliTextContent,
  CliImageContent,
  MessageContent,
  MessageRole,
  TextBlock,
  TableBlock,
  BarChartBlock,
  DonutChartBlock,
  ToolActivityBlock,
  FileAttachmentBlock,
  ContentBlock,
  ChatMessage,
  StreamEvent,
  SessionEvent,
} from "./types"

// Session interface
export type { CapySessionOptions, CapySession } from "./session"

// Prompt
export { SYSTEM_PROMPT, buildContext } from "./prompt"

// Attachments
export {
  formatAttachments,
  formatFileSize,
  isImageAttachment,
  MAX_ATTACHMENT_SIZE,
  MAX_TOTAL_ATTACHMENT_SIZE,
} from "./attachments"

// Tool layer — definitions, dispatch, handlers, and metadata
export {
  // Definitions
  DATA_TOOL_DEFS,
  MUTATION_TOOL_DEFS,
  RENDER_TOOL_DEFS,
  MUTATION_TOOL_NAMES,
  getToolDefinitions,
  // Dispatch
  runTool,
  isDispatchTool,
  // Handlers (re-exported for transports that wire their own switch,
  // e.g. the MCP server which still owns import + csv tools)
  handleListAccounts,
  handleListTransactions,
  handleListCategories,
  handleSpendingSummary,
  handleSearchMerchants,
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
} from "./tools"
export type { ToolDefinition, ToolContext } from "./tools"

// Import prompt
export { IMPORT_SYSTEM_PROMPT } from "./import-prompt"

// Enrich prompt
export { ENRICH_SYSTEM_PROMPT } from "./enrich-prompt"
