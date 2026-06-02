import { create } from "zustand";
import { createSession } from "@/services/create-session";
import {
  buildContext,
  runTool,
  type BudgetSnapshot,
  type CapySession,
  type ChatMessage,
  type ContentBlock,
  type MessageContent,
  type StreamEvent,
} from "@capybudget/intelligence";
import type { BudgetRepository, FileAdapter } from "@capybudget/persistence";

/**
 * Import store — single source of truth for import UI state.
 *
 * Owns:
 * - `phase`: explicit state machine for the import flow
 * - CapySession subprocesses (survive navigation)
 * - Accumulated messages and status text
 *
 * Phase transitions:
 *   idle ──startNormalization──▸ normalizing
 *   normalizing ──done──▸ preview
 *   normalizing ──cancel──▸ idle
 *   preview ──cancel/merge──▸ idle
 *
 * On mount, the component checks disk to initialize:
 *   has transactions.csv → setPhase("preview")
 *   has sources only → stays "idle" (component shows file list)
 *   empty → stays "idle" (component shows drop zone)
 */

export type ImportPhase = "idle" | "normalizing" | "preview";

interface ImportStore {
  phase: ImportPhase;
  setPhase: (phase: ImportPhase) => void;

  // ── Sidebar signal ──────────────────────────────────────────
  hasImportData: boolean;
  setHasImportData: (v: boolean) => void;

  // ── Normalization session ───────────────────────────────────
  normalizeSession: CapySession | null;
  normalizeMessages: ChatMessage[];

  startNormalization: (opts: {
    budgetPath: string;
    mcpServerPath: string;
    systemPrompt: string;
    /** Pre-built multimodal payload from the import screen — text
     *  instructions plus image/PDF attachments encoded as base64. */
    initialMessage: MessageContent;
    /** File names that were attached, for the user-message
     *  `file-attachment` chips in the import UI. */
    sourceFilenames: string[];
    repo?: BudgetRepository;
    fileAdapter?: FileAdapter;
  }) => void;
  cancelNormalization: () => void;

  // ── Enrichment session ──────────────────────────────────────
  enrichSession: CapySession | null;
  isEnriching: boolean;
  enrichStatusText: string;

  startEnrichment: (opts: {
    budgetPath: string;
    budgetName: string;
    mcpServerPath: string;
    systemPrompt: string;
    /** Budget shape attached to the import kickoff message (normalize or enrich). */
    snapshot?: BudgetSnapshot;
    repo?: BudgetRepository;
    fileAdapter?: FileAdapter;
  }) => void;
  cancelEnrichment: () => void;
  onEnrichComplete: (() => void) | null;
  setOnEnrichComplete: (cb: (() => void) | null) => void;
}

// ── Helpers ─────────────────────────────────────────────────────

let lastNormalizeTextContent = "";

function appendNormalizeBlock(
  blocks: ContentBlock[],
  block: ContentBlock,
): ContentBlock[] {
  const next = [...blocks];
  if (block.type === "text") {
    const prevText = lastNormalizeTextContent;
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
    lastNormalizeTextContent = block.content;
  } else {
    next.push(block);
  }
  return next;
}

// ── Store ───────────────────────────────────────────────────────

