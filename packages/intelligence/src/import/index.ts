/**
 * The import intelligence layer — the orchestrator state machine, its injected
 * seams, the status-event contract, and the stateless model-call functions.
 *
 * `core/import/` owns the deterministic domain (grounding, dedup, buildStaged);
 * this layer drives it as a pipeline and calls the model at the two stateless
 * points. `app/` (Unit 3) consumes the event stream and supplies the concrete
 * staging store + budget-data provider.
 */

// Orchestrator + driver API
export { ImportOrchestrator, PIPELINE_PHASES } from "./orchestrator";
export type { OrchestratorDeps } from "./orchestrator";

// Status-event contract
export type {
  ImportEvent,
  ImportEventHandler,
  ImportPhase,
  TerminalLogEntry,
  ImportErrorReason,
  LogLevel,
  BatchProgress,
  NormalizeProgress,
  GroundingEventStats,
} from "./events";

// Injected seams
export type { StagingStore, SourceFile, ImportState, StagedTransactions } from "./staging-store";
export { FileStagingStore, parseImportCsv } from "./staging-store";
export type { BudgetDataProvider } from "./budget-data";

// Stateless model calls + batching
export { normalizeCsv, normalizeImage, isImageOrPdf } from "./normalize";
export type { NormalizeCsvResult, NormalizeImageResult } from "./normalize";
export {
  enrichBatch,
  enrichTransfers,
  batchRows,
  needsEnrich,
  needsTransferEnrich,
  ENRICH_BATCH_SIZE,
  ENRICH_CONCURRENCY,
} from "./categorize";

// Structured-call schemas + result types
export {
  CSV_MAPPING_SCHEMA,
  EXTRACTION_SCHEMA,
  ENRICH_BATCH_SCHEMA,
  ENRICH_TRANSFER_SCHEMA,
} from "./schemas";
export type {
  CsvMappingResult,
  ExtractionResult,
  EnrichBatchResult,
  EnrichedRow,
  TransferEnrichResult,
  TransferEnriched,
} from "./schemas";

// Structured session factory + capability gate
export { createStructuredImportSession, canImport, canReadPdf, importReady } from "./session-factory";
export type { StructuredImportSessionDeps } from "./session-factory";
export { IMPORT_STRUCTURED_SYSTEM_PROMPT, buildImportSystemPrompt } from "./system-prompt";
