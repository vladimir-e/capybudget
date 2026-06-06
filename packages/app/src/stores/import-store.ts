import { create } from "zustand";
import { createSession } from "@/services/create-session";
import {
  runTool,
  buildContext,
  markImportEnriched,
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
 *   idle ──startRun──▸ normalizing ──done──▸ enriching ──done──▸ review
 *   <any run phase> ──cancelRun──▸ idle
 *   review ──cancel/merge──▸ idle
 */

/** Context the orchestrator carries across phases (pre-step dispatch). */
interface RunContext {
  budgetPath: string;
  repo?: BudgetRepository;
  fileAdapter?: FileAdapter;
}

interface ImportStore {
  phase: ImportPhase;
  setPhase: (phase: ImportPhase) => void;

  // ── Sidebar signal ──────────────────────────────────────────
  hasImportData: boolean;
  setHasImportData: (v: boolean) => void;

  // ── The single orchestrated run ──────────────────────────────
  runSession: CapySession | null;
  /** Streamed tool-call / message activity for the whole run. */
  runMessages: ChatMessage[];
  /** Latest status line surfaced from the run (last non-empty text). */
  statusText: string;

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
  cancelRun: () => void;
  /** Merge finished — reset to idle, leaving no session alive. */
  resetAfterMerge: () => void;

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

let lastRunTextContent = "";

function appendRunBlock(
  blocks: ContentBlock[],
  block: ContentBlock,
): ContentBlock[] {
  const next = [...blocks];
  if (block.type === "text") {
    const prevText = lastRunTextContent;
    if (prevText && block.content.startsWith(prevText)) {
      const lastTextIdx = next.findLastIndex((b) => b.type === "text");
      if (lastTextIdx >= 0) {
        next[lastTextIdx] = block;
      } else {
        next.push(block);
      }
    } else {
      next.push(block);
    }
    lastRunTextContent = block.content;
  } else {
    next.push(block);
  }
  return next;
}

/** The pipeline index for a given phase, or -1 if not a run phase. */
function pipelineIndexOf(phase: ImportPhase): number {
  return IMPORT_PIPELINE.findIndex((step) => step.phase === phase);
}

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
    lastRunTextContent = "";
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
        if (get().phase === "idle" || get().phase === "review") return;
        lastRunTextContent = "";
        const errorBlock: ContentBlock = {
          type: "text" as const,
          content:
            "The import process ended unexpectedly. You can try again by canceling and restarting.",
        };
        set({ runMessages: appendErrorMessage(get().runMessages, errorBlock) });
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

  cancelRun: () => {
    get().runSession?.kill();
    lastRunTextContent = "";
    runContext = null;
    set({
      runSession: null,
      runMessages: [],
      statusText: "",
      phase: "idle",
      hasImportData: false,
    });
  },

  resetAfterMerge: () => {
    // The run session is already dead by `review`; a re-enrich session may
    // still be alive if the user enriched then merged.
    get().reenrichSession?.kill();
    lastRunTextContent = "";
    runContext = null;
    set({
      runSession: null,
      runMessages: [],
      statusText: "",
      reenrichSession: null,
      isEnriching: false,
      enrichStatusText: "",
      phase: "idle",
      hasImportData: false,
    });
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
 */
async function advanceRun(
  set: (partial: Partial<ImportStore>) => void,
  get: () => ImportStore,
): Promise<void> {
  const session = get().runSession;
  // No live run (e.g. a cancel already tore it down) — nothing to advance.
  if (!session) return;

  const currentIdx = pipelineIndexOf(get().phase);
  const nextStep: ImportPhaseStep | undefined = IMPORT_PIPELINE[currentIdx + 1];

  if (!nextStep) {
    await completeRun(session, set, get);
    return;
  }

  console.debug(`[import-store] advancing → ${nextStep.phase}`);
  lastRunTextContent = "";
  set({ phase: nextStep.phase });

  // Deterministic pre-step: code-triggered tools dispatched directly (not
  // model-advertised). Best-effort — a failure doesn't gate the agent turn.
  const ctx = runContext;
  for (const tool of nextStep.preStepTools) {
    if (!ctx?.repo || !ctx.fileAdapter) break;
    // A cancel mid-loop nulls `runSession`; stop before the next mutating
    // tool call rather than draining the rest of the (Unit 2/4 multi-tool)
    // pre-step against a torn-down run.
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

  if (nextStep.instruction === null) {
    // Deterministic-only phase (no agent turn) — its pre-step has run, so
    // chain straight to the next phase without a session round-trip.
    void advanceRun(set, get);
    return;
  }

  // Sequential injection: the next phase's instruction enters as a fresh user
  // turn in the SAME session, re-running the agentic loop with full memory.
  session.send(nextStep.instruction).catch((err) => {
    handleRunStreamEvent(
      { type: "error", message: err instanceof Error ? err.message : "Failed to continue import" },
      set,
      get,
    );
  });
}

/**
 * The pipeline is exhausted — land on merge-ready review. The store owns the
 * run-completion side-effects: persist the `enriched` flag (so a reconnect
 * knows the run finished), then tear down the run session. The preview's
 * "Enrich" button spins up its own session, so the run session is dead weight
 * (and a live subprocess on the CLI adapter) past this point.
 */
async function completeRun(
  session: CapySession,
  set: (partial: Partial<ImportStore>) => void,
  get: () => ImportStore,
): Promise<void> {
  console.debug("[import-store] run complete → review");
  lastRunTextContent = "";

  const ctx = runContext;
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
  set({ runSession: null, phase: "review", hasImportData: true, statusText: "" });
}

// ── Stream event handler ────────────────────────────────────────

function handleRunStreamEvent(
  event: StreamEvent,
  set: (partial: Partial<ImportStore>) => void,
  get: () => ImportStore,
) {
  switch (event.type) {
    case "content": {
      let latestText = "";
      set({
        runMessages: (() => {
          const msgs = get().runMessages;
          const updated = [...msgs];
          const last = updated[updated.length - 1];
          if (last?.role !== "assistant") return msgs;

          let blocks = [...last.blocks];
          for (const block of event.blocks) {
            blocks = appendRunBlock(blocks, block);
            if (block.type === "text" && block.content) {
              const lines = block.content.trim().split("\n");
              const lastLine = lines[lines.length - 1]?.trim();
              if (lastLine) latestText = lastLine;
            }
          }
          updated[updated.length - 1] = { ...last, blocks };
          return updated;
        })(),
      });
      if (latestText) set({ statusText: latestText });
      break;
    }
    case "done":
      void advanceRun(set, get);
      break;
    case "error":
      console.debug("[import-store] run error:", event.message);
      lastRunTextContent = "";
      set({
        statusText: "",
        runMessages: appendErrorMessage(get().runMessages, {
          type: "text" as const,
          content: `Error: ${event.message}`,
        }),
      });
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
      for (const block of event.blocks) {
        if (block.type === "text" && block.content) {
          const lines = block.content.trim().split("\n");
          const last = lines[lines.length - 1]?.trim();
          if (last) set({ enrichStatusText: last });
        }
      }
      break;
    case "done": {
      set({ isEnriching: false, enrichStatusText: "" });
      // Resume case: an interrupted run is finished by re-enrich, so the store
      // records the import as enriched here too (idempotent for the normal
      // re-enrich of an already-enriched import).
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

/** Append an error block to the trailing assistant message (or a new one). */
function appendErrorMessage(
  msgs: ChatMessage[],
  errorBlock: ContentBlock,
): ChatMessage[] {
  const updated = [...msgs];
  const last = updated[updated.length - 1];
  if (last?.role !== "assistant") {
    return [
      ...msgs,
      { id: crypto.randomUUID(), role: "assistant" as const, blocks: [errorBlock] },
    ];
  }
  updated[updated.length - 1] = { ...last, blocks: [...last.blocks, errorBlock] };
  return updated;
}
