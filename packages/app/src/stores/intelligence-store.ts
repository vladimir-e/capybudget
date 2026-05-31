/**
 * Zustand store holding the user's IntelligenceConfig (provider choice
 * + per-provider API key + model). Persisted to disk via Tauri's
 * plugin-store as `intelligence-config.json` in the app config dir.
 *
 * Lifecycle:
 *   1. Initial state mirrors DEFAULT_INTELLIGENCE_CONFIG (provider null).
 *   2. `hydrate()` loads from disk on first call. First-run default is
 *      `null` — users explicitly pick a provider to enable AI features
 *      so they're never surprised by quota usage.
 *   3. Setters write through to disk; UI subscribers see the new value
 *      synchronously.
 *
 * The loader is mockable: tests inject a stub via `_setStoreLoaderForTests`
 * to avoid touching Tauri.
 */

import { create } from "zustand"
import { Store } from "@tauri-apps/plugin-store"
import {
  DEFAULT_INTELLIGENCE_CONFIG,
  type IntelligenceConfig,
  type IntelligenceProvider,
} from "@capybudget/intelligence"

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

/** Test-only: swap the persistence backend (no Tauri in unit tests). */
export function _setStoreLoaderForTests(
  loader: () => Promise<ConfigStoreBackend>,
): void {
  backendLoader = loader
}

/** Test-only: restore real loaders. */
export function _resetStoreForTests(): void {
  backendLoader = tauriBackend
}

// ── Store ────────────────────────────────────────────────────────

interface IntelligenceStore {
  config: IntelligenceConfig
  hydrated: boolean

  /** Load config from disk. Idempotent — repeat calls are no-ops. */
  hydrate(): Promise<void>

  setProvider(p: IntelligenceProvider): void
  setAnthropicKey(k: string): void
  setAnthropicModel(m: string): void
  setOpenAiKey(k: string): void
  setOpenAiModel(m: string): void
  setClaudeCliModel(m: string): void
}

/**
 * Backfill defaults for keys a persisted config predates. Older configs
 * were written before `claudeCli` existed; merging the default keeps
 * hydrate from handing the rest of the app a config with missing slices.
 */
function withDefaults(loaded: IntelligenceConfig): IntelligenceConfig {
  return {
    ...DEFAULT_INTELLIGENCE_CONFIG,
    ...loaded,
    claudeCli: { ...DEFAULT_INTELLIGENCE_CONFIG.claudeCli, ...loaded.claudeCli },
  }
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
      const loaded = await b.get()

      // First-run: no config on disk yet. Default to null — users
      // explicitly pick a provider so they're never surprised by
      // quota usage.
      if (!loaded) {
        const seeded: IntelligenceConfig = { ...DEFAULT_INTELLIGENCE_CONFIG }
        await b.set(seeded)
        set({ config: seeded, hydrated: true })
        return
      }

      set({ config: withDefaults(loaded), hydrated: true })
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

  setClaudeCliModel(model) {
    const cur = get().config
    const next = { ...cur, claudeCli: { ...cur.claudeCli, model } }
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
