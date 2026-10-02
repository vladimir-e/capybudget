// The package's public surface: only what the app, MCP server, demo, and
// scripts import. Everything else is reached by relative path inside the package.

// Types
export type {
  FileAttachment,
  MessageContent,
  TableBlock,
  BarChartBlock,
  DonutChartBlock,
  ToolActivityBlock,
  ToolCallStatus,
  FollowupChip,
  ErrorBlock,
  ContentBlock,
  ChatMessage,
  StreamEvent,
  SessionProvider,
} from "./types"

// Error extraction
export { extractErrorMessage } from "./error-message"
export type { DeadEndKind } from "./error-message"

// Session interface
export type { CapySession } from "./session"

// Provider config
export {
  DEFAULT_INTELLIGENCE_CONFIG,
  DEFAULT_OLLAMA_BASE_URL,
  PROVIDER_LABELS,
  hasProviderKey,
  ollamaOrigin,
} from "./config"
export type {
  HostedProvider,
  IntelligenceConfig,
  IntelligenceProvider,
  ProviderCredentials,
} from "./config"

// Model choices
export { FALLBACK_MODELS } from "./models"
export type { ModelOption } from "./models"

// Session factory
export { createIntelligenceSession } from "./factory"
export type { AdapterConstructors, SessionOptions, ClaudeCliAdapterOptions } from "./factory"

// Chat prompt + shared budget snapshot
export { buildSystemPrompt, buildContext, buildBudgetSnapshot } from "./prompts"
export type { BudgetSnapshot } from "./prompts"

// Attachments
export {
  formatAttachments,
  formatFileSize,
  isImageAttachment,
  isPdfAttachment,
  MAX_ATTACHMENT_SIZE,
  MAX_IMPORT_PDF_SIZE,
  MAX_TOTAL_ATTACHMENT_SIZE,
} from "./attachments"

// Source-file classification
export {
  fileExtension,
  isImageFilename,
  isSupportedImageType,
  isPdfFilename,
  isOfxFilename,
  effectiveMediaType,
  sourceContentBlock,
} from "./source-files"

// Tool layer
export { MUTATION_TOOL_NAMES, START_IMPORT_TOOL_NAME, getToolDefinitions, runTool } from "./tools"
export type { ToolContext } from "./tools"

// Import orchestrator
export {
  ImportOrchestrator,
  FileStagingStore,
  needsEnrich,
  needsTransferEnrich,
  createStructuredImportSession,
  canImport,
  canReadPdf,
  importReady,
  ollamaReadsImages,
  buildImportSystemPrompt,
} from "./import"
export type {
  ImportEvent,
  ImportPhase,
  TerminalLogEntry,
  ImportNotice,
  ImportStatus,
  ImportFailure,
  BatchFailureCause,
  FileFailureCause,
  Sample,
  BatchProgress,
  NormalizeProgress,
  StagingStore,
  BudgetDataProvider,
} from "./import"
