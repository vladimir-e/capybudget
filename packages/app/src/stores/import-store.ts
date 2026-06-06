import { create } from "zustand";
import { createSession } from "@/services/create-session";
import {
  runTool,
  buildContext,
  markImportEnriched,
  readStagingDuplicateTally,
  buildNothingToImportMessage,
  IMPORT_PIPELINE,
  type BudgetSnapshot,
  type CapySession,
  type ChatMessage,
  type ContentBlock,
  type ImportPhaseStep,
  type MessageContent,
  type StreamEvent,
} from "@capybudget/intelligence";
import type { ImportPhase } from "@capybudget/core";
import type { BudgetRepository, FileAdapter } from "@capybudget/persistence";

/**
 * Import store — single source of truth for import UI state. The whole import
 * is one orchestrated `CapySession` walking the `IMPORT_PIPELINE` phase machine
 * (see `@capybudget/intelligence` / INTELLIGENCE.md § Import Sessions).
 *
 * Phase transitions:
 *   idle ──startRun───▸ normalizing ──▸ accounts ──▸ … ──▸ enriching ──▸ review
 *   idle ──resumeRun──▸ accounts ──▸ … ──▸ enriching ──▸ review   (post-crash)
 *   <any run phase> ──cancelRun──▸ idle
 *   review ──cancel/merge──▸ idle
 *
 * `resumeRun` recovers a run that died after normalize: a fresh session re-runs
 * the post-normalize pipeline over the staging CSV (no normalize re-run — the
 * dropped source files are gone). It shares `driveStep`/`completeRun` with the
 * happy path, so any phase added after normalize is resumed automatically.
 */

/** Context the orchestrator carries across phases (pre-step dispatch). */
interface RunContext {
  budgetPath: string;
  repo?: BudgetRepository;
  fileAdapter?: FileAdapter;
}

/**
 * The run's terminal result, set by the orchestrator on completion. The seam
 * between the orchestrator (which decides the outcome) and the UI (which renders
 * the terminal moment prominently — distinct from the running status line/log):
 *   - `ready` — the run finished with rows to merge (the normal landing).
 *     `counts` carries the merge-ready vs dimmed split for the summary.
 *   - `nothing-to-import` — the dedup halt: every staging row was a duplicate,
 *     so enrich was skipped. `message` is the orchestrator-built terminal text.
 *   - `error` — the run failed mid-flight. `message` is the failure text.
 * `message` is always code-set, never model prose.
 */
export interface RunOutcome {
  kind: "ready" | "nothing-to-import" | "error";
  message?: string;
  /** Set on a `ready` landing: rows that will merge vs duplicate rows dimmed. */
  counts?: { ready: number; duplicates: number };
}

/** One past status line, kept in the run log with the time it was superseded. */
export interface StatusLogEntry {
  text: string;
  at: number; // Date.now() — app runtime (browser), fine here
}

interface ImportStore {
  phase: ImportPhase;
  setPhase: (phase: ImportPhase) => void;

  // ── Sidebar signal ──────────────────────────────────────────
  hasImportData: boolean;
  setHasImportData: (v: boolean) => void;

  // ── The single orchestrated run ──────────────────────────────
  runSession: CapySession | null;
  /** Streamed tool-call activity for the whole run (secondary detail; the
   *  status line + log is the primary channel). No assistant prose — import
   *  mode talks via `report_status`, not free text. */
  runMessages: ChatMessage[];
  /** The current step: the latest `report_status` line. Empty until the first
   *  status arrives. */
  statusText: string;
  /** Prior status lines, newest-first, each stamped with when a newer line
   *  superseded it. The active line lives in `statusText`, not here. */
  statusLog: StatusLogEntry[];
  /**
   * The run's terminal result, set on completion (null while in-flight). The UI
   * reads this to render the terminal moment — the "nothing to import" halt, the
   * merge-ready landing, or an error — as a prominent result, not a log line.
   */
  runOutcome: RunOutcome | null;

