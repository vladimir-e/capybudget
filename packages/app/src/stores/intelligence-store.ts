/**
 * Zustand store holding the user's IntelligenceConfig (provider choice
 * + per-provider API key + model). Persisted to disk via Tauri's
 * plugin-store as `intelligence-config.json` in the app config dir.
 *
 * Lifecycle:
 *   1. Initial state mirrors DEFAULT_INTELLIGENCE_CONFIG (provider null).
 *   2. `hydrate()` loads from disk on first call. If no file exists yet
 *      AND Claude Code is detected on the host, provider auto-defaults
 *      to "claude-cli" and is persisted — so existing devs running the
 *      app don't see a regression in Round 1.
 *   3. Setters write through to disk; UI subscribers see the new value
 *      synchronously.
 *
 * The loader is mockable: tests inject a stub via `_setStoreLoaderForTests`
 * and a stub Claude detector via `_setClaudeDetectorForTests` to avoid
 * touching Tauri at all.
 */

import { create } from "zustand"
import { Store } from "@tauri-apps/plugin-store"
import {
  DEFAULT_INTELLIGENCE_CONFIG,
  type IntelligenceConfig,
  type IntelligenceProvider,
} from "@capybudget/intelligence"
import { detectClaudeCli } from "@/services/claude-cli-detect"

const STORE_FILE = "intelligence-config.json"
const STORE_KEY = "config"

// ── Persistence backend (mockable) ───────────────────────────────

export interface ConfigStoreBackend {
  get(): Promise<IntelligenceConfig | null>
  set(config: IntelligenceConfig): Promise<void>
}

async function tauriBackend(): Promise<ConfigStoreBackend> {
  const store = await Store.load(STORE_FILE)
  return {
    async get() {
      const value = await store.get<IntelligenceConfig>(STORE_KEY)
      return value ?? null
    },
    async set(config) {
      await store.set(STORE_KEY, config)
      await store.save()
    },
  }
}

let backendLoader: () => Promise<ConfigStoreBackend> = tauriBackend
let claudeDetector: () => Promise<boolean> = detectClaudeCli

/** Test-only: swap the persistence backend (no Tauri in unit tests). */
export function _setStoreLoaderForTests(
  loader: () => Promise<ConfigStoreBackend>,
): void {
  backendLoader = loader
}

/** Test-only: swap the Claude CLI detector. */
export function _setClaudeDetectorForTests(
  detector: () => Promise<boolean>,
): void {
  claudeDetector = detector
}

/** Test-only: restore real loaders. */
export function _resetStoreForTests(): void {
  backendLoader = tauriBackend
  claudeDetector = detectClaudeCli
}

// ── Store ────────────────────────────────────────────────────────

interface IntelligenceStore {
  config: IntelligenceConfig
  hydrated: boolean

  /** Load config from disk. Idempotent — repeat calls are no-ops. */
  hydrate(): Promise<void>

  setProvider(p: IntelligenceProvider | null): void
  setAnthropicKey(k: string): void
  setAnthropicModel(m: string): void
  setOpenAiKey(k: string): void
  setOpenAiModel(m: string): void
}

let backend: ConfigStoreBackend | null = null
let hydratePromise: Promise<void> | null = null

async function loadBackend(): Promise<ConfigStoreBackend> {
  if (!backend) backend = await backendLoader()
  return backend
}

async function persist(config: IntelligenceConfig): Promise<void> {
  const b = await loadBackend()
  await b.set(config)
}

export const useIntelligenceStore = create<IntelligenceStore>((set, get) => ({
  config: { ...DEFAULT_INTELLIGENCE_CONFIG },
  hydrated: false,

  async hydrate() {
    if (get().hydrated) return
    if (hydratePromise) return hydratePromise

    hydratePromise = (async () => {
      const b = await loadBackend()
      let loaded = await b.get()

      // First-run: no config on disk yet. If Claude Code is installed,
      // default to claude-cli so existing devs don't see a regression.
      if (!loaded) {
        const hasClaude = await claudeDetector().catch(() => false)
        loaded = {
          ...DEFAULT_INTELLIGENCE_CONFIG,
          provider: hasClaude ? "claude-cli" : null,
        }
        await b.set(loaded)
      }

      set({ config: loaded, hydrated: true })
    })()

    try {
      await hydratePromise
    } finally {
      hydratePromise = null
    }
  },

  setProvider(provider) {
    const next = { ...get().config, provider }
    set({ config: next })
    void persist(next)
  },

  setAnthropicKey(apiKey) {
    const cur = get().config
    const next = { ...cur, anthropic: { ...cur.anthropic, apiKey } }
    set({ config: next })
    void persist(next)
  },

  setAnthropicModel(model) {
    const cur = get().config
    const next = { ...cur, anthropic: { ...cur.anthropic, model } }
    set({ config: next })
    void persist(next)
  },

  setOpenAiKey(apiKey) {
    const cur = get().config
    const next = { ...cur, openai: { ...cur.openai, apiKey } }
    set({ config: next })
    void persist(next)
  },

  setOpenAiModel(model) {
    const cur = get().config
    const next = { ...cur, openai: { ...cur.openai, model } }
    set({ config: next })
    void persist(next)
  },
}))

/** Test-only: reset the in-memory store + cached backend. */
export function _resetIntelligenceStoreForTests(): void {
  backend = null
  hydratePromise = null
  useIntelligenceStore.setState({
    config: { ...DEFAULT_INTELLIGENCE_CONFIG },
    hydrated: false,
  })
}
