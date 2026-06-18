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
 *   - config.provider is null (AI features disabled by the user)
 *   - the chosen provider's adapter wasn't injected
 *   - an API provider is selected but its API key is empty
 *
 * The hook treats null as "not configured" and surfaces empty-state
 * UI; for now callers fall back to "no session, no chat" behavior.
 */

import type { IntelligenceConfig } from "./config"
import type { CapySession } from "./session"
import type { StreamEvent } from "./types"
import { canImport, canReadPdf } from "./import/session-factory"
import type { BudgetRepository, FileAdapter } from "@capybudget/persistence"

export interface ClaudeCliAdapterOptions {
  budgetPath: string
  mcpServerPath: string
  systemPrompt: string
  /**
   * CLI `--model` value. Empty string omits the flag so the CLI uses
   * its own default; an alias (`opus` / `sonnet` / `haiku`) or full
   * model ID selects a specific model.
   */
  model: string
  onEvent: (event: StreamEvent) => void
  /**
   * Fires when the Claude CLI subprocess exits unexpectedly (not the
   * result of a deliberate `kill()` / `stop()`). Claude-CLI-only —
   * API adapters have no process to die, so the option doesn't apply.
   */
  onExit?: () => void
}

export interface ApiAdapterOptions {
  budgetPath: string
  systemPrompt: string
  apiKey: string
  model: string
  onEvent: (event: StreamEvent) => void
  repo: BudgetRepository
  fileAdapter: FileAdapter
  /** The budget's display currency (ISO 4217), threaded into the tool
   *  dispatch context so money in tool results formats in the user's
   *  currency. From `BudgetMeta.currency`. */
  currency: string
  /**
   * Whether the active provider can run the import pipeline — passed to
   * `start_import` so it gates cleanly. Always true for the API adapters that
   * support structured import; the field exists so the dispatch context carries
   * the same `canImport` truth the Import tab uses.
   */
  importSupported?: boolean
  /**
   * Whether the active provider can read PDF attachments — passed to
   * `start_import` so a PDF shared in chat is gated the same way the Import tab
   * gates a PDF drop. False for OpenAI, whose adapter swaps a PDF for a
   * placeholder note (the model would be blind to the document). Mirrors
   * `canReadPdf`.
   */
  pdfSupported?: boolean
}

/**
 * Runtime context the factory passes through to the adapter — the
 * caller-supplied "options" mirrored on each adapter. `repo` and
 * `fileAdapter` are only consumed by API adapters (in-process tool
 * dispatch); for the Claude CLI adapter they're ignored. `onExit` is
 * the inverse — Claude-CLI-only (API adapters have no process to die).
 * All optional so callsites can target a single provider cleanly.
 */
export interface SessionOptions {
  budgetPath: string
  mcpServerPath: string
  systemPrompt: string
  onEvent: (event: StreamEvent) => void
  onExit?: () => void
  repo?: BudgetRepository
  fileAdapter?: FileAdapter
  /** Budget's display currency (ISO 4217). Consumed by the API adapters'
   *  tool dispatch; the Claude CLI reads it from `budget.json` via MCP. */
  currency: string
  /** Claude-CLI-only `--model` value; ignored by API adapters. */
  claudeCliModel?: string
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
  if (provider === null) return null

  switch (provider) {
    case "claude-cli": {
      const ctor = adapters["claude-cli"]
      if (!ctor) return null
      return ctor({
        budgetPath: options.budgetPath,
        mcpServerPath: options.mcpServerPath,
        systemPrompt: options.systemPrompt,
        model: options.claudeCliModel ?? "",
        onEvent: options.onEvent,
        onExit: options.onExit,
      })
    }
    case "anthropic": {
      const ctor = adapters.anthropic
      if (!ctor) return null
      const { apiKey, model } = config.anthropic
      if (!apiKey) return null
      if (!options.repo || !options.fileAdapter) return null
      return ctor({
        budgetPath: options.budgetPath,
        systemPrompt: options.systemPrompt,
        apiKey,
        model,
        onEvent: options.onEvent,
        repo: options.repo,
        fileAdapter: options.fileAdapter,
        currency: options.currency,
        importSupported: canImport(provider),
        pdfSupported: canReadPdf(provider),
      })
    }
    case "openai": {
      const ctor = adapters.openai
      if (!ctor) return null
      const { apiKey, model } = config.openai
      if (!apiKey) return null
      if (!options.repo || !options.fileAdapter) return null
      return ctor({
        budgetPath: options.budgetPath,
        systemPrompt: options.systemPrompt,
        apiKey,
        model,
        onEvent: options.onEvent,
        repo: options.repo,
        fileAdapter: options.fileAdapter,
        currency: options.currency,
        importSupported: canImport(provider),
        pdfSupported: canReadPdf(provider),
      })
    }
  }
}
