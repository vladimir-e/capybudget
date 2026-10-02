/**
 * The import orchestrator's status-event contract.
 *
 * The orchestrator is headless: it never narrates in prose and never touches
 * React. It drives the pipeline as a deterministic state machine and emits
 * these events so any consumer (the app's progress UI, a test harness, a CLI)
 * can render where the run is. Code always knows the phase, so the surface is
 * state, not a transcript. User-facing lines travel as `ImportNotice` codes;
 * the consumer owns the wording and the language.
 */

import type { DeadEndKind } from "../error-message";
import type { SessionProvider } from "../types";

/** The four code-driven phases, in order. `idle` is the pre-start resting state;
 *  `done` and `error` are terminal. */
export type ImportPhase =
  | "idle"
  | "reading"
  | "normalizing"
  | "history"
  | "categorizing"
  | "done"
  | "error";

/** The user-running phases, in pipeline order — drives the section bar. */
export const PIPELINE_PHASES: readonly ImportPhase[] = [
  "reading",
  "normalizing",
  "history",
  "categorizing",
] as const;

/** Severity of a terminal-log line. */
export type LogLevel = "info" | "warn" | "error";

/** Why a model call failed. `unusable` and `other` carry the underlying
 *  message: `other` is the provider's own words, shown to the user; an
 *  `unusable` detail is for the log only. */
export type ModelFailureCause =
  | { kind: "cutOff" | "refused" }
  | { kind: "unusable" | "other"; detail: string };

/** Why a Categorizing batch failed. */
export type BatchFailureCause = ModelFailureCause;

/** Why a source file couldn't be read: a model failure, or one of the two
 *  capability gaps only a file can hit. */
export type FileFailureCause = ModelFailureCause | { kind: "pdfUnsupported" | "noVision" };

/** The first few items of a list, and how many more were left out. */
export interface Sample {
  items: string[];
  more: number;
}

const SAMPLE_SIZE = 3;

/** Cap a list for a log line, so a wholly broken file logs a line, not a wall. */
export function sample(notes: readonly string[]): Sample;
export function sample<T>(notes: readonly T[], map: (note: T) => string): Sample;
export function sample<T>(notes: readonly T[], map: (note: T) => string = String): Sample {
  const items = notes.slice(0, SAMPLE_SIZE).map(map);
  return { items, more: notes.length - items.length };
}

/** The current-status line. */
export type ImportStatus =
  | { code: "normalize.extracting"; params: { file: string } }
  | { code: "normalize.readingOfx"; params: { file: string } }
  | { code: "normalize.mappingColumns"; params: { file: string } }
  | { code: "history.matching" }
  | { code: "categorize.progress"; params: { done: number; total: number } };

/** Data-quality warnings a normalizer raises about a file it did read. */
export type NormalizeWarning =
  | { code: "normalize.skipRules"; params: { file: string; sample: Sample; held: number } }
  | { code: "normalize.countMismatch"; params: { file: string; counted: number; returned: number } }
  | { code: "normalize.wholeUnits"; params: { file: string } }
  | { code: "normalize.droppedCents"; params: { file: string } };

/** A run-ending failure. `deadEnd` is a provider that fails every call the
 *  same way; `failed` is any other fault, with its raw message. */
export type ImportFailure =
  | { code: "read.noSources" }
  | { code: "enrich.noStaging" }
  | { code: "normalize.fileFailed"; params: { file: string; cause: FileFailureCause } }
  | { code: "categorize.noneLanded"; params: { count: number; cause: BatchFailureCause | null } }
  | { code: "deadEnd"; params: { kind: DeadEndKind; provider: SessionProvider } }
  | { code: "failed"; params: { detail: string } };