  startRun: (opts: {
    budgetPath: string;
    mcpServerPath: string;
    /** Import system prompt — carries the app-knowledge brief + normalize task. */
    systemPrompt: string;
    /** Pre-built multimodal kickoff payload from the import screen — text
     *  instructions plus image/PDF attachments encoded as base64. */
    initialMessage: MessageContent;
    /** File names that were attached, for the user-message
     *  `file-attachment` chips in the import UI. */
    sourceFilenames: string[];
    repo?: BudgetRepository;
    fileAdapter?: FileAdapter;
  }) => void;
  /**
   * Resume an interrupted run: a previous run died after normalize wrote the
   * staging CSV but before the post-normalize pipeline finished. Re-run that
   * pipeline (accounts → … → enrich) over the existing staging rows in a fresh
   * session — never re-running normalize (the dropped source files are gone).
   * Reuses the orchestrator's pre-step / inject / complete machinery.
   */
  resumeRun: (opts: {
    budgetPath: string;
    mcpServerPath: string;
    /** Standalone system prompt for the fresh session — carries app knowledge
     *  but no normalize task (the staging CSV is the input). */
    systemPrompt: string;
    repo?: BudgetRepository;
    fileAdapter?: FileAdapter;
  }) => void;
  cancelRun: () => void;
  /** Merge finished — reset to idle, leaving no session alive. */
  resetAfterMerge: () => void;
  /**
   * Re-derive the terminal `runOutcome` for a run reconnected straight into
   * `review` (the app was closed/reopened mid-run, so the in-memory outcome is
   * gone). Reads the staging tally and reconstructs the same outcome the
   * orchestrator would have set on completion. Best-effort: a read failure
   * leaves `runOutcome` null and the preview falls back to the plain table.
   */
  restoreReviewOutcome: (opts: {
    budgetPath: string;
    fileAdapter: FileAdapter;
  }) => Promise<void>;

  // ── Standalone re-enrich (preview's Enrich button) ───────────
  // A user-initiated re-run of the enrich phase after manual edits in the
  // review table. Independent of the orchestrated run — its own short-lived
  // session over the same import CSV. The auto_enrich pre-step + cancel-race
  // guard mirror the orchestrator's enrich phase.
  reenrichSession: CapySession | null;
  isEnriching: boolean;
  enrichStatusText: string;
  startReenrich: (opts: {
    budgetPath: string;
    budgetName: string;
    mcpServerPath: string;
    systemPrompt: string;
    snapshot?: BudgetSnapshot;
    repo?: BudgetRepository;
    fileAdapter?: FileAdapter;
  }) => void;
  cancelReenrich: () => void;
  onEnrichComplete: (() => void) | null;
  setOnEnrichComplete: (cb: (() => void) | null) => void;
}

// ── Helpers ─────────────────────────────────────────────────────

/**
 * The distinct `report_status` lines for the whole run, oldest-first, each
 * stamped with when it first arrived. Module-level state because the status
 * channel spans phases and a `content` event carries the *cumulative* block
 * array — the current phase-turn's status history re-sent every tick. Two
 * pieces:
 *   - `committedStatusLines` — lines from phases that already finished. Phases
 *     are separate turns, so a phase's `content` array doesn't carry the prior
 *     phases' statuses; the orchestrator commits them on each phase advance.
 *   - the current turn's lines are rederived from its cumulative texts each
 *     tick (idempotent under the re-send), reusing stable stamps.
 * Reset together at every run boundary (start / resume / cancel / merge).
 */
let committedStatusLines: StatusLogEntry[] = [];
let currentTurnStatusLines: StatusLogEntry[] = [];

function resetStatusLines(): void {
  committedStatusLines = [];
  currentTurnStatusLines = [];
}

/** Fold the current phase-turn's status lines into the committed history and
 *  start a fresh turn — called when the orchestrator advances a phase. */
function commitStatusTurn(): void {
  committedStatusLines = [...committedStatusLines, ...currentTurnStatusLines];
  currentTurnStatusLines = [];
}

/**
 * Reconcile the status state against the current phase-turn's cumulative status
 * texts. Consecutive duplicates collapse (a model re-reporting the same step
 * doesn't spam the log). Run-wide lines = committed (finished phases) + this
 * turn's; the newest is the active `statusText`, the rest the log (newest-first).
 */
