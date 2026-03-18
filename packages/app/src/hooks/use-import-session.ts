/**
 * React hook managing an intelligence session for the import normalization step.
 *
 * - Creates a CapySession with the import-specific system prompt
 * - Sends dropped files as attachments
 * - Parses streaming events into ChatMessage[]
 * - Detects completion for phase transition
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { CapySession } from "@/services/capy-session";
import { parseStreamLine } from "@/services/capy-stream";
import {
  buildContext,
  formatAttachments,
  isImageAttachment,
  IMPORT_SYSTEM_PROMPT,
  type FileAttachment,
  type MessageContent,
  type SessionEvent,
  type StreamEvent,
  type ChatMessage,
  type ContentBlock,
} from "@capybudget/intelligence";

interface UseImportSessionOptions {
  budgetPath: string;
  budgetName: string;
  mcpServerPath: string;
  customInstructions?: string;
  onNormalizationComplete?: () => void;
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
  const [isStreaming, _setIsStreaming] = useState(false);
  const isStreamingRef = useRef(false);
  const sessionRef = useRef<CapySession | null>(null);
  const lastTextContentRef = useRef("");

  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  const setIsStreaming = useCallback((value: boolean) => {
    isStreamingRef.current = value;
    _setIsStreaming(value);
  }, []);

  const handleStreamEvent = useCallback(
    (event: StreamEvent) => {
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
          setIsStreaming(false);
          lastTextContentRef.current = "";
          optsRef.current.onNormalizationComplete?.();
          break;

        case "error":
          setIsStreaming(false);
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
    [setIsStreaming],
  );

  const handleSessionEvent = useCallback(
    (event: SessionEvent) => {
      switch (event.type) {
        case "stdout":
          for (const streamEvent of parseStreamLine(event.line)) {
            handleStreamEvent(streamEvent);
          }
          break;

        case "stderr":
          console.debug("[import-stderr]", event.line);
          break;

        case "exit":
          setIsStreaming(false);
          lastTextContentRef.current = "";
          break;

        case "error":
          handleStreamEvent({ type: "error", message: event.message });
          break;
      }
    },
    [handleStreamEvent, setIsStreaming],
  );

  useEffect(() => {
    return () => {
      sessionRef.current?.kill();
      sessionRef.current = null;
    };
  }, []);

  const startNormalization = useCallback(
    (files: FileAttachment[]) => {
      if (isStreamingRef.current) return;

      const o = optsRef.current;
      const customInstructions = o.customInstructions?.trim();
      const systemPrompt = customInstructions
        ? `${IMPORT_SYSTEM_PROMPT}\n\n## User instructions\n${customInstructions}`
        : IMPORT_SYSTEM_PROMPT;

      // Kill any existing session
      sessionRef.current?.kill();
      sessionRef.current = new CapySession({
        budgetPath: o.budgetPath,
        mcpServerPath: o.mcpServerPath,
        systemPrompt,
        onEvent: handleSessionEvent,
      });

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
      setIsStreaming(true);
      lastTextContentRef.current = "";

      sessionRef.current.send(content).catch((err) => {
        handleStreamEvent({
          type: "error",
          message:
            err instanceof Error ? err.message : "Failed to start normalization",
        });
      });
    },
    [handleSessionEvent, handleStreamEvent, setIsStreaming],
  );

  const cancel = useCallback(() => {
    sessionRef.current?.kill();
    sessionRef.current = null;
    setIsStreaming(false);
    lastTextContentRef.current = "";
  }, [setIsStreaming]);

  return { messages, isStreaming, startNormalization, cancel };
}