export const useImportStore = create<ImportStore>((set, get) => ({
  phase: "idle",
  setPhase: (phase) => set({ phase }),

  // ── Sidebar ─────────────────────────────────────────────────
  hasImportData: false,
  setHasImportData: (hasImportData) => set({ hasImportData }),

  // ── Normalization ───────────────────────────────────────────
  normalizeSession: null,
  normalizeMessages: [],

  startNormalization: ({
    budgetPath,
    mcpServerPath,
    systemPrompt,
    initialMessage,
    sourceFilenames,
    repo,
    fileAdapter,
  }) => {
    get().normalizeSession?.kill();
    lastNormalizeTextContent = "";

    const session = createSession({
      budgetPath,
      mcpServerPath,
      systemPrompt,
      repo,
      fileAdapter,
      onEvent: (event: StreamEvent) => {
        handleNormalizeStreamEvent(event, set, get);
      },
      // Claude-CLI-only: subprocess died unexpectedly. API adapters
      // never invoke this — they have no process to die.
      onExit: () => {
        console.debug("[import-store] normalize process exited");
        if (get().phase !== "normalizing") return;
        lastNormalizeTextContent = "";
        const errorBlock: ContentBlock = {
          type: "text" as const,
          content:
            "The normalization process ended unexpectedly. You can try again by canceling and restarting.",
        };
        set({
          normalizeMessages: (() => {
            const msgs = get().normalizeMessages;
            const updated = [...msgs];
            const last = updated[updated.length - 1];
            if (last?.role !== "assistant") {
              return [
                ...msgs,
                {
                  id: crypto.randomUUID(),
                  role: "assistant" as const,
                  blocks: [errorBlock],
                },
              ];
            }
            updated[updated.length - 1] = {
              ...last,
              blocks: [...last.blocks, errorBlock],
            };
            return updated;
          })(),
        });
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
      normalizeSession: session,
      normalizeMessages: [userMsg, assistantMsg],
      phase: "normalizing",
      hasImportData: false,
    });

    if (!session) {
      handleNormalizeStreamEvent(
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
      handleNormalizeStreamEvent(
        { type: "error", message: err instanceof Error ? err.message : "Failed to start normalization" },
        set,
        get,
      );
    });
  },

  cancelNormalization: () => {
    get().normalizeSession?.kill();
    lastNormalizeTextContent = "";
    set({
      normalizeSession: null,
      normalizeMessages: [],
      phase: "idle",
      hasImportData: false,
    });
  },

  // ── Enrichment ──────────────────────────────────────────────
  enrichSession: null,
  isEnriching: false,
  enrichStatusText: "",
  onEnrichComplete: null,
  setOnEnrichComplete: (cb) => set({ onEnrichComplete: cb }),

  startEnrichment: ({
    budgetPath,
    budgetName,
    mcpServerPath,
    systemPrompt,
    snapshot,
    repo,
    fileAdapter,
  }) => {
    get().enrichSession?.kill();

    const session = createSession({
      budgetPath,
      mcpServerPath,
      systemPrompt,
      repo,
      fileAdapter,
      onEvent: (event: StreamEvent) => {
        handleEnrichStreamEvent(event, set, get);
      },
      // Claude-CLI-only: subprocess died unexpectedly. API adapters
      // never invoke this — they have no process to die.
      onExit: () => {
        console.debug("[import-store] enrich process exited");
        if (!get().isEnriching) return;
        set({
          isEnriching: false,
          enrichStatusText:
            "Enrichment ended unexpectedly. Progress saved — you can restart.",
        });
      },
    });

    const context = buildContext({ budgetName, budgetPath, snapshot });
    const message = `${context}\nEnrich the imported transactions.`;

    set({
      enrichSession: session,
      isEnriching: true,
      enrichStatusText: "",
    });

    if (!session) {
      handleEnrichStreamEvent(
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

    // Pre-run auto_enrich so the prompt's "Already ran before this prompt"
    // wording is accurate. Mint-style CSVs with sourceCategory /
    // sourceAccount populated get deterministic fuzzy-matching before
    // the model wakes up; without this, the model would redo the same
    // work by hand via enrich_update. Best-effort: if it fails, the
    // model can still call auto_enrich itself as fallback.
    const preEnrich = repo && fileAdapter
      ? runTool("auto_enrich", {}, { repo, fileAdapter, budgetPath }).catch(
          (err: unknown) => {
            console.warn("[import-store] pre-enrich auto_enrich failed:", err);
          },
        )
      : Promise.resolve();

    preEnrich.then(() => {
      // User may have cancelled while auto_enrich was running — the
      // store kills the session and clears `enrichSession`. Skip the
      // send if the state no longer matches the one we started.
      if (get().enrichSession !== session) return;
      session.send(message).catch((err) => {
        handleEnrichStreamEvent(
          { type: "error", message: err instanceof Error ? err.message : "Failed to start enrichment" },
          set,
          get,
        );
      });
    });
  },

  cancelEnrichment: () => {
    get().enrichSession?.kill();
    set({
      enrichSession: null,
      isEnriching: false,
      enrichStatusText: "",
    });
  },
}));

// ── Stream event handlers ─────────────────────────────────────

function handleNormalizeStreamEvent(
  event: StreamEvent,
  set: (partial: Partial<ImportStore>) => void,
  get: () => ImportStore,
) {
  switch (event.type) {
    case "content": {
      set({
        normalizeMessages: (() => {
          const msgs = get().normalizeMessages;
          const updated = [...msgs];
          const last = updated[updated.length - 1];
          if (last?.role !== "assistant") return msgs;

          let blocks = [...last.blocks];
          for (const block of event.blocks) {
            blocks = appendNormalizeBlock(blocks, block);
          }
          updated[updated.length - 1] = { ...last, blocks };
          return updated;
        })(),
      });
      break;
    }
    case "done":
      // Synchronous transition: normalizing → preview. No async, no race.
      console.debug("[import-store] normalize done → preview");
      lastNormalizeTextContent = "";
      set({ phase: "preview", hasImportData: true });
      break;
    case "error":
      console.debug("[import-store] normalize error:", event.message);
      lastNormalizeTextContent = "";
      set({
        normalizeMessages: (() => {
          const msgs = get().normalizeMessages;
          const updated = [...msgs];
          const last = updated[updated.length - 1];
          if (last?.role !== "assistant") {
            return [
              ...msgs,
              {
                id: crypto.randomUUID(),
                role: "assistant" as const,
                blocks: [{ type: "text" as const, content: `Error: ${event.message}` }],
              },
            ];
          }
          updated[updated.length - 1] = {
            ...last,
            blocks: [...last.blocks, { type: "text" as const, content: `Error: ${event.message}` }],
          };
          return updated;
        })(),
      });
      break;
  }
}

function handleEnrichStreamEvent(
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
    case "done":
      console.debug("[import-store] enrich done");
      set({ isEnriching: false, enrichStatusText: "" });
      get().onEnrichComplete?.();
      break;
    case "error":
      console.debug("[import-store] enrich error:", event.message);
      set({ isEnriching: false, enrichStatusText: "" });
      break;
  }
}
