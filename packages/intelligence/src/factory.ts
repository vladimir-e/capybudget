/**
 * Intelligence session factory.
 *
 * Picks the right adapter based on `config.provider` and constructs it
 * via app-injected constructors. The factory itself is platform-agnostic:
 * the app wraps it with platform-specific adapter constructors (Tauri
 * shell for Claude CLI, fetch for the API adapters) — that keeps this
 * package free of Tauri / SDK deps.
 *
 * Returns null when:
 *   - config.provider is null (unconfigured)
 *   - the chosen provider's adapter wasn't injected
 *   - an API provider is selected but its API key is empty
 *
 * The hook treats null as "not configured" and surfaces empty-state
 * UI in a later round; for now callers fall back to "no session, no
 * chat" behavior.
 */

import type { IntelligenceConfig } from "./config"
import type { CapySession, SessionEvent } from "./session"
import type { BudgetRepository, FileAdapter } from "@capybudget/persistence"

export interface ClaudeCliAdapterOptions {
  budgetPath: string
  mcpServerPath: string
  systemPrompt: string
  onEvent: (event: SessionEvent) => void
}

export interface ApiAdapterOptions {
  budgetPath: string
  systemPrompt: string
  apiKey: string
  model: string
  onEvent: (event: SessionEvent) => void
  repo: BudgetRepository
  fileAdapter: FileAdapter
}

/**
 * Runtime context the factory passes through to the adapter — the
 * caller-supplied "options" mirrored on each adapter.
 */
export interface SessionOptions {
  budgetPath: string
  mcpServerPath: string
  systemPrompt: string
  onEvent: (event: SessionEvent) => void
  repo: BudgetRepository
  fileAdapter: FileAdapter
}

export interface AdapterConstructors {
  "claude-cli"?: (opts: ClaudeCliAdapterOptions) => CapySession
  anthropic?: (opts: ApiAdapterOptions) => CapySession
  openai?: (opts: ApiAdapterOptions) => CapySession
}

export interface CreateSessionDeps {
  config: IntelligenceConfig
  adapters: AdapterConstructors
  options: SessionOptions
}

export function createIntelligenceSession(
  deps: CreateSessionDeps,
): CapySession | null {
  const { config, adapters, options } = deps
  const provider = config.provider
  if (!provider) return null

  switch (provider) {
    case "claude-cli": {
      const ctor = adapters["claude-cli"]
      if (!ctor) return null
      return ctor({
        budgetPath: options.budgetPath,
        mcpServerPath: options.mcpServerPath,
        systemPrompt: options.systemPrompt,
        onEvent: options.onEvent,
      })
    }
    case "anthropic": {
      const ctor = adapters.anthropic
      if (!ctor) return null
      const { apiKey, model } = config.anthropic
      if (!apiKey) return null
      return ctor({
        budgetPath: options.budgetPath,
        systemPrompt: options.systemPrompt,
        apiKey,
        model,
        onEvent: options.onEvent,
        repo: options.repo,
        fileAdapter: options.fileAdapter,
      })
    }
    case "openai": {
      const ctor = adapters.openai
      if (!ctor) return null
      const { apiKey, model } = config.openai
      if (!apiKey) return null
      return ctor({
        budgetPath: options.budgetPath,
        systemPrompt: options.systemPrompt,
        apiKey,
        model,
        onEvent: options.onEvent,
        repo: options.repo,
        fileAdapter: options.fileAdapter,
      })
    }
  }
}
