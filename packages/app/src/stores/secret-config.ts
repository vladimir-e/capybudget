/**
 * Keeps provider API keys out of the plaintext config file by routing them
 * through the OS keychain, while everything else stays in the config store.
 * Consumers still read and write a whole IntelligenceConfig — where the key
 * physically lives is this module's concern, not theirs.
 *
 * The composition is pure and injection-based: `createSecretAwareBackend` takes
 * a plaintext config store and a keychain, so tests drive it with fakes and the
 * app wires the Tauri-backed real ones (see lib/keychain.ts + intelligence-store).
 */

import type { IntelligenceConfig } from "@capybudget/intelligence"

export type SecretProvider = "anthropic" | "openai"

/** Reads/writes the whole IntelligenceConfig (keys included) as one blob. */
export interface ConfigStoreBackend {
  get(): Promise<IntelligenceConfig | null>
  set(config: IntelligenceConfig): Promise<void>
}

/** Per-provider secret storage in the OS credential store. */
export interface Keychain {
  get(provider: SecretProvider): Promise<string | null>
  /** An empty secret removes the entry. */
  set(provider: SecretProvider, secret: string): Promise<void>
}

function stripSecrets(config: IntelligenceConfig): IntelligenceConfig {
  return {
    ...config,
    anthropic: { ...config.anthropic, apiKey: "" },
    openai: { ...config.openai, apiKey: "" },
  }
}

function withSecrets(
  config: IntelligenceConfig,
  anthropic: string,
  openai: string,
): IntelligenceConfig {
  return {
    ...config,
    anthropic: { ...config.anthropic, apiKey: anthropic },
    openai: { ...config.openai, apiKey: openai },
  }
}

function hasPlaintextSecrets(config: IntelligenceConfig): boolean {
  return Boolean(config.anthropic.apiKey || config.openai.apiKey)
}

/**
 * Wrap a plaintext config store so provider keys are read from / written to the
 * keychain, leaving the rest of the config in `file`. On read, a config written
 * by an older version (keys still inline) is migrated into the keychain and the
 * file rewritten without them — keychain first, so an interrupted run never
 * loses a key. A null `keychain` (dev builds, or a platform with no credential
 * store) degrades to `file` unchanged: the documented on-disk fallback.
 */
export function createSecretAwareBackend(
  file: ConfigStoreBackend,
  keychain: Keychain | null,
): ConfigStoreBackend {
  if (!keychain) return file

  return {
    async get() {
      const stored = await file.get()
      if (!stored) return null

      let anthropic: string
      let openai: string
      try {
        anthropic = (await keychain.get("anthropic")) ?? stored.anthropic.apiKey
        openai = (await keychain.get("openai")) ?? stored.openai.apiKey
      } catch {
        // Credential store unreachable at runtime — serve the on-disk copy.
        return stored
      }

      if (hasPlaintextSecrets(stored)) {
        try {
          await keychain.set("anthropic", anthropic)
          await keychain.set("openai", openai)
          await file.set(stripSecrets(stored))
        } catch {
          // Migration write failed; leave the file intact and retry next boot.
        }
      }

      return withSecrets(stored, anthropic, openai)
    },

    async set(config) {
      try {
        await keychain.set("anthropic", config.anthropic.apiKey)
        await keychain.set("openai", config.openai.apiKey)
        await file.set(stripSecrets(config))
      } catch {
        // No usable keychain — keep the keys in the file (fallback).
        await file.set(config)
      }
    },
  }
}