/** A terminal-log line. A failure is logged as well as emitted. */
export type ImportLogNotice =
  | NormalizeWarning
  | ImportFailure
  | { code: "reading.files"; params: { files: string[] } }
  | { code: "normalize.visionUnknown" }
  | { code: "normalize.noData"; params: { file: string; detail?: string } }
  | { code: "normalize.fileSkipped"; params: { file: string; cause: FileFailureCause } }
  | { code: "normalize.rowsUnparsed"; params: { file: string; sample: Sample } }
  | { code: "normalize.done"; params: { count: number } }
  | { code: "history.payoff"; params: GroundingEventStats }
  | { code: "categorize.resuming"; params: { count: number } }
  | { code: "categorize.droppedRows"; params: { sample: Sample } }
  | { code: "categorize.nothingToDo" }
  | { code: "categorize.transfers"; params: { count: number } }
  | { code: "categorize.batchFailed"; params: { batch: number; count: number; cause: BatchFailureCause } }
  | { code: "categorize.transferBatchFailed"; params: { count: number; cause: BatchFailureCause } }
  | { code: "categorize.stopped" }
  | { code: "stopped" };

/** Everything the orchestrator says to the user: a typed code plus the params
 *  the app's catalog interpolates. No prose crosses this boundary. */
export type ImportNotice = ImportStatus | ImportLogNotice;

/**
 * A timestamped terminal-log line. `phase` ties the line to a section so the
 * UI can group; `ts` is epoch millis for stable ordering.
 */
export interface TerminalLogEntry {
  ts: number;
  level: LogLevel;
  phase: ImportPhase;
  notice: ImportLogNotice;
}

/** Categorizing progress over the remaining incomplete rows. `total` is the
 *  count of rows that needed enrichment at batch-dispatch time; `done` is how
 *  many have landed (persisted). Drives "Categorizing 12 of 30". */
export interface BatchProgress {
  done: number;
  total: number;
}

/** Live row counter for the Normalizing phase. `rows` counts transactions
 *  materialized so far across all source files — streamed records for an
 *  image/PDF extraction, transformed rows for a CSV. `total` is the expected
 *  count over the files discovered so far (CSV data-row counts, the
 *  model-declared extraction count), or null while the active file's size is
 *  still unknown. It grows as later files report in, so a consumer's meter
 *  recalibrates rather than assuming a fixed denominator. */
export interface NormalizeProgress {
  rows: number;
  total: number | null;
}

/**
 * Every event the orchestrator emits. A discriminated union on `type`:
 *
 *  - `phase`         — entered a new phase (the section bar advances).
 *  - `status`        — the single current-status line (replaces the prior one).
 *  - `log`           — append a timestamped terminal-log entry.
 *  - `grounding`     — the History payoff stats, once History completes.
 *  - `normalize-progress` — Normalizing row counter tick (streamed extraction
 *                      rows, CSV row counts as files parse).
 *  - `batch-progress`— Categorizing meter tick over the remaining rows.
 *  - `rows-changed`  — staging rows were written; the preview should re-read.
 *                      Carries no data — the consumer pulls fresh from staging.
 *  - `error`         — a run-level failure (e.g. no source files). `recoverable`
 *                      distinguishes "back to file-attach" from a hard stop.
 *  - `done`          — the run finished (all batches dispatched + landed, or
 *                      stopped cleanly with the in-flight batch persisted).
 */
export type ImportEvent =
  | { type: "phase"; phase: ImportPhase }
  | { type: "status"; phase: ImportPhase; notice: ImportStatus }
  | { type: "log"; entry: TerminalLogEntry }
  | { type: "grounding"; stats: GroundingEventStats }
  | { type: "normalize-progress"; progress: NormalizeProgress }
  | { type: "batch-progress"; progress: BatchProgress }
  | { type: "rows-changed" }
  | { type: "error"; notice: ImportFailure; recoverable: boolean }
  | { type: "done" };

/** The grounding payoff numbers surfaced after History. Mirrors core's
 *  `GroundingStats`, narrowed to what the UI shows. */
export interface GroundingEventStats {
  total: number;
  resolved: number;
  duplicates: number;
}

export type ImportEventHandler = (event: ImportEvent) => void;
