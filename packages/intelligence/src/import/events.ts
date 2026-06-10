/**
 * The import orchestrator's status-event contract.
 *
 * The orchestrator is headless: it never narrates in prose and never touches
 * React. It drives the pipeline as a deterministic state machine and emits
 * these events so any consumer (Unit 3's progress UI, a test harness, a CLI)
 * can render where the run is. Code always knows the phase, so the surface is
 * state, not a transcript.
 */

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

/**
 * A timestamped terminal-log line. The orchestrator emits these for the
 * human-readable run record (the "terminal" pane). `phase` ties the line to a
 * section so the UI can group; `ts` is epoch millis for stable ordering.
 */
export interface TerminalLogEntry {
  ts: number;
  level: LogLevel;
  phase: ImportPhase;
  message: string;
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
 *  - `error`         — a run-level failure (e.g. `no_data`). `recoverable`
 *                      distinguishes "back to file-attach" from a hard stop.
 *  - `done`          — the run finished (all batches dispatched + landed, or
 *                      stopped cleanly with the in-flight batch persisted).
 */
export type ImportEvent =
  | { type: "phase"; phase: ImportPhase }
  | { type: "status"; phase: ImportPhase; message: string }
  | { type: "log"; entry: TerminalLogEntry }
  | { type: "grounding"; stats: GroundingEventStats; message: string }
  | { type: "normalize-progress"; progress: NormalizeProgress }
  | { type: "batch-progress"; progress: BatchProgress }
  | { type: "rows-changed" }
  | { type: "error"; reason: ImportErrorReason; message: string; recoverable: boolean }
  | { type: "done" };

/** Why a run ended in error. `no_data` = the mapping/extraction call found no
 *  transactions (the selfie case) — recoverable, return to file-attach.
 *  `read` / `normalize` cover failures in those code phases. */
export type ImportErrorReason = "no_data" | "read" | "normalize" | "internal";

/** The grounding payoff numbers surfaced after History. Mirrors core's
 *  `GroundingStats`, narrowed to what the UI shows. */
export interface GroundingEventStats {
  total: number;
  resolved: number;
  duplicates: number;
}

export type ImportEventHandler = (event: ImportEvent) => void;
