/**
 * App-global config selecting the AI provider and its credentials.
 *
 * Persisted by the app via @tauri-apps/plugin-store. v1 keeps API
 * keys in this same blob — see specs/INTELLIGENCE_PROVIDERS.md
 * "Open Question 1" for the rationale.
 *
 * `"off"` is the explicit "AI features disabled" state — first-run
 * default, and what users pick when they want Capy quiet without
 * uninstalling. Pre-Phase-10.5b configs persisted `provider: null`
 * for the same meaning; the store maps `null` → `"off"` at hydrate
 * time so the on-disk format stays compatible.
 */

export type IntelligenceProvider = "off" | "claude-cli" | "anthropic" | "openai"

export interface IntelligenceConfig {
  provider: IntelligenceProvider
  anthropic: { apiKey: string; model: string }
  openai: { apiKey: string; model: string }
}

/**
 * Default model per provider — used as the seed value in the settings
 * UI. The user can override via a custom-model field in Round 4.
 */
export const DEFAULT_INTELLIGENCE_CONFIG: IntelligenceConfig = {
  provider: "off",
  anthropic: { apiKey: "", model: "claude-sonnet-4-6" },
  openai: { apiKey: "", model: "gpt-5.4" },
}
