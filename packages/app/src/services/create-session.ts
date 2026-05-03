/**
 * Thin app wrapper around `createIntelligenceSession`. Wires the
 * factory with platform-specific adapter constructors and reads the
 * current IntelligenceConfig from the Zustand store.
 *
 * Round 2 wires the Anthropic adapter alongside the existing Claude
 * CLI adapter. The OpenAI ctor lands in Round 3.
 */

import {
  createIntelligenceSession,
  type SessionOptions,
  type CapySession,
} from "@capybudget/intelligence"
import { ClaudeCliSession } from "@/services/claude-cli-session"
import { AnthropicSession } from "@/services/anthropic-session"
import { useIntelligenceStore } from "@/stores/intelligence-store"

export function createSession(opts: SessionOptions): CapySession | null {
  const config = useIntelligenceStore.getState().config
  return createIntelligenceSession({
    config,
    adapters: {
      "claude-cli": (o) => new ClaudeCliSession(o),
      anthropic: (o) => new AnthropicSession(o),
      // openai:    ... (Round 3)
    },
    options: opts,
  })
}
