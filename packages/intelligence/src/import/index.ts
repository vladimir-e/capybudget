/**
 * The import intelligence layer — the orchestrator state machine, its injected
 * seams, the status-event contract, and the stateless model-call functions.
 *
 * `core/import/` owns the deterministic domain (grounding, dedup, buildStaged);
 * this layer drives it as a pipeline and calls the model at the two stateless
 * points. The app consumes the event stream and supplies the concrete staging
 * store + budget-data provider.
 */

export { ImportOrchestrator } from "./orchestrator";

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
} from "./events";

export type { StagingStore } from "./staging-store";
export { FileStagingStore } from "./staging-store";
export type { BudgetDataProvider } from "./budget-data";

export { needsEnrich, needsTransferEnrich } from "./categorize";

export { createStructuredImportSession, canImport, canReadPdf, importReady, ollamaReadsImages } from "./session-factory";
export { buildImportSystemPrompt } from "./system-prompt";
