/**
 * Zustand store holding the user's IntelligenceConfig (provider choice
 * + per-provider API key + model). Persisted to disk via Tauri's
 * plugin-store as `intelligence-config.json` in the app config dir.
 *
 * Lifecycle:
 *   1. Initial state mirrors DEFAULT_INTELLIGENCE_CONFIG (provider null).
 *   2. `hydrate()` loads the plaintext config from disk on first call —
 *      provider, models, and per-provider key-presence flags. It never
 *      touches the OS keychain, so boot pops no credential prompt.
 *   3. `ensureSecrets()` reads the keychain on demand — the first time a
 *      secret's value is actually needed (Capy opened, import started,
 *      Settings shows a key). The first-ever read is gated behind a
 *      one-time heads-up so the OS prompt is never a surprise.
 *   4. Setters write through to disk; UI subscribers see the new value
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
import {
  createSecretAwareBackend,
  type ConfigStoreBackend,
  type ProviderSecrets,
  type SecretConfigBackend,
} from "./secret-config"
import { keychainEnabled, tauriKeychain } from "@/lib/keychain"

const STORE_FILE = "intelligence-config.json"
const STORE_KEY = "config"
const GATE_SEEN_KEY = "secretGateSeen"

// ── Persistence backend (mockable) ───────────────────────────────

export type { SecretConfigBackend } from "./secret-config"

async function tauriFileStore(): Promise<ConfigStoreBackend> {
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
    async getGateSeen() {
      return (await store.get<boolean>(GATE_SEEN_KEY)) ?? false
    },
    async setGateSeen() {
      await store.set(GATE_SEEN_KEY, true)
      await store.save()
    },
  }
}

// The store file holds the config; provider API keys live in the OS keychain,
// read in on demand. See secret-config.ts.
async function tauriBackend(): Promise<SecretConfigBackend> {
  const file = await tauriFileStore()
  return createSecretAwareBackend(file, keychainEnabled() ? tauriKeychain : null)
}

let backendLoader: () => Promise<SecretConfigBackend> = tauriBackend

/** Test-only: swap the persistence backend (no Tauri in unit tests). */
export function _setStoreLoaderForTests(
  loader: () => Promise<SecretConfigBackend>,
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
  /** Whether the keychain has been read this session (secrets merged into
   *  `config`). Non-API providers count as loaded — there's nothing to read. */
  secretsLoaded: boolean
  /** Whether the one-time keychain heads-up has been shown (persisted). */
  secretGateSeen: boolean
  /** Whether the heads-up dialog is currently open. */
  secretGateOpen: boolean

  /** Load the plaintext config from disk. Idempotent — repeat calls are
   *  no-ops. Never touches the keychain. */
  hydrate(): Promise<void>

  /** Ensure the provider secrets are merged into `config`, reading the keychain
   *  once per session. The first-ever read shows the heads-up and waits for the
   *  user to allow it; dismissing leaves secrets unloaded. Resolves when secrets
   *  are in memory (or there were none to load). No-op for non-API providers. */
  ensureSecrets(): Promise<void>

  /** Heads-up "Allow": mark it seen and let the pending load proceed. */
  confirmSecretGate(): void
  /** Heads-up dismissed: close it without loading. */
  dismissSecretGate(): void

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

function mergeSecrets(
  config: IntelligenceConfig,
  secrets: ProviderSecrets,
): IntelligenceConfig {
  return {
    ...config,
    anthropic: { ...config.anthropic, apiKey: secrets.anthropic, keyPresent: Boolean(secrets.anthropic) },
    openai: { ...config.openai, apiKey: secrets.openai, keyPresent: Boolean(secrets.openai) },
  }
}

let backend: SecretConfigBackend | null = null
let hydratePromise: Promise<void> | null = null
let secretsPromise: Promise<void> | null = null
let gateResolve: ((allowed: boolean) => void) | null = null

async function loadBackend(): Promise<SecretConfigBackend> {
  if (!backend) backend = await backendLoader()
  return backend
}

async function persist(config: IntelligenceConfig): Promise<void> {
  const b = await loadBackend()
  await b.save(config)
}

export const useIntelligenceStore = create<IntelligenceStore>((set, get) => ({
  config: { ...DEFAULT_INTELLIGENCE_CONFIG },
  hydrated: false,
  secretsLoaded: false,
  secretGateSeen: false,
  secretGateOpen: false,

  async hydrate() {
    if (get().hydrated) return
    if (hydratePromise) return hydratePromise

    hydratePromise = (async () => {
      const b = await loadBackend()
      const loaded = await b.load()

      // First-run: no config on disk yet. Default to null — users
      // explicitly pick a provider so they're never surprised by
      // quota usage. The seed write skips the keychain (no keys).
      if (!loaded) {
        const seeded: IntelligenceConfig = { ...DEFAULT_INTELLIGENCE_CONFIG }
        await b.save(seeded)
        set({ config: seeded, hydrated: true })
        return
      }

      set({
        config: withDefaults(loaded.config),
        hydrated: true,
        secretGateSeen: loaded.gateSeen,
      })
    })()

    try {
      await hydratePromise
    } finally {
      hydratePromise = null
    }
  },

  async ensureSecrets() {
    if (get().secretsLoaded) return
    const provider = get().config.provider
    if (provider !== "anthropic" && provider !== "openai") {
      set({ secretsLoaded: true })
      return
    }
    if (!secretsPromise) {
      secretsPromise = (async () => {
        if (!get().secretGateSeen) {
          const allowed = await new Promise<boolean>((resolve) => {
            gateResolve = resolve
            set({ secretGateOpen: true })
          })
          if (!allowed) return
        }
        const b = await loadBackend()
        const secrets = await b.loadSecrets()
        set((s) => {
          // A key set while this read was in flight (e.g. the user typed one in
          // Settings) is authoritative — its setter already flipped
          // `secretsLoaded`, so drop this now-stale keychain result.
          if (s.secretsLoaded) return {}
          return { config: mergeSecrets(s.config, secrets), secretsLoaded: true }
        })
      })().finally(() => {
        secretsPromise = null
      })
    }
    return secretsPromise
  },

  confirmSecretGate() {
    set({ secretGateOpen: false, secretGateSeen: true })
    gateResolve?.(true)
    gateResolve = null
    void loadBackend().then((b) => b.markGateSeen())
  },

  dismissSecretGate() {
    set({ secretGateOpen: false })
    gateResolve?.(false)
    gateResolve = null
  },

  setProvider(provider) {
    const next = { ...get().config, provider }
    set({ config: next })
    void persist(next)
  },

  setAnthropicKey(apiKey) {
    const cur = get().config
    const next = { ...cur, anthropic: { ...cur.anthropic, apiKey, keyPresent: Boolean(apiKey) } }
    // The user-entered value is authoritative now — flip `secretsLoaded` so an
    // in-flight `ensureSecrets` merge skips (see its guard) rather than
    // overwriting this with a stale keychain read.
    set({ config: next, secretsLoaded: true })
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
    const next = { ...cur, openai: { ...cur.openai, apiKey, keyPresent: Boolean(apiKey) } }
    set({ config: next, secretsLoaded: true })
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
  secretsPromise = null
  gateResolve = null
  useIntelligenceStore.setState({
    config: { ...DEFAULT_INTELLIGENCE_CONFIG },
    hydrated: false,
    secretsLoaded: false,
    secretGateSeen: false,
    secretGateOpen: false,
  })
}