function reconcileStatus(
  texts: string[],
): { statusText: string; statusLog: StatusLogEntry[] } {
  const turn: StatusLogEntry[] = [];
  const lastCommitted = committedStatusLines[committedStatusLines.length - 1];
  for (const text of texts) {
    if (!text) continue;
    const prevText =
      turn.length > 0 ? turn[turn.length - 1].text : lastCommitted?.text;
    if (text === prevText) continue;
    // Reuse the prior stamp for a line already seen at this position; only
    // freshly-arrived lines get a new timestamp.
    const prior = currentTurnStatusLines[turn.length];
    turn.push(prior && prior.text === text ? prior : { text, at: Date.now() });
  }
  currentTurnStatusLines = turn;

  const lines = [...committedStatusLines, ...turn];
  if (lines.length === 0) return { statusText: "", statusLog: [] };
  const active = lines[lines.length - 1];
  const log = lines.slice(0, -1).reverse();
  return { statusText: active.text, statusLog: log };
}

/**
 * Tear down a failed run and land it on a terminal `error` outcome. Shared by
 * the stream `error` event and the Claude-CLI `onExit` (subprocess died). A run
 * already torn down (idle / review / cancelled) is left alone. The phase stays
 * put so the screen keeps the processing view, where the error renders as a
 * prominent result rather than a buried log line.
 */
function failRun(
  message: string,
  set: (partial: Partial<ImportStore>) => void,
  get: () => ImportStore,
): void {
  const phase = get().phase;
  if (phase === "idle" || phase === "review") return;
  get().runSession?.kill();
  runContext = null;
  set({
    runSession: null,
    statusText: "",
    runOutcome: { kind: "error", message },
  });
}

/** The pipeline index for a given phase, or -1 if not a run phase. */
function pipelineIndexOf(phase: ImportPhase): number {
  return IMPORT_PIPELINE.findIndex((step) => step.phase === phase);
}

/**
 * The terminal outcome a finished run lands on, derived from its staging
 * duplicate tally. Every row a duplicate → the `nothing-to-import` halt;
 * otherwise the merge-ready `ready` split (rows that merge vs duplicates
 * dimmed). The single source for both the orchestrator's completion and a
 * reconnect that lands straight in `review` with the in-memory outcome gone.
 */
function outcomeFromTally(tally: {
  total: number;
  duplicateCount: number;
}): RunOutcome {
  const { total, duplicateCount } = tally;
  if (total > 0 && duplicateCount === total) {
    return {
      kind: "nothing-to-import",
      message: buildNothingToImportMessage(total),
    };
  }
  return {
    kind: "ready",
    counts: { ready: total - duplicateCount, duplicates: duplicateCount },
  };
}

/**
 * First post-normalize pipeline step. Normalize is the kickoff (index 0); a
 * resumed run re-enters here and walks to the end. Any phase inserted after
 * normalize is picked up automatically — resume always starts at the step right
 * after normalize, not a hardcoded phase.
 */
const FIRST_POST_NORMALIZE_INDEX = 1;

// ── Store ───────────────────────────────────────────────────────

let runContext: RunContext | null = null;
let reenrichContext: { budgetPath: string; fileAdapter: FileAdapter } | null = null;

