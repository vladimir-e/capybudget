/**
 * Shared hook encapsulating the common session lifecycle skeleton.
 *
 * Owns:
 * - Session ref management (create, kill, cleanup on unmount)
 * - Streaming state (dual ref + React state pattern for sync access)
 * - Event routing: SessionEvent → parseStreamLine → StreamEvent[]
 * - Stable opts ref (stale-closure prevention)
 *
 * Does NOT own:
 * - Message state (each consumer manages its own)
 * - System prompt content (injected via createSession)
 * - Send logic (consumer calls session.send directly)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createSession } from "@/services/create-session";
import { parseStreamLine } from "@/services/capy-stream";
import type {
  CapySession,
  SessionEvent,
  StreamEvent,
} from "@capybudget/intelligence";

export interface SessionLifecycleOptions {
  budgetPath: string;
  mcpServerPath: string;
}

/** Passed to the onStreamEvent callback so it can control streaming state. */
export interface StreamEventContext<TOpts> {
  setIsStreaming: (value: boolean) => void;
  optsRef: React.RefObject<TOpts>;
}

export interface UseSessionLifecycleReturn<TOpts extends SessionLifecycleOptions> {
  sessionRef: React.RefObject<CapySession | null>;
  isStreaming: boolean;
  isStreamingRef: React.RefObject<boolean>;
  setIsStreaming: (value: boolean) => void;
  optsRef: React.RefObject<TOpts>;
  /** Returns null when intelligence is unconfigured / unsupported. */
  createSession: (systemPrompt: string) => CapySession | null;
  /** Forward a synthetic StreamEvent to the consumer's handler (e.g. for catch blocks). */
  dispatchStreamEvent: (event: StreamEvent) => void;
  cancel: () => void;
}

/**
 * @param opts            Consumer-specific options (must extend SessionLifecycleOptions)
 * @param onStreamEvent   Called for each parsed StreamEvent — consumer dispatches to its own state.
 *                        Receives a context object with `setIsStreaming` and `optsRef` so the
 *                        callback doesn't need to close over the lifecycle return value.
 *                        Kept fresh via ref to avoid stale closure issues.
 * @param label           Log prefix for debug output (e.g. "import", "enrich", "capy")
 * @param onExit          Optional callback for consumer-specific exit handling (e.g. appending
 *                        a "session ended" message). Called after the common setIsStreaming(false).
 *                        Kept fresh via ref like onStreamEvent.
 */
export function useSessionLifecycle<TOpts extends SessionLifecycleOptions>(
  opts: TOpts,
  onStreamEvent: (event: StreamEvent, ctx: StreamEventContext<TOpts>) => void,
  label: string,
  onExit?: () => void,
): UseSessionLifecycleReturn<TOpts> {
  const [isStreaming, _setIsStreaming] = useState(false);
  const isStreamingRef = useRef(false);
  const sessionRef = useRef<CapySession | null>(null);

  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  const setIsStreaming = useCallback((value: boolean) => {
    isStreamingRef.current = value;
    _setIsStreaming(value);
  }, []);

  // Stable refs to the latest callbacks so handleSessionEvent never goes stale
  const onStreamEventRef = useRef(onStreamEvent);
  const onExitRef = useRef(onExit);
  useEffect(() => {
    onStreamEventRef.current = onStreamEvent;
    onExitRef.current = onExit;
  });

  // Stable context object passed to the stream event callback
  const streamEventCtxRef = useRef<StreamEventContext<TOpts>>({ setIsStreaming, optsRef });

  const handleSessionEvent = useCallback(
    (event: SessionEvent) => {
      const ctx = streamEventCtxRef.current;
      switch (event.type) {
        case "stdout":
          for (const streamEvent of parseStreamLine(event.line)) {
            onStreamEventRef.current(streamEvent, ctx);
          }
          break;

        case "stderr":
          console.debug(`[${label}-stderr]`, event.line);
          break;

        case "exit":
          console.debug(`[${label}-session] process exited`);
          setIsStreaming(false);
          onExitRef.current?.();
          break;

        case "error":
          console.debug(`[${label}-session] session error:`, event.message);
          onStreamEventRef.current({ type: "error", message: event.message }, ctx);
          break;
      }
    },
    [label, setIsStreaming],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      sessionRef.current?.kill();
      sessionRef.current = null;
    };
  }, []);

  const createSessionFn = useCallback(
    (systemPrompt: string): CapySession | null => {
      sessionRef.current?.kill();
      const o = optsRef.current;
      const session = createSession({
        budgetPath: o.budgetPath,
        mcpServerPath: o.mcpServerPath,
        systemPrompt,
        onEvent: handleSessionEvent,
      });
      if (!session) {
        console.debug(
          `[${label}-session] no session — intelligence is unconfigured or provider unavailable`,
        );
        sessionRef.current = null;
        return null;
      }
      sessionRef.current = session;
      return session;
    },
    [handleSessionEvent, label],
  );

  const dispatchStreamEvent = useCallback(
    (event: StreamEvent) => {
      onStreamEventRef.current(event, streamEventCtxRef.current);
    },
    [],
  );

  const cancel = useCallback(() => {
    sessionRef.current?.kill();
    sessionRef.current = null;
    setIsStreaming(false);
  }, [setIsStreaming]);

  return useMemo(
    () => ({
      sessionRef,
      isStreaming,
      isStreamingRef,
      setIsStreaming,
      optsRef,
      createSession: createSessionFn,
      dispatchStreamEvent,
      cancel,
    }),
    // isStreaming is the only non-stable value; refs and useCallback results are stable
    [isStreaming, setIsStreaming, createSessionFn, dispatchStreamEvent, cancel],
  );
}
