/**
 * React hook managing an intelligence session for the import enrichment step.
 *
 * - Creates a CapySession with the enrich-specific system prompt
 * - Sends a message with mapping context
 * - Streams events and detects completion
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
  startEnrichment: (mappingContext: string) => void;
  cancel: () => void;
}

export function useEnrichSession(
  opts: UseEnrichSessionOptions,
): UseEnrichSessionReturn {
  const [isEnriching, _setIsEnriching] = useState(false);
  const isEnrichingRef = useRef(false);
  const sessionRef = useRef<CapySession | null>(null);

  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  const setIsEnriching = useCallback((value: boolean) => {
    isEnrichingRef.current = value;
    _setIsEnriching(value);
  }, []);

  const handleStreamEvent = useCallback(
    (event: StreamEvent) => {
      switch (event.type) {
        case "done":
          console.log("[enrich-session] stream done");
          setIsEnriching(false);
          optsRef.current.onEnrichmentComplete?.();
          break;

        case "error":
          console.log("[enrich-session] stream error:", event.message);
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
          console.log("[enrich-session] process exited");
          setIsEnriching(false);
          break;

        case "error":
          console.log("[enrich-session] session error:", event.message);
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
    (mappingContext: string) => {
      if (isEnrichingRef.current) return;
      console.log("[enrich-session] starting enrichment");

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

      const message = `${context}\nEnrich the imported transactions.\n\n${mappingContext}`;

      setIsEnriching(true);

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

  return { isEnriching, startEnrichment, cancel };
}
