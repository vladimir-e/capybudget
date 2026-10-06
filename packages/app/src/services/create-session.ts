import {
  createIntelligenceSession,
  type AdapterConstructors,
  type SessionOptions,
  type CapySession,
} from "@capybudget/intelligence"
import { API_ADAPTERS } from "@capybudget/intelligence/adapters"
import { createClaudeCliSession } from "@/services/claude-cli-session"
import { useIntelligenceStore } from "@/stores/intelligence-store"

declare const __MAS__: boolean

// The Claude Code CLI adapter spawns a subprocess the App Sandbox forbids —
// omit it from MAS; the shell plugin it drives is compiled out, so residual JS is inert.
const ADAPTERS: AdapterConstructors = __MAS__ ? API_ADAPTERS : { ...API_ADAPTERS, "claude-cli": createClaudeCliSession }

export function createSession(options: SessionOptions): CapySession | null {
  const config = useIntelligenceStore.getState().config
  return createIntelligenceSession({ config, adapters: ADAPTERS, options })
}
