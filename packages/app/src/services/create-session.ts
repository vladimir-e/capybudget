/**
 * Thin app wrapper around `createIntelligenceSession`. Wires the
 * factory with platform-specific adapter constructors and reads the
 * current IntelligenceConfig from the Zustand store.
 *
 * Subsequent rounds add the Anthropic and OpenAI ctors here. For
 * Round 1 only `claude-cli` is wired; if the user picks an API
 * provider, the factory returns null and the caller surfaces an
 * empty-state UX (Round 4).
 */

import {
  createIntelligenceSession,
  type SessionOptions,
  type CapySession,
} from "@capybudget/intelligence"
import { ClaudeCliSession } from "@/services/claude-cli-session"
import { useIntelligenceStore } from "@/stores/intelligence-store"

export function createSession(opts: SessionOptions): CapySession | null {
  const config = useIntelligenceStore.getState().config
  return createIntelligenceSession({
    config,
    adapters: {
      "claude-cli": (o) => new ClaudeCliSession(o),
      // anthropic: ... (Round 2)
      // openai:    ... (Round 3)
    },
    options: opts,
  })
}
