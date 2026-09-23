/**
 * Keeps provider API keys out of the plaintext config file by routing them
 * through the OS keychain, while everything else stays in the config store.
 *
 * The keychain is never touched at boot. `load()` reads the plaintext file
 * only — provider, models, and per-provider key-presence flags — so the app
 * knows a key is configured without reading its value. The value is fetched
 * lazily via `loadSecrets()`, the single point that reads the keychain, in a
 * context the user has been warned about (see the intelligence store's
 * heads-up gate). Provider `claude-cli` or off never triggers a load.
 *
 * The composition is pure and injection-based: `createSecretAwareBackend` takes
 * a plaintext config store and a keychain, so tests drive it with fakes and the
 * app wires the Tauri-backed real ones (see lib/keychain.ts + intelligence-store).
 */

import {
  DEFAULT_INTELLIGENCE_CONFIG,
  hasProviderKey,
  type IntelligenceConfig,
  type ProviderCredentials,
} from "@capybudget/intelligence"

export type SecretProvider = "anthropic" | "openai"
export type ProviderSecrets = Record<SecretProvider, string>

const PROVIDERS: readonly SecretProvider[] = ["anthropic", "openai"]

/** Reads/writes the plaintext config (keys stripped) plus the one-time
 *  keychain heads-up flag. The Tauri-backed impl lives in intelligence-store. */
export interface ConfigStoreBackend {
  get(): Promise<IntelligenceConfig | null>
  set(config: IntelligenceConfig): Promise<void>
  getGateSeen(): Promise<boolean>
  setGateSeen(): Promise<void>
  clearGateSeen(): Promise<void>
}

/** Per-provider secret storage in the OS credential store. */
export interface Keychain {
  get(provider: SecretProvider): Promise<string | null>
  /** An empty secret removes the entry. */
  set(provider: SecretProvider, secret: string): Promise<void>
}

/**
 * The seam the app talks to. Boot reads plaintext (`load`); the actual secrets
 * are pulled from the keychain on demand (`loadSecrets`); user edits persist
 * through `save`. Unit 2 can swap the internals (e.g. a data-protection
 * keychain) without any consumer noticing.
 */
export interface SecretConfigBackend {
  /** Plaintext read — provider, models, key-presence, gate flag. Never touches
   *  the OS keychain. Null when nothing is persisted yet. */
  load(): Promise<{ config: IntelligenceConfig; gateSeen: boolean } | null>
  /** On-demand keychain read — resolves both provider secrets, migrating any
   *  inline plaintext key and persisting resolved presence flags. */
  loadSecrets(): Promise<ProviderSecrets>
  /** Persist a config change: secrets → keychain, the rest → plaintext with
   *  presence flags. A present-but-unloaded key is left untouched; only an
   *  explicit clear (`keyPresent: false`) deletes it. */
  save(config: IntelligenceConfig): Promise<void>
  /** Record that the one-time keychain heads-up has been shown. */
  markGateSeen(): Promise<void>
  /** Clear the persisted heads-up flag so it shows again on the next load —
   *  the fresh-install reset behind the dev panel. */
  clearGateSeen(): Promise<void>
}

function stripSecrets(config: IntelligenceConfig): IntelligenceConfig {
  return {
    ...config,
    anthropic: { ...config.anthropic, apiKey: "" },
    openai: { ...config.openai, apiKey: "" },
  }
}

function hasPlaintextSecrets(config: IntelligenceConfig): boolean {
  return Boolean(config.anthropic.apiKey || config.openai.apiKey)
}

/** Backfill the secret-bearing slices so a partial on-disk config can't throw
 * when we read or re-spread them. */
function normalizeSecretSlices(config: IntelligenceConfig): IntelligenceConfig {
  return {
    ...config,
    anthropic: { ...DEFAULT_INTELLIGENCE_CONFIG.anthropic, ...config.anthropic },
    openai: { ...DEFAULT_INTELLIGENCE_CONFIG.openai, ...config.openai },
  }
}