export const useImportStore = create<ImportStore>((set, get) => ({
  phase: "idle",
  setPhase: (phase) => set({ phase }),

  // ── Sidebar ─────────────────────────────────────────────────
  hasImportData: false,
  setHasImportData: (hasImportData) => set({ hasImportData }),

  // ── Run ──────────────────────────────────────────────────────
  runSession: null,
  runMessages: [],
  statusText: "",
  statusLog: [],
  runOutcome: null,

  startRun: ({
    budgetPath,
    mcpServerPath,
    systemPrompt,
    initialMessage,
    sourceFilenames,
    repo,
    fileAdapter,
  }) => {
    get().runSession?.kill();
    resetStatusLines();
    runContext = { budgetPath, repo, fileAdapter };

    const session = createSession({
      budgetPath,
      mcpServerPath,
      systemPrompt,
      mode: "import",
      repo,
      fileAdapter,
      onEvent: (event: StreamEvent) => {
        handleRunStreamEvent(event, set, get);
      },
      // Claude-CLI-only: subprocess died unexpectedly. API adapters
      // never invoke this — they have no process to die.
      onExit: () => {
        console.debug("[import-store] run process exited");
        failRun(
          "The import process ended unexpectedly. Cancel and try again.",
          set,
          get,
        );
      },
    });

    // The screen builds `initialMessage` (text + multimodal blocks for
    // images/PDFs). It's passed through verbatim — image/PDF support
    // is identical across all three providers because it rides on the
    // initial message rather than on a Read tool.
    const blocks: ContentBlock[] = sourceFilenames.map((name) => ({
      type: "file-attachment" as const,
      name,
      size: 0,
      mediaType: "text/plain",
    }));

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      blocks,
    };
    const assistantMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      blocks: [],
    };

    set({
      runSession: session,
      runMessages: [userMsg, assistantMsg],
      statusText: "",
      statusLog: [],
      runOutcome: null,
      phase: "normalizing",
      hasImportData: false,
    });

    if (!session) {
      handleRunStreamEvent(
        {
          type: "error",
          message:
            "Capy is not configured. Open settings to pick an AI provider.",
        },
        set,
        get,
      );
      return;
    }

    session.send(initialMessage).catch((err) => {
      handleRunStreamEvent(
        { type: "error", message: err instanceof Error ? err.message : "Failed to start import" },
        set,
        get,
      );
    });
  },

  resumeRun: ({ budgetPath, mcpServerPath, systemPrompt, repo, fileAdapter }) => {
    get().runSession?.kill();
    resetStatusLines();
    runContext = { budgetPath, repo, fileAdapter };

    const session = createSession({
      budgetPath,
      mcpServerPath,
      systemPrompt,
      mode: "import",
      repo,
      fileAdapter,
      onEvent: (event: StreamEvent) => handleRunStreamEvent(event, set, get),
      onExit: () => {
        console.debug("[import-store] resumed run process exited");
        failRun(
          "The import process ended unexpectedly. Cancel and try again.",
          set,
          get,
        );
      },
    });

    // The resumed run carries no kickoff message: there's no normalize turn,
    // and the first post-normalize phase's instruction is injected by
    // `driveStep`. The assistant message is the sink the stream appends into.
    const assistantMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      blocks: [],
    };

    set({
      runSession: session,
      runMessages: [assistantMsg],
      statusText: "",
      statusLog: [],
      runOutcome: null,
      phase: IMPORT_PIPELINE[FIRST_POST_NORMALIZE_INDEX].phase,
      hasImportData: false,
    });

    if (!session) {
      handleRunStreamEvent(
        {
          type: "error",
          message:
            "Capy is not configured. Open settings to pick an AI provider.",
        },
        set,
        get,
      );
      return;
    }

    // Re-enter the pipeline at the first post-normalize phase and walk to the
    // end, reusing the orchestrator's pre-step / inject / complete machinery.
    void driveStep(FIRST_POST_NORMALIZE_INDEX, session, set, get);
  },

  cancelRun: () => {
    get().runSession?.kill();
    resetStatusLines();
    runContext = null;
    set({
      runSession: null,
      runMessages: [],
      statusText: "",
      statusLog: [],
      runOutcome: null,
      phase: "idle",
      hasImportData: false,
    });
  },

  resetAfterMerge: () => {
    // The run session is already dead by `review`; a re-enrich session may
    // still be alive if the user enriched then merged.
    get().reenrichSession?.kill();
    resetStatusLines();
    runContext = null;
    set({
      runSession: null,
      runMessages: [],
      statusText: "",
      statusLog: [],
      runOutcome: null,
      reenrichSession: null,
      isEnriching: false,
      enrichStatusText: "",
      phase: "idle",
      hasImportData: false,
    });
  },

  restoreReviewOutcome: async ({ budgetPath, fileAdapter }) => {
    // The run already finished on disk; only the in-memory outcome is gone.
    // Reconstruct it from the staging tally — the same source the orchestrator
    // reads on completion — so the completion banner / "nothing to import"
    // result survive a reconnect. A stale outcome already in state takes
    // precedence; this only fills the reconnect gap.
    if (get().runOutcome) return;
    try {
      const tally = await readStagingDuplicateTally(fileAdapter, budgetPath);
      if (get().phase === "review" && !get().runOutcome) {
        set({ runOutcome: outcomeFromTally(tally) });
      }
    } catch (err) {
      console.warn("[import-store] review-outcome restore failed:", err);
    }
  },

  // ── Re-enrich ────────────────────────────────────────────────
  reenrichSession: null,
  isEnriching: false,
  enrichStatusText: "",
  onEnrichComplete: null,
  setOnEnrichComplete: (cb) => set({ onEnrichComplete: cb }),

  startReenrich: ({
    budgetPath,
    budgetName,
    mcpServerPath,
    systemPrompt,
    snapshot,
    repo,
    fileAdapter,
  }) => {
    get().reenrichSession?.kill();
    reenrichContext = fileAdapter ? { budgetPath, fileAdapter } : null;

    const session = createSession({
      budgetPath,
      mcpServerPath,
      systemPrompt,
      mode: "import",
      repo,
      fileAdapter,
      onEvent: (event: StreamEvent) => handleReenrichStreamEvent(event, set, get),
      onExit: () => {
        if (!get().isEnriching) return;
        set({
          isEnriching: false,
          enrichStatusText:
            "Enrichment ended unexpectedly. Progress saved — you can restart.",
        });
      },
    });

    const message = `${buildContext({ budgetName, budgetPath, snapshot })}\nEnrich the imported transactions.`;

    set({ reenrichSession: session, isEnriching: true, enrichStatusText: "" });

    if (!session) {
      handleReenrichStreamEvent(
        {
          type: "error",
          message:
            "Capy is not configured. Open settings to pick an AI provider.",
        },
        set,
        get,
      );
      return;
    }

    // Deterministic auto_enrich pre-pass (same as the run's enrich phase),
    // cancel-race-guarded. Best-effort — the enrich turn proceeds regardless.
    const preEnrich = repo && fileAdapter
      ? runTool("auto_enrich", {}, { repo, fileAdapter, budgetPath }).catch(
          (err: unknown) => {
            console.warn("[import-store] re-enrich auto_enrich failed:", err);
          },
        )
      : Promise.resolve();

    preEnrich.then(() => {
      if (get().reenrichSession !== session) return;
      session.send(message).catch((err) => {
        handleReenrichStreamEvent(
          { type: "error", message: err instanceof Error ? err.message : "Failed to start enrichment" },
          set,
          get,
        );
      });
    });
  },

  cancelReenrich: () => {
    get().reenrichSession?.kill();
    set({ reenrichSession: null, isEnriching: false, enrichStatusText: "" });
  },
}));

