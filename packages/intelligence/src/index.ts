// Types
export type {
  FileAttachment,
  CliTextContent,
  CliImageContent,
  CliDocumentContent,
  MessageContent,
  MessageRole,
  TextBlock,
  TableBlock,
  BarChartBlock,
  DonutChartBlock,
  ToolActivityBlock,
  FileAttachmentBlock,
  FollowupChip,
  FollowupsBlock,
  ErrorBlock,
  ContentBlock,
  ChatMessage,
  StreamEvent,
  SessionProvider,
} from "./types"

// Error extraction (shared across API adapters)
export { extractErrorMessage } from "./error-message"

// Session interface
export type { CapySessionOptions, CapySession } from "./session"

// Provider config
export {
  DEFAULT_INTELLIGENCE_CONFIG,
  PROVIDER_LABELS,
} from "./config"
export type {
  IntelligenceConfig,
  IntelligenceProvider,
} from "./config"

// Session factory
export { createIntelligenceSession } from "./factory"
export type {
  CreateSessionDeps,
  AdapterConstructors,
  SessionOptions,
  ClaudeCliAdapterOptions,
  ApiAdapterOptions,
} from "./factory"

// Prompts (chat / import / enrich) + shared budget snapshot
export {
  SYSTEM_PROMPT,
  buildContext,
  IMPORT_SYSTEM_PROMPT,
  ENRICH_SYSTEM_PROMPT,
  APP_KNOWLEDGE,
  buildBudgetSnapshot,
  formatBudgetSnapshot,
} from "./prompts"
export type { BudgetSnapshot } from "./prompts"

// Render-tool → ContentBlock map (shared by every adapter)
export { buildRenderToolMap, RENDER_FOLLOWUPS_TOOL_NAME } from "./render-map"

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
  IMPORT_TOOL_DEFS,
  CSV_TOOL_DEFS,
  READ_FILE_TOOL_DEF,
  READ_SPEC_TOOL_DEF,
  RENDER_TOOL_DEFS,
  MUTATION_TOOL_NAMES,
  getToolDefinitions,
  // Dispatch
  runTool,
  isDispatchTool,
  SESSION_TOOL_CALL_BUDGET,
  // Handlers (re-exported for transports / tests that use them directly)
  handleListAccounts,
  handleListTransactions,
  handleListCategories,
  handleCreateTransaction,
  handleUpdateTransaction,
  handleDeleteTransactions,
  handleCreateAccount,
  handleUpdateAccount,
  handleDeleteAccount,
  handleCreateCategory,
  handleUpdateCategory,
  handleDeleteCategory,
  handleReadImportFile,
  handleWriteImportFile,
  handleAppendImportFile,
  handleListImportFiles,
  handleAnalyzeCsv,
  handlePreviewTransform,
  handleTransformCsv,
  handleAutoEnrich,
  handleEnrichStats,
  handleEnrichSample,
  handleEnrichUpdate,
  handleReadFile,
  handleReadSpec,
} from "./tools"
export type { ToolDefinition, ToolMode, ToolContext } from "./tools"

