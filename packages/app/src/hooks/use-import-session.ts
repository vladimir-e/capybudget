/**
 * React hook managing an intelligence session for the import normalization step.
 *
 * Files are already on disk in .capy/import/sources/ before this hook runs.
 * The AI is told the filenames and reads them via MCP tools (analyze_csv)
 * or the Read tool (images/PDFs).
 */

import { useCallback, useRef, useState } from "react";
import { useSessionLifecycle } from "@/hooks/use-session-lifecycle";
import {
  buildContext,
  IMPORT_SYSTEM_PROMPT,
  type StreamEvent,
  type ChatMessage,
  type ContentBlock,
} from "@capybudget/intelligence";

interface UseImportSessionOptions {
  budgetPath: string;
  budgetName: string;
  mcpServerPath: string;
  customInstructions?: string;
  onImportComplete?: () => void;
}

interface UseImportSessionReturn {
  messages: ChatMessage[];
  isStreaming: boolean;
  /** Start normalization. Pass source filenames (already on disk in .capy/import/sources/). */
  startNormalization: (sourceFilenames: string[]) => void;
  cancel: () => void;
}

export function useImportSession(
  opts: UseImportSessionOptions,
): UseImportSessionReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const lastTextContentRef = useRef("");

  const lifecycle = useSessionLifecycle(
    opts,
    (event: StreamEvent, ctx) => {
      switch (event.type) {
        case "content": {
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last?.role !== "assistant") return prev;

            const blocks = [...last.blocks];

            for (const block of event.blocks) {
              if (block.type === "text") {
                const prevText = lastTextContentRef.current;
                if (prevText && block.content.startsWith(prevText)) {
                  const lastTextIdx = blocks.findLastIndex(
                    (b) => b.type === "text",
                  );
                  if (lastTextIdx >= 0) {
                    blocks[lastTextIdx] = block;
                  } else {
                    blocks.push(block);
                  }
                } else {
                  blocks.push(block);
                }
                lastTextContentRef.current = block.content;
              } else {
                blocks.push(block);
              }
            }

            updated[updated.length - 1] = { ...last, blocks };
            return updated;
          });
          break;
        }

        case "done":
          console.log("[import-session] stream done — calling onImportComplete");
          ctx.setIsStreaming(false);
          lastTextContentRef.current = "";
          ctx.optsRef.current.onImportComplete?.();
          break;

        case "error":
          console.log("[import-session] stream error:", event.message);
          ctx.setIsStreaming(false);
          lastTextContentRef.current = "";
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last?.role !== "assistant") {
              return [
                ...prev,
                {
                  id: crypto.randomUUID(),
                  role: "assistant" as const,
                  blocks: [
                    {
                      type: "text" as const,
                      content: `Error: ${event.message}`,
                    },
                  ],
                },
              ];
            }
            updated[updated.length - 1] = {
              ...last,
              blocks: [
                ...last.blocks,
                {
                  type: "text" as const,
                  content: `Error: ${event.message}`,
                },
              ],
            };
            return updated;
          });
          break;
      }
    },
    "import",
    // onExit — reset text accumulator on unexpected process exit
    () => {
      lastTextContentRef.current = "";
    },
  );

  const startNormalization = useCallback(
    (sourceFilenames: string[]) => {
      if (lifecycle.isStreamingRef.current) return;
      console.log("[import-session] starting normalization, files:", sourceFilenames);

      const o = lifecycle.optsRef.current;
      const customInstructions = o.customInstructions?.trim();
      const systemPrompt = customInstructions
        ? `${IMPORT_SYSTEM_PROMPT}\n\n## User instructions\n${customInstructions}`
        : IMPORT_SYSTEM_PROMPT;

      const session = lifecycle.createSession(systemPrompt);

      const context = buildContext({
        budgetName: o.budgetName,
        budgetPath: o.budgetPath,
      });

      // Tell Claude the filenames — files are on disk in .capy/import/sources/
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

      setMessages([userMsg, assistantMsg]);
      lifecycle.setIsStreaming(true);
      lastTextContentRef.current = "";

      session.send(content).catch((err) => {
        lifecycle.dispatchStreamEvent({
          type: "error",
          message:
            err instanceof Error ? err.message : "Failed to start normalization",
        });
      });
    },
    [lifecycle],
  );

  const cancel = useCallback(() => {
    lifecycle.cancel();
    lastTextContentRef.current = "";
  }, [lifecycle]);

  return { messages, isStreaming: lifecycle.isStreaming, startNormalization, cancel };
}