// ── Orchestrator: phase advancement ────────────────────────────

/**
 * A run phase finished its agent turn. Advance the pipeline: if there's a
 * next phase, run its deterministic pre-step then inject its instruction as
 * a new user turn into the same session. If the pipeline is exhausted, the
 * run lands on `review` (merge-ready).
 *
 * One deterministic detour: when the phase that just finished is `dedup`, the
 * orchestrator checks the staging CSV before advancing. If every row is now a
 * duplicate (high-confidence auto-marks + low-confidence agent marks all
 * persisted), there's nothing to enrich and nothing to merge — skip enrich and
 * complete the run with a `nothing-to-import` outcome. The halt is decided here
 * in code, not by the model's free text.
 */
async function advanceRun(
  set: (partial: Partial<ImportStore>) => void,
  get: () => ImportStore,
): Promise<void> {
  const session = get().runSession;
  // No live run (e.g. a cancel already tore it down) — nothing to advance.
  if (!session) return;

  const finishedPhase = get().phase;

  if (finishedPhase === "dedup") {
    const haltOutcome = await checkNothingToImport();
    // A cancel during the staging read already tore the run down.
    if (get().runSession !== session) return;
    if (haltOutcome) {
      await completeRun(session, set, get, haltOutcome);
      return;
    }
  }

  const nextIdx = pipelineIndexOf(finishedPhase) + 1;
  await driveStep(nextIdx, session, set, get);
}

