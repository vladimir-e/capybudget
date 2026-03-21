/**
 * React hook managing an intelligence session for the import enrichment step.
 *
 * - Creates a CapySession with the enrich-specific system prompt
 * - Sends a message with mapping context
 * - Streams events, exposes latest status text, and detects completion
 */

import { useCallback, useState } from "react";
import { useSessionLifecycle } from "@/hooks/use-session-lifecycle";
import {
  buildContext,
  ENRICH_SYSTEM_PROMPT,
  type StreamEvent,
} from "@capybudget/intelligence";

interface UseEnrichSessionOptions {
  budgetPath: string;
  budgetName: string;
  mcpServerPath: string;
  customInstructions?: string;
  onEnrichmentComplete?: () => void;
}

interface UseEnrichSessionReturn {
  isEnriching: boolean;
  statusText: string;
  startEnrichment: () => void;
  cancel: () => void;
}

export function useEnrichSession(
  opts: UseEnrichSessionOptions,
): UseEnrichSessionReturn {
  const [statusText, setStatusText] = useState("");

  const lifecycle = useSessionLifecycle(
    opts,
    (event: StreamEvent, ctx) => {
      switch (event.type) {
        case "content":
          for (const block of event.blocks) {
            if (block.type === "text" && block.content) {
              // Show the last line of the latest text
              const lines = block.content.trim().split("\n");
              const last = lines[lines.length - 1]?.trim();
              if (last) setStatusText(last);
            }
          }
          break;

        case "done":
          console.debug("[enrich-session] stream done");
          ctx.setIsStreaming(false);
          setStatusText("");
          ctx.optsRef.current.onEnrichmentComplete?.();
          break;

        case "error":
          console.debug("[enrich-session] stream error:", event.message);
          ctx.setIsStreaming(false);
          setStatusText("");
          break;
      }
    },
    "enrich",
  );

  const startEnrichment = useCallback(
    () => {
      if (lifecycle.isStreamingRef.current) return;
      console.debug("[enrich-session] starting enrichment");

      const o = lifecycle.optsRef.current;
      const customInstructions = o.customInstructions?.trim();
      const systemPrompt = customInstructions
        ? `${ENRICH_SYSTEM_PROMPT}\n\n## User instructions\n${customInstructions}`
        : ENRICH_SYSTEM_PROMPT;

      const session = lifecycle.createSession(systemPrompt);

      const context = buildContext({
        budgetName: o.budgetName,
        budgetPath: o.budgetPath,
      });

      const message = `${context}\nEnrich the imported transactions.`;

      lifecycle.setIsStreaming(true);
      setStatusText("");

      session.send(message).catch((err) => {
        lifecycle.dispatchStreamEvent({
          type: "error",
          message:
            err instanceof Error ? err.message : "Failed to start enrichment",
        });
      });
    },
    [lifecycle],
  );

  const cancel = useCallback(() => {
    lifecycle.cancel();
    setStatusText("");
  }, [lifecycle]);

  return { isEnriching: lifecycle.isStreaming, statusText, startEnrichment, cancel };
}
