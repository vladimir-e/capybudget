import { create } from "zustand";
import type {
  BatchProgress,
  ImportErrorReason,
  ImportEvent,
  ImportPhase,
  TerminalLogEntry,
} from "@capybudget/intelligence";

/**
 * Import store — the event-driven view of an orchestrator run.
 *
 * The orchestrator (`@capybudget/intelligence`) is the headless state machine;
 * disk staging in `.capy/import/` is the source of truth for rows and resume.
 * This store holds only the *live* projection of the run that the progress UI
 * renders: which phase the section bar is on, the current status line, the
 * accumulating terminal log, the Categorizing batch meter, the History payoff
 * stats, and any terminal error. It never holds row data — the preview reads
 * that from staging on every `rows-changed` tick.
 *
 * `apply(event)` is the single sink the orchestrator's `onEvent` calls. The
 * hook owns the orchestrator instance and its lifecycle; the store is pure
 * state so it survives navigation (the run continues while the user is on
 * another tab) and stays trivially testable.
 */

/** Newest log lines render at the bottom; older ones scroll off. Capped so a
 *  long run can't grow the array without bound. */
const MAX_LOG_ENTRIES = 200;

interface ImportRunState {
  /** The orchestrator's current phase, or `idle` before a run starts. */
  phase: ImportPhase;
  /** The single current-status line (with spinner), replaced as it ticks. */
  status: string;
  /** Timestamped terminal log, oldest first. */
  log: TerminalLogEntry[];
  /** Categorizing meter over the remaining incomplete rows; null until it ticks. */
  batchProgress: BatchProgress | null;
  /** True once History has grounded — keeps the section bar up for the brief
   *  window between the grounding stats and the first staged-rows flip. The
   *  payoff numbers themselves reach the user through the terminal-log line. */
  grounded: boolean;
  /** Terminal run error, or null. `recoverable` (e.g. `no_data`) routes the
   *  screen back to file-attach rather than to a hard error state. */
  error: { reason: ImportErrorReason; message: string; recoverable: boolean } | null;
  /** True between `start`/`enrich` and the terminal `done`/`error`. Drives Stop
   *  vs Enrich availability and the live/read-only preview split. */
  running: boolean;
  /** Bumped on every `rows-changed`, so the preview can re-read staging by
   *  depending on a primitive rather than a callback identity. */
  rowsVersion: number;
}

interface ImportStore extends ImportRunState {
  /** The orchestrator's `onEvent` sink — folds one event into run state. */
  apply: (event: ImportEvent) => void;
  /** Mark a run as starting (the hook calls this before `start`/`enrich`). For
   *  a fresh `start` it clears the prior run; for `enrich` it keeps the log so
   *  the re-run reads as a continuation. */
  beginRun: (mode: "start" | "enrich") => void;
  /** Reset to the resting state — used on unmount-discard and after merge. */
  reset: () => void;

  // ── Sidebar signal ──────────────────────────────────────────
  /** Whether the Import nav entry shows the "has data" dot. */
  hasImportData: boolean;
  setHasImportData: (v: boolean) => void;

  // ── Chat on-ramp signal ─────────────────────────────────────
  /** Bumped when Capy's `start_import` stages sources, so the Import screen
   *  re-checks disk and auto-starts even when it's already mounted (the user
   *  was on the Import tab when they shared the file — navigation alone wouldn't
   *  remount it). The screen depends on this counter, not on a remount. */
  chatImportSignal: number;
  signalChatImport: () => void;
}

const IDLE_RUN: ImportRunState = {
  phase: "idle",
  status: "",
  log: [],
  batchProgress: null,
  grounded: false,
  error: null,
  running: false,
  rowsVersion: 0,
};

export const useImportStore = create<ImportStore>((set) => ({
  ...IDLE_RUN,

  apply: (event) => set((s) => reduce(s, event)),

  beginRun: (mode) =>
    set((s) =>
      mode === "start"
        ? // A fresh import clears everything, the reload counter included — the
          // prior run's rows are gone, so the preview shouldn't think a batch
          // already landed.
          { ...IDLE_RUN, running: true, phase: "reading" }
        : {
            // Enrich re-runs Categorizing only; keep the visible log + grounding
            // payoff so the re-run reads as a continuation, not a fresh start.
            // rowsVersion carries forward so the mounted preview keeps reloading
            // on each landed batch.
            running: true,
            error: null,
            phase: "categorizing",
            status: "",
            batchProgress: null,
            rowsVersion: s.rowsVersion,
          },
    ),

  reset: () => set(IDLE_RUN),

  hasImportData: false,
  setHasImportData: (hasImportData) => set({ hasImportData }),

  chatImportSignal: 0,
  signalChatImport: () => set((s) => ({ chatImportSignal: s.chatImportSignal + 1 })),
}));

/** Fold one orchestrator event into the run state. Pure — the store's `apply`
 *  is its only caller, and it's exported for the store test. */
export function reduce(s: ImportRunState, event: ImportEvent): Partial<ImportRunState> {
  switch (event.type) {
    case "phase":
      return {
        phase: event.phase,
        running: event.phase !== "done" && event.phase !== "error",
      };
    case "status":
      return { status: event.message };
    case "log":
      return { log: appendLog(s.log, event.entry) };
    case "grounding":
      return { grounded: true };
    case "batch-progress":
      return { batchProgress: event.progress };
    case "rows-changed":
      return { rowsVersion: s.rowsVersion + 1 };
    case "error":
      return {
        error: { reason: event.reason, message: event.message, recoverable: event.recoverable },
        running: false,
      };
    case "done":
      return { running: false, status: "" };
  }
}

function appendLog(log: TerminalLogEntry[], entry: TerminalLogEntry): TerminalLogEntry[] {
  const next = log.length >= MAX_LOG_ENTRIES ? log.slice(log.length - MAX_LOG_ENTRIES + 1) : [...log];
  next.push(entry);
  return next;
}