/**
 * The dedup halt decision: read the staging CSV and, if every row is a
 * duplicate, return the terminal `nothing-to-import` outcome (with the
 * count-derived message). Returns null when there's still work to do (some
 * rows are new) or when the staging state can't be read — in which case the
 * run advances to enrich as usual.
 */
async function checkNothingToImport(): Promise<RunOutcome | null> {
  const ctx = runContext;
  if (!ctx?.fileAdapter) return null;
  try {
    const { total, duplicateCount } = await readStagingDuplicateTally(
      ctx.fileAdapter,
      ctx.budgetPath,
    );
    if (total > 0 && duplicateCount === total) {
      return {
        kind: "nothing-to-import",
        message: buildNothingToImportMessage(total),
      };
    }
  } catch (err) {
    console.warn("[import-store] halt check failed:", err);
  }
  return null;
}

/**
 * Land the run on pipeline step `stepIdx`: set its phase, run its deterministic
 * pre-step, then inject its instruction as a user turn into `session`. Past the
 * end of the pipeline, complete the run. Shared by `advanceRun` (walking the
 * happy path) and `resumeRun` (re-entering mid-pipeline after an interruption),
 * so the pre-step / inject / cancel-guard machinery lives in exactly one place.
 */
async function driveStep(
  stepIdx: number,
  session: CapySession,
  set: (partial: Partial<ImportStore>) => void,
  get: () => ImportStore,
): Promise<void> {
  const step: ImportPhaseStep | undefined = IMPORT_PIPELINE[stepIdx];

  if (!step) {
    await completeRun(session, set, get);
    return;
  }

  console.debug(`[import-store] driving → ${step.phase}`);
  // The prior phase's turn is done — fold its status lines into the run's
  // committed history before the next phase's turn re-sends only its own.
  commitStatusTurn();
  set({ phase: step.phase });

  // Deterministic pre-step: code-triggered tools dispatched directly (not
  // model-advertised). Best-effort — a failure doesn't gate the agent turn.
  const ctx = runContext;
  for (const tool of step.preStepTools) {
    if (!ctx?.repo || !ctx.fileAdapter) break;
    // A cancel mid-loop nulls `runSession`; stop before the next mutating
    // tool call rather than draining the rest of a multi-tool pre-step against
    // a torn-down run.
    if (get().runSession !== session) return;
    try {
      await runTool(tool, {}, {
        repo: ctx.repo,
        fileAdapter: ctx.fileAdapter,
        budgetPath: ctx.budgetPath,
      });
    } catch (err) {
      console.warn(`[import-store] pre-step ${tool} failed:`, err);
    }
  }

  // The user may have cancelled while the pre-step ran — the store kills the
  // session and clears `runSession`. Skip the inject if state moved on.
  if (get().runSession !== session) return;

  if (step.instruction === null) {
    // Deterministic-only phase (no agent turn) — its pre-step has run, so
    // chain straight to the next phase without a session round-trip.
    void advanceRun(set, get);
    return;
  }

  // Sequential injection: the phase's instruction enters as a fresh user turn
  // in the SAME session, re-running the agentic loop with full memory.
  session.send(step.instruction).catch((err) => {
    handleRunStreamEvent(
      { type: "error", message: err instanceof Error ? err.message : "Failed to continue import" },
      set,
      get,
    );
  });
}

/**
 * The run is finished — land on merge-ready review. Reached two ways: the
 * pipeline ran to exhaustion (`ready`), or the dedup halt fired (the
 * `nothing-to-import` outcome, enrich skipped). Either way the store owns the
 * same completion side-effects: persist the `enriched` flag (so a reconnect
 * knows the run finished — the all-duplicate import has no enrich work left, so
 * marking it enriched is correct), then tear down the run session. The preview's
 * "Enrich" button spins up its own session, so the run session is dead weight
 * (and a live subprocess on the CLI adapter) past this point.
 */
