/**
 * App-global config selecting the AI provider and its credentials.
 *
 * This is the in-memory shape. The app persists it via
 * @tauri-apps/plugin-store, except the provider API keys, which live in
 * the OS keychain and are merged back in on load — see
 * specs/INTELLIGENCE.md "Settings".
 *
 * `provider: null` is the "AI features disabled" state — first-run
 * default, and what users pick when they want Capy quiet without
 * uninstalling. The settings UI presents this as an "Off" radio
 * label, but on disk and in code it's `null` — the standard
 * absence value.
 */

export type IntelligenceProvider = "claude-cli" | "anthropic" | "openai" | null

/**
 * Human-facing provider names — the shared vocabulary shown in Settings and
 * the Capy header. Keyed by the real (non-null) providers; `null` ("Off") is
 * an absence, labelled at the call site.
 */
export const PROVIDER_LABELS: Record<Exclude<IntelligenceProvider, null>, string> = {
  "claude-cli": "Claude Code",
  anthropic: "Anthropic API",
  openai: "OpenAI API",
}

/**
 * Per-provider credentials. `apiKey` is populated only after the on-demand
 * secret load reads the OS keychain — at boot it's `""` even when a key exists.
 * `keyPresent` is the boot-time truth: whether a key is configured, known
 * without touching the keychain. UI gating reads presence; the actual value is
 * fetched lazily. See specs/INTELLIGENCE.md "Settings".
 */
export interface ProviderCredentials {
  apiKey: string
  model: string
  keyPresent?: boolean
}

export interface IntelligenceConfig {
  provider: IntelligenceProvider
  anthropic: ProviderCredentials
  openai: ProviderCredentials
  /** Empty model means "let the Claude Code CLI pick its default". */
  claudeCli: { model: string }
}

/**
 * Default model per provider — used as the seed value in the settings
 * UI. The user can override via a custom-model field.
 */
export const DEFAULT_INTELLIGENCE_CONFIG: IntelligenceConfig = {
  provider: null,
  anthropic: { apiKey: "", model: "claude-sonnet-5", keyPresent: false },
  openai: { apiKey: "", model: "gpt-5.5", keyPresent: false },
  claudeCli: { model: "" },
}

/**
 * Whether a provider has a key configured — the presence flag, or a
 * loaded/inline key as the fallback when the flag is absent. Gating reads
 * this so a key that hasn't been fetched from the keychain yet still counts
 * as configured; the actual `apiKey` is only non-empty once loaded.
 */
export function hasProviderKey(creds: ProviderCredentials): boolean {
  return creds.keyPresent === true || creds.apiKey !== ""
}
