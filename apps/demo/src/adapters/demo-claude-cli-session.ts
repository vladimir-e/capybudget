import type { CapySession as AppCapySession, ClaudeCliAdapterOptions } from "@capybudget/intelligence"
import { CapySession } from "./demo-capy-session"

export function createClaudeCliSession(opts: ClaudeCliAdapterOptions): AppCapySession {
  return new CapySession(opts)
}