async function completeRun(
  session: CapySession,
  set: (partial: Partial<ImportStore>) => void,
  get: () => ImportStore,
  outcome: RunOutcome = { kind: "ready" },
): Promise<void> {
  console.debug(`[import-store] run complete (${outcome.kind}) → review`);

  const ctx = runContext;
  // The merge-ready landing needs its split (rows that will merge vs duplicates
  // dimmed) for the terminal summary. Read it from the staging tally the halt
  // check already uses — single source, no UI recompute. The halt outcome
  // carries its own message and skips this.
  let resolved = outcome;
  if (outcome.kind === "ready" && ctx?.fileAdapter) {
    try {
      const tally = await readStagingDuplicateTally(
        ctx.fileAdapter,
        ctx.budgetPath,
      );
      resolved = outcomeFromTally(tally);
    } catch (err) {
      console.warn("[import-store] completion count read failed:", err);
    }
  }

  if (ctx?.fileAdapter) {
    try {
      await markImportEnriched(ctx.fileAdapter, ctx.budgetPath);
    } catch (err) {
      console.warn("[import-store] failed to persist enriched flag:", err);
    }
  }

  // A cancel during the async persist already tore down the run — don't
  // resurrect it onto review.
  if (get().runSession !== session) return;

  session.kill();
  runContext = null;
  set({
    runSession: null,
    phase: "review",
    hasImportData: true,
    statusText: "",
    runOutcome: resolved,
  });
}

// ── Stream event handler ────────────────────────────────────────

function handleRunStreamEvent(
  event: StreamEvent,
  set: (partial: Partial<ImportStore>) => void,
  get: () => ImportStore,
) {
  switch (event.type) {
    case "content": {
      // A `content` event carries the cumulative block array for the whole
      // turn, so the trailing assistant message is replaced wholesale (same as
      // chat's mergeStreamContent). The run talks via `report_status` (→
      // `status` blocks), not prose: status blocks are split out to drive the
      // status line/log and kept out of the message stream; tool-activity rides
      // along as secondary detail. Status state is rederived from the full
      // ordered status sequence, so it's idempotent under the cumulative
      // re-send.
      const statusTexts: string[] = [];
      const blocks: ContentBlock[] = [];
      for (const block of event.blocks) {
        if (block.type === "status") {
          if (block.text) statusTexts.push(block.text);
        } else {
          blocks.push(block);
        }
      }
      const msgs = get().runMessages;
      const last = msgs[msgs.length - 1];
      if (last?.role === "assistant") {
        const updated = [...msgs];
        updated[updated.length - 1] = { ...last, blocks };
        set({ runMessages: updated });
      }
      set(reconcileStatus(statusTexts));
      break;
    }
    case "done":
      void advanceRun(set, get);
      break;
    case "error":
      console.debug("[import-store] run error:", event.message);
      failRun(event.message, set, get);
      break;
  }
}

function handleReenrichStreamEvent(
  event: StreamEvent,
  set: (partial: Partial<ImportStore>) => void,
  get: () => ImportStore,
) {
  switch (event.type) {
    case "content":
      // Re-enrich talks via `report_status` too — drive the status line from
      // the `status` blocks, not prose.
      for (const block of event.blocks) {
        if (block.type === "status" && block.text) {
          set({ enrichStatusText: block.text });
        }
      }
      break;
    case "done": {
      set({ isEnriching: false, enrichStatusText: "" });
      // Re-affirm the enriched flag — idempotent, since the manual Enrich
      // button only runs on an already-enriched import (the run set the flag).
      const ctx = reenrichContext;
      const finish = ctx
        ? markImportEnriched(ctx.fileAdapter, ctx.budgetPath).catch((err) => {
            console.warn("[import-store] failed to persist enriched flag:", err);
          })
        : Promise.resolve();
      finish.then(() => get().onEnrichComplete?.());
      break;
    }
    case "error":
      console.debug("[import-store] re-enrich error:", event.message);
      set({ isEnriching: false, enrichStatusText: "" });
      break;
  }
}
