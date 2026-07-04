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

// Structured-output primitive (stateless, schema-validated single call)
export { parseStructured, SchemaValidationError } from "./structured"
export type {
  JsonSchema,
  StructuredCallOptions,
  StructuredMessage,
  StructuredSession,
} from "./structured"

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

// Chat prompt + shared budget snapshot
export {
  buildSystemPrompt,
  buildContext,
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
  isPdfAttachment,
  MAX_ATTACHMENT_SIZE,
  MAX_TOTAL_ATTACHMENT_SIZE,
} from "./attachments"

// Source-file classification — one owner for media-type inference, the
// normalization path a source takes, and the model content block it becomes.
export {
  OFX_MEDIA_TYPE,
  fileExtension,
  isImageFilename,
  isPdfFilename,
  isOfxFilename,
  mediaTypeForFilename,
  classifySource,
  classifyFile,
  sourceContentBlock,
} from "./source-files"
export type { SourceKind } from "./source-files"

// Tool layer — definitions, dispatch, handlers, and metadata
export {
  // Definitions
  DATA_TOOL_DEFS,
  MUTATION_TOOL_DEFS,
  IMPORT_TOOL_DEFS,
  READ_FILE_TOOL_DEF,
  READ_SPEC_TOOL_DEF,
  RENDER_TOOL_DEFS,
  MUTATION_TOOL_NAMES,
  START_IMPORT_TOOL_NAME,
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
  handleReadFile,
  handleReadSpec,
} from "./tools"
export type { ToolDefinition, ToolContext } from "./tools"

// Import orchestrator — state machine, event stream, injected seams, schemas
export {
  ImportOrchestrator,
  PIPELINE_PHASES,
  FileStagingStore,
  parseImportCsv,
  normalizeCsv,
  normalizeImage,
  normalizeOfx,
  enrichBatch,
  enrichTransfers,
  batchRows,
  needsEnrich,
  needsTransferEnrich,
  ENRICH_BATCH_SIZE,
  ENRICH_CONCURRENCY,
  CSV_MAPPING_SCHEMA,
  EXTRACTION_SCHEMA,
  ENRICH_BATCH_SCHEMA,
  ENRICH_TRANSFER_SCHEMA,
  createStructuredImportSession,
  canImport,
  canReadPdf,
  importReady,
  IMPORT_STRUCTURED_SYSTEM_PROMPT,
  buildImportSystemPrompt,
} from "./import"
export type {
  OrchestratorDeps,
  ImportEvent,
  ImportEventHandler,
  ImportPhase,
  TerminalLogEntry,
  ImportErrorReason,
  LogLevel,
  BatchProgress,
  NormalizeProgress,
  GroundingEventStats,
  StagingStore,
  SourceFile,
  ImportState,
  StagedTransactions,
  BudgetDataProvider,
  NormalizeCsvResult,
  NormalizeImageResult,
  NormalizeOfxResult,
  CsvMappingResult,
  ExtractionResult,
  EnrichBatchResult,
  EnrichedRow,
  TransferEnrichResult,
  TransferEnriched,
  StructuredImportSessionDeps,
} from "./import"

