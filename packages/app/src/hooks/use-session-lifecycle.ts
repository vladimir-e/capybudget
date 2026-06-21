/**
 * Shared hook encapsulating the common session lifecycle skeleton.
 *
 * Owns:
 * - Session ref management (create, kill, cleanup on unmount)
 * - Streaming state (dual ref + React state pattern for sync access)
 * - StreamEvent dispatch from the adapter to the consumer
 * - Stable opts ref (stale-closure prevention)
 *
 * Does NOT own:
 * - Message state (each consumer manages its own)
 * - System prompt content (injected via createSession)
 * - Send logic (consumer calls session.send directly)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createSession } from "@/services/create-session";
import type {
  CapySession,
  StreamEvent,
} from "@capybudget/intelligence";
import type { BudgetRepository, FileAdapter } from "@capybudget/persistence";
import type { CurrencySettings } from "@capybudget/core";

export interface SessionLifecycleOptions {
  budgetPath: string;
  mcpServerPath: string;
  /** Budget's default currency (ISO 4217), threaded into the adapter's tool dispatch. */
  currency: string;
  /** Per-currency settings, threaded into tool dispatch for FX stamping + roll-up. */
  currencies?: Record<string, CurrencySettings>;
  /** Required by API adapters (in-process tool dispatch); ignored by Claude CLI. */
  repo?: BudgetRepository;
  /** Required by API adapters (in-process tool dispatch); ignored by Claude CLI. */
  fileAdapter?: FileAdapter;
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
  /** Inject a StreamEvent into the consumer's handler — used by callers
   *  to surface errors that originate outside the session (e.g. a
   *  failed `send()` promise, or "no session, no provider"). */
  dispatchStreamEvent: (event: StreamEvent) => void;
  cancel: () => void;
}

/**
 * @param opts            Consumer-specific options (must extend SessionLifecycleOptions)
 * @param onStreamEvent   Called for each StreamEvent the adapter emits. Receives a context
 *                        object with `setIsStreaming` and `optsRef` so the callback doesn't
 *                        need to close over the lifecycle return value. Kept fresh via ref
 *                        to avoid stale closures.
 * @param label           Log prefix for debug output (e.g. "import", "enrich", "capy")
 * @param onExit          Called only by the Claude-CLI adapter when its subprocess dies
 *                        unexpectedly (kill()/stop()/restart() suppress it). API adapters
 *                        have no process to die so they never invoke this. Use it for
 *                        recovery UX (e.g. appending a "session ended" message).
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

  // Stable refs to the latest callbacks so the dispatch callbacks never
  // close over stale state.
  const onStreamEventRef = useRef(onStreamEvent);
  const onExitRef = useRef(onExit);
  useEffect(() => {
    onStreamEventRef.current = onStreamEvent;
    onExitRef.current = onExit;
  });

  // Stable context object passed to the stream event callback
  const streamEventCtxRef = useRef<StreamEventContext<TOpts>>({ setIsStreaming, optsRef });

  const handleStreamEvent = useCallback(
    (event: StreamEvent) => {
      onStreamEventRef.current(event, streamEventCtxRef.current);
    },
    [],
  );

  const handleExit = useCallback(() => {
    console.debug(`[${label}-session] process exited`);
    setIsStreaming(false);
    onExitRef.current?.();
  }, [label, setIsStreaming]);

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
        currency: o.currency,
        currencies: o.currencies,
        onEvent: handleStreamEvent,
        onExit: handleExit,
        repo: o.repo,
        fileAdapter: o.fileAdapter,
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
    [handleStreamEvent, handleExit, label],
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
