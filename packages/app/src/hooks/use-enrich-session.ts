/**
 * React hook managing an intelligence session for the import enrichment step.
 *
 * - Creates a CapySession with the enrich-specific system prompt
 * - Sends a message with mapping context
 * - Streams events, exposes latest status text, and detects completion
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { CapySession } from "@/services/capy-session";
import { parseStreamLine } from "@/services/capy-stream";
import {
  buildContext,
  ENRICH_SYSTEM_PROMPT,
  type SessionEvent,
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
  const [isEnriching, _setIsEnriching] = useState(false);
  const [statusText, setStatusText] = useState("");
  const isEnrichingRef = useRef(false);
  const sessionRef = useRef<CapySession | null>(null);

  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  const setIsEnriching = useCallback((value: boolean) => {
    isEnrichingRef.current = value;
    _setIsEnriching(value);
    if (!value) setStatusText("");
  }, []);

  const handleStreamEvent = useCallback(
    (event: StreamEvent) => {
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
          setIsEnriching(false);
          optsRef.current.onEnrichmentComplete?.();
          break;

        case "error":
          console.debug("[enrich-session] stream error:", event.message);
          setIsEnriching(false);
          break;
      }
    },
    [setIsEnriching],
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
          console.debug("[enrich-stderr]", event.line);
          break;

        case "exit":
          console.debug("[enrich-session] process exited");
          setIsEnriching(false);
          break;

        case "error":
          console.debug("[enrich-session] session error:", event.message);
          handleStreamEvent({ type: "error", message: event.message });
          break;
      }
    },
    [handleStreamEvent, setIsEnriching],
  );

  useEffect(() => {
    return () => {
      sessionRef.current?.kill();
      sessionRef.current = null;
    };
  }, []);

  const startEnrichment = useCallback(
    () => {
      if (isEnrichingRef.current) return;
      console.debug("[enrich-session] starting enrichment");

      const o = optsRef.current;
      const customInstructions = o.customInstructions?.trim();
      const systemPrompt = customInstructions
        ? `${ENRICH_SYSTEM_PROMPT}\n\n## User instructions\n${customInstructions}`
        : ENRICH_SYSTEM_PROMPT;

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

      const message = `${context}\nEnrich the imported transactions.`;

      setIsEnriching(true);
      setStatusText("");

      sessionRef.current.send(message).catch((err) => {
        handleStreamEvent({
          type: "error",
          message:
            err instanceof Error ? err.message : "Failed to start enrichment",
        });
      });
    },
    [handleSessionEvent, handleStreamEvent, setIsEnriching],
  );

  const cancel = useCallback(() => {
    sessionRef.current?.kill();
    sessionRef.current = null;
    setIsEnriching(false);
  }, [setIsEnriching]);

  return { isEnriching, statusText, startEnrichment, cancel };
}
