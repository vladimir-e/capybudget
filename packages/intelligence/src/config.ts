/**
 * App-global config selecting the AI provider and its credentials.
 *
 * Persisted by the app via @tauri-apps/plugin-store. v1 keeps API
 * keys in this same blob — see specs/INTELLIGENCE_PROVIDERS.md
 * "Open Question 1" for the rationale.
 */

export type IntelligenceProvider = "claude-cli" | "anthropic" | "openai"

export interface IntelligenceConfig {
  /** null when the user has not yet picked a provider. */
  provider: IntelligenceProvider | null
  anthropic: { apiKey: string; model: string }
  openai: { apiKey: string; model: string }
}

/**
 * Default model per provider — used as the seed value in the settings
 * UI. The user can override via a custom-model field in Round 4.
 */
export const DEFAULT_INTELLIGENCE_CONFIG: IntelligenceConfig = {
  provider: null,
  anthropic: { apiKey: "", model: "claude-sonnet-4-5" },
  openai: { apiKey: "", model: "gpt-5" },
}