/**
 * Presence at boot, without the keychain: the persisted flag if a prior save
 * wrote one; else an inline plaintext key means present (pre-split configs);
 * else "unknown-but-likely" — the selected provider probably has a key. The
 * first `loadSecrets` resolves the truth and persists it.
 *
 * Reads the raw stored config, not a normalized one — normalization would
 * backfill `keyPresent: false` from the default and mask a genuinely-absent
 * flag, defeating the heuristic for configs written before it existed.
 */
function presenceFor(stored: IntelligenceConfig, provider: SecretProvider): boolean {
  const creds = stored[provider]
  if (creds && typeof creds.keyPresent === "boolean") return creds.keyPresent
  if (creds && creds.apiKey) return true
  return stored.provider === provider
}

/** Whether a prior save recorded a key for this provider — the explicit flag or
 *  an inline plaintext key. Unlike {@link presenceFor}, never the heuristic:
 *  used to decide whether an empty save must delete a real keychain entry. */
function wasStored(config: IntelligenceConfig | null, provider: SecretProvider): boolean {
  return config?.[provider]?.keyPresent === true || Boolean(inlineKey(config, provider))
}

/** A key known to exist but not yet read from the keychain this session. */
export function isUnloaded(creds: ProviderCredentials): boolean {
  return !creds.apiKey && creds.keyPresent === true
}

function inlineKey(config: IntelligenceConfig | null, provider: SecretProvider): string {
  return config?.[provider]?.apiKey ?? ""
}

/** The in-memory config for boot: normalized + stripped, with presence flags
 *  resolved from the raw `stored` shape (see {@link presenceFor}). */
function withResolvedPresence(stored: IntelligenceConfig): IntelligenceConfig {
  const config = normalizeSecretSlices(stored)
  return {
    ...stripSecrets(config),
    anthropic: { ...config.anthropic, apiKey: "", keyPresent: presenceFor(stored, "anthropic") },
    openai: { ...config.openai, apiKey: "", keyPresent: presenceFor(stored, "openai") },
  }
}

/** The plaintext config to persist after `save`: `persisted` keys inline (empty
 *  once safely in the keychain), presence flags from the requested config. */
function withSaved(config: IntelligenceConfig, persisted: ProviderSecrets): IntelligenceConfig {
  return {
    ...config,
    anthropic: { ...config.anthropic, apiKey: persisted.anthropic, keyPresent: hasProviderKey(config.anthropic) },
    openai: { ...config.openai, apiKey: persisted.openai, keyPresent: hasProviderKey(config.openai) },
  }
}

/** The plaintext config after `loadSecrets`: each `settled` provider stripped,
 *  its flag reflecting what the keychain actually held; the rest as they are. */
function withLoadedPresence(
  config: IntelligenceConfig,
  secrets: ProviderSecrets,
  settled: readonly SecretProvider[],
): IntelligenceConfig {
  const resolved = (provider: SecretProvider) =>
    settled.includes(provider)
      ? { ...config[provider], apiKey: "", keyPresent: Boolean(secrets[provider]) }
      : config[provider]
  return { ...config, anthropic: resolved("anthropic"), openai: resolved("openai") }
}

/**
 * Wrap a plaintext config store so provider keys route through the keychain.
 *
 * A null `keychain` (dev builds, or a platform with no credential store)
 * degrades to keeping keys inline in the plaintext file — the documented
 * on-disk fallback — while preserving the same deferred-load surface.
 */
