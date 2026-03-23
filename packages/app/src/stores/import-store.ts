import { create } from "zustand";
import { CapySession } from "@/services/capy-session";
import { parseStreamLine } from "@/services/capy-stream";
import {
  buildContext,
  type ChatMessage,
  type ContentBlock,
  type SessionEvent,
  type StreamEvent,
} from "@capybudget/intelligence";

/**
 * Import store — owns session state that must survive navigation.
 *
 * The CapySession (Claude subprocess) and accumulated messages live here,
 * not in component state. Navigating away from the import screen and back
 * reconnects to the ongoing process seamlessly.
 */

interface ImportStore {
  // ── Sidebar signal ──────────────────────────────────────────
  hasImportData: boolean;
  setHasImportData: (v: boolean) => void;

  // ── Normalization session ───────────────────────────────────
  normalizeSession: CapySession | null;
  normalizeMessages: ChatMessage[];
  isNormalizing: boolean;

  startNormalization: (opts: {
    budgetPath: string;
    budgetName: string;
    mcpServerPath: string;
    systemPrompt: string;
    sourceFilenames: string[];
  }) => void;
  cancelNormalization: () => void;
  /** Called externally when normalization completes (e.g. to trigger disk refresh). */
  onNormalizeComplete: (() => void) | null;
  setOnNormalizeComplete: (cb: (() => void) | null) => void;

  // ── Enrichment session ──────────────────────────────────────
  enrichSession: CapySession | null;
  isEnriching: boolean;
  enrichStatusText: string;

  startEnrichment: (opts: {
    budgetPath: string;
    budgetName: string;
    mcpServerPath: string;
    systemPrompt: string;
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
  // ── Sidebar ─────────────────────────────────────────────────
  hasImportData: false,
  setHasImportData: (hasImportData) => set({ hasImportData }),

  // ── Normalization ───────────────────────────────────────────
  normalizeSession: null,
  normalizeMessages: [],
  isNormalizing: false,
  onNormalizeComplete: null,
  setOnNormalizeComplete: (cb) => set({ onNormalizeComplete: cb }),

  startNormalization: ({ budgetPath, budgetName, mcpServerPath, systemPrompt, sourceFilenames }) => {
    // Kill any existing session
    get().normalizeSession?.kill();
    lastNormalizeTextContent = "";

    const session = new CapySession({
      budgetPath,
      mcpServerPath,
      systemPrompt,
      onEvent: (event: SessionEvent) => {
        switch (event.type) {
          case "stdout":
            for (const streamEvent of parseStreamLine(event.line)) {
              handleNormalizeStreamEvent(streamEvent, set, get);
            }
            break;
          case "stderr":
            console.debug("[import-store-stderr]", event.line);
            break;
          case "exit":
            console.debug("[import-store] normalize process exited");
            set({ isNormalizing: false });
            break;
          case "error":
            handleNormalizeStreamEvent(
              { type: "error", message: event.message },
              set,
              get,
            );
            break;
        }
      },
    });

    const context = buildContext({ budgetName, budgetPath });
    const fileList = sourceFilenames.map((f) => `- ${f}`).join("\n");
    const content = `${context}
Normalize the following source files for import. The files are in the import sources directory (.capy/import/sources/).

Source files:
${fileList}

For CSV files, use analyze_csv to inspect the format, then define a mapping and use transform_csv.
For images and PDFs, use the Read tool to view them, then extract transactions manually.`;

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
      isNormalizing: true,
    });

    session.send(content).catch((err) => {
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
      isNormalizing: false,
    });
  },

  // ── Enrichment ──────────────────────────────────────────────
  enrichSession: null,
  isEnriching: false,
  enrichStatusText: "",
  onEnrichComplete: null,
  setOnEnrichComplete: (cb) => set({ onEnrichComplete: cb }),

  startEnrichment: ({ budgetPath, budgetName, mcpServerPath, systemPrompt }) => {
    get().enrichSession?.kill();

    const session = new CapySession({
      budgetPath,
      mcpServerPath,
      systemPrompt,
      onEvent: (event: SessionEvent) => {
        switch (event.type) {
          case "stdout":
            for (const streamEvent of parseStreamLine(event.line)) {
              handleEnrichStreamEvent(streamEvent, set, get);
            }
            break;
          case "stderr":
            console.debug("[import-store-enrich-stderr]", event.line);
            break;
          case "exit":
            console.debug("[import-store] enrich process exited");
            set({ isEnriching: false, enrichStatusText: "" });
            break;
          case "error":
            handleEnrichStreamEvent(
              { type: "error", message: event.message },
              set,
              get,
            );
            break;
        }
      },
    });

    const context = buildContext({ budgetName, budgetPath });
    const message = `${context}\nEnrich the imported transactions.`;

    set({
      enrichSession: session,
      isEnriching: true,
      enrichStatusText: "",
    });

    session.send(message).catch((err) => {
      handleEnrichStreamEvent(
        { type: "error", message: err instanceof Error ? err.message : "Failed to start enrichment" },
        set,
        get,
      );
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
      console.debug("[import-store] normalize done");
      set({ isNormalizing: false });
      lastNormalizeTextContent = "";
      get().onNormalizeComplete?.();
      break;
    case "error":
      console.debug("[import-store] normalize error:", event.message);
      set({ isNormalizing: false });
      lastNormalizeTextContent = "";
      // Append error to messages
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
