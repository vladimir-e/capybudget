/**
 * React hook managing an intelligence session for the import normalization step.
 *
 * - Creates a CapySession with the import-specific system prompt
 * - Sends dropped files as attachments
 * - Parses streaming events into ChatMessage[]
 * - Detects completion for phase transition
 */

import { useCallback, useRef, useState } from "react";
import { useSessionLifecycle } from "@/hooks/use-session-lifecycle";
import {
  buildContext,
  formatAttachments,
  isImageAttachment,
  IMPORT_SYSTEM_PROMPT,
  type FileAttachment,
  type MessageContent,
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
  startNormalization: (files: FileAttachment[]) => void;
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
    (files: FileAttachment[]) => {
      if (lifecycle.isStreamingRef.current) return;
      console.log("[import-session] starting normalization, files:", files.map((f) => f.name));

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

      const imageFiles = files.filter(isImageAttachment);
      const attachmentText = formatAttachments(files);

      let enrichedText = `${context}\nNormalize the attached file(s) for import.`;
      if (attachmentText) {
        enrichedText += "\n\n" + attachmentText;
      }

      // Build multimodal content when images are attached
      let content: MessageContent;
      if (imageFiles.length > 0) {
        content = [
          { type: "text", text: enrichedText },
          ...imageFiles.map((f) => ({
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: f.mediaType,
              data: f.content,
            },
          })),
        ];
      } else {
        content = enrichedText;
      }

      const blocks: ContentBlock[] = [];
      for (const f of files) {
        blocks.push({
          type: "file-attachment",
          name: f.name,
          size: f.size,
          mediaType: f.mediaType,
        });
      }

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