export function createSecretAwareBackend(
  file: ConfigStoreBackend,
  keychain: Keychain | null,
): SecretConfigBackend {
  async function load() {
    const [stored, gateSeen] = await Promise.all([file.get(), file.getGateSeen()])
    if (!stored) return null
    return { config: withResolvedPresence(stored), gateSeen }
  }

  async function markGateSeen() {
    await file.setGateSeen()
  }

  async function clearGateSeen() {
    await file.clearGateSeen()
  }

  if (!keychain) {
    return {
      load,
      markGateSeen,
      clearGateSeen,
      async loadSecrets() {
        const stored = await file.get()
        if (!stored) return { anthropic: "", openai: "" }
        const config = normalizeSecretSlices(stored)
        return { anthropic: config.anthropic.apiKey, openai: config.openai.apiKey }
      },
      async save(config) {
        // No keychain — keys stay inline; presence flags still recorded so boot
        // reads them without re-deriving.
        const prev = await file.get()
        const keep = (provider: SecretProvider) =>
          isUnloaded(config[provider]) ? inlineKey(prev, provider) : config[provider].apiKey
        await file.set(withSaved(config, { anthropic: keep("anthropic"), openai: keep("openai") }))
      },
    }
  }

  // Bumped whenever `save` writes or deletes a provider's key, so a keychain
  // read that blocked on an OS prompt can tell which of its results went stale.
  const keyWrites: Record<SecretProvider, number> = { anthropic: 0, openai: 0 }

  return {
    load,
    markGateSeen,
    clearGateSeen,

    async loadSecrets() {
      const stored = await file.get()
      if (!stored) return { anthropic: "", openai: "" }
      const config = normalizeSecretSlices(stored)
      const writesBefore = { ...keyWrites }
      const settled = () => PROVIDERS.filter((p) => keyWrites[p] === writesBefore[p])

      let anthropic: string
      let openai: string
      try {
        anthropic = (await keychain.get("anthropic")) ?? config.anthropic.apiKey
        openai = (await keychain.get("openai")) ?? config.openai.apiKey
      } catch (err) {
        // Credential store denied or unreachable. An unmigrated inline key is
        // still on disk — serve it, leaving flags be. Otherwise the value is
        // genuinely unresolved: rethrow so callers tell a denied read apart from
        // an absent key instead of latching "not configured".
        if (hasPlaintextSecrets(config)) {
          return { anthropic: config.anthropic.apiKey, openai: config.openai.apiKey }
        }
        throw err
      }
      const secrets: ProviderSecrets = { anthropic, openai }

      // A config written by an older version keeps keys inline. Migrate them
      // into the keychain — keychain write first, so an interrupted run never
      // loses a key — then strip the file. The read may have waited on an OS
      // prompt, so work from the file as it is now, and never migrate over a
      // key saved meanwhile.
      const current = normalizeSecretSlices((await file.get()) ?? stored)
      const migrating = settled().filter((p) => current[p].apiKey)
      try {
        for (const provider of migrating) await keychain.set(provider, secrets[provider])
      } catch {
        // Keychain unwritable — keep the inline keys and retry next load.
        return secrets
      }

      const latest = normalizeSecretSlices((await file.get()) ?? stored)
      await file.set(withLoadedPresence(latest, secrets, settled()))
      return secrets
    },

    async save(config) {
      const prev = await file.get()
      // Persist each key independently: a partial keychain failure must leave
      // only the failed provider's key on disk, never one that reached the
      // keychain. `persisted` is what the file keeps — "" once a key is safely
      // in the keychain, the plaintext key when its write failed (fallback).
      const persisted: ProviderSecrets = {
        anthropic: config.anthropic.apiKey,
        openai: config.openai.apiKey,
      }
      for (const provider of PROVIDERS) {
        const key = config[provider].apiKey
        if (key) {
          keyWrites[provider]++
          try {
            await keychain.set(provider, key)
            persisted[provider] = ""
          } catch {
            // Keep this provider's key in the file; leave the others as they are.
          }
        } else if (isUnloaded(config[provider])) {
          persisted[provider] = inlineKey(prev, provider)
        } else {
          // An empty key deletes a real entry, but a fresh install (or a
          // provider that never had a key) must not prompt for a delete that
          // does nothing — only touch the keychain when something was stored.
          if (wasStored(prev, provider)) {
            keyWrites[provider]++
            try {
              await keychain.set(provider, "")
            } catch {
              // Best-effort delete; the stripped file below is the truth.
            }
          }
          persisted[provider] = ""
        }
      }
      await file.set(withSaved(config, persisted))
    },
  }
}
