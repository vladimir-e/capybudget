/**
 * Thin app wrapper around `createIntelligenceSession`. Wires the
 * factory with platform-specific adapter constructors and reads the
 * current IntelligenceConfig from the Zustand store.
 *
 * Round 3 lights up the OpenAI adapter alongside Claude CLI and
 * Anthropic. Each adapter ctor is one line — the factory does all
 * the routing.
 */

import {
  createIntelligenceSession,
  type AdapterConstructors,
  type SessionOptions,
  type CapySession,
} from "@capybudget/intelligence"
import { AnthropicSession, OpenAiSession } from "@capybudget/intelligence/adapters"
import { ClaudeCliSession } from "@/services/claude-cli-session"
import { useIntelligenceStore } from "@/stores/intelligence-store"

declare const __MAS__: boolean

export function createSession(opts: SessionOptions): CapySession | null {
  const config = useIntelligenceStore.getState().config
  const adapters: AdapterConstructors = {
    anthropic: (o) => new AnthropicSession(o),
    openai: (o) => new OpenAiSession(o),
  }
  // The Claude Code CLI adapter spawns a subprocess, which the App Sandbox
  // forbids — omit it from the MAS build so the spawn code tree-shakes out.
  if (!__MAS__) {
    adapters["claude-cli"] = (o) => new ClaudeCliSession(o)
  }
  return createIntelligenceSession({
    config,
    adapters,
    options: { ...opts, claudeCliModel: config.claudeCli.model },
  })
}
