import { describe, it, expect, vi } from "vitest"
import {
  DEFAULT_INTELLIGENCE_CONFIG,
  type IntelligenceConfig,
} from "@capybudget/intelligence"
import {
  createSecretAwareBackend,
  type ConfigStoreBackend,
  type Keychain,
  type SecretProvider,
} from "./secret-config"

function config(keys: { anthropic?: string; openai?: string } = {}): IntelligenceConfig {
  return {
    ...DEFAULT_INTELLIGENCE_CONFIG,
    provider: "anthropic",
    anthropic: { ...DEFAULT_INTELLIGENCE_CONFIG.anthropic, apiKey: keys.anthropic ?? "" },
    openai: { ...DEFAULT_INTELLIGENCE_CONFIG.openai, apiKey: keys.openai ?? "" },
  }
}

/** A config written before presence flags existed — no `keyPresent` on disk. */
function legacyConfig(keys: { anthropic?: string; openai?: string } = {}): IntelligenceConfig {
  return {
    provider: "anthropic",
    anthropic: { apiKey: keys.anthropic ?? "", model: "claude" },
    openai: { apiKey: keys.openai ?? "", model: "gpt" },
    claudeCli: { model: "" },
  }
}

function fakeFile(initial: IntelligenceConfig | null) {
  let value = initial
  let gateSeen = false
  const set = vi.fn(async (c: IntelligenceConfig) => {
    value = c
  })
  const backend: ConfigStoreBackend = {
    async get() {
      return value
    },
    set,
    async getGateSeen() {
      return gateSeen
    },
    async setGateSeen() {
      gateSeen = true
    },
  }
  return { backend, set, read: () => value, gateSeen: () => gateSeen }
}

function fakeKeychain(
  opts: { failGet?: boolean; failSet?: boolean; failSetFor?: SecretProvider } = {},
) {
  const store = new Map<SecretProvider, string>()
  const keychain: Keychain = {
    get: vi.fn(async (provider: SecretProvider) => {
      if (opts.failGet) throw new Error("no credential store")
      return store.has(provider) ? (store.get(provider) as string) : null
    }),
    set: vi.fn(async (provider: SecretProvider, secret: string) => {
      if (opts.failSet || opts.failSetFor === provider) {
        throw new Error("no credential store")
      }
      if (secret) store.set(provider, secret)
      else store.delete(provider)
    }),
  }
  return { keychain, store }
}

describe("createSecretAwareBackend — no keychain (fallback)", () => {
  it("keeps keys inline in the file, with presence flags", async () => {
    const file = fakeFile(null)
    const backend = createSecretAwareBackend(file.backend, null)

    await backend.save(config({ anthropic: "sk-new" }))
    expect(file.read()?.anthropic.apiKey).toBe("sk-new")
    expect(file.read()?.anthropic.keyPresent).toBe(true)

    // load strips the value from memory but reports presence…
    const loaded = await backend.load()
    expect(loaded?.config.anthropic.apiKey).toBe("")
    expect(loaded?.config.anthropic.keyPresent).toBe(true)
    // …and loadSecrets restores it from the file (no keychain to read).
    expect((await backend.loadSecrets()).anthropic).toBe("sk-new")
  })
})

describe("createSecretAwareBackend — load", () => {
  it("returns null when the file is empty", async () => {
    const file = fakeFile(null)
    const { keychain } = fakeKeychain()
    expect(await createSecretAwareBackend(file.backend, keychain).load()).toBeNull()
  })

  it("never reads the keychain", async () => {
    const file = fakeFile(config({ anthropic: "" }))
    const { keychain } = fakeKeychain()
    await createSecretAwareBackend(file.backend, keychain).load()
    expect(keychain.get).not.toHaveBeenCalled()
  })

  it("strips secrets and surfaces the persisted presence flag", async () => {
    const stored = { ...config(), anthropic: { apiKey: "", model: "m", keyPresent: true } }
    const file = fakeFile(stored)
    const { keychain } = fakeKeychain()

    const loaded = await createSecretAwareBackend(file.backend, keychain).load()
    expect(loaded?.config.anthropic.apiKey).toBe("")
    expect(loaded?.config.anthropic.keyPresent).toBe(true)
  })

  it("treats an inline plaintext key (pre-split) as present, stripped in memory", async () => {
    const file = fakeFile(legacyConfig({ anthropic: "sk-inline" }))
    const { keychain } = fakeKeychain()

    const loaded = await createSecretAwareBackend(file.backend, keychain).load()
    expect(loaded?.config.anthropic.keyPresent).toBe(true)
    expect(loaded?.config.anthropic.apiKey).toBe("")
  })

  it("assumes the selected provider likely has a key when no flag exists", async () => {
    // Config with no presence flags yet: unknown-but-likely for the active
    // provider, false for the other.
    const file = fakeFile(legacyConfig())
    const { keychain } = fakeKeychain()

    const loaded = await createSecretAwareBackend(file.backend, keychain).load()
    expect(loaded?.config.anthropic.keyPresent).toBe(true)
    expect(loaded?.config.openai.keyPresent).toBe(false)
  })

  it("carries the gate-seen flag through", async () => {
    const file = fakeFile(config())
    const { keychain } = fakeKeychain()
    const backend = createSecretAwareBackend(file.backend, keychain)
    await backend.markGateSeen()

    expect((await backend.load())?.gateSeen).toBe(true)
  })
})

describe("createSecretAwareBackend — loadSecrets", () => {
  it("overlays keychain keys and persists resolved presence flags", async () => {
    const file = fakeFile(config())
    const { keychain, store } = fakeKeychain()
    store.set("anthropic", "sk-ant")
    const backend = createSecretAwareBackend(file.backend, keychain)

    const secrets = await backend.loadSecrets()
    expect(secrets.anthropic).toBe("sk-ant")
    expect(secrets.openai).toBe("")
    // The unknown-but-likely heuristic resolves to the truth on disk.
    expect(file.read()?.anthropic.keyPresent).toBe(true)
    expect(file.read()?.openai.keyPresent).toBe(false)
  })

  it("migrates an inline plaintext key into the keychain and strips the file", async () => {
    const file = fakeFile(config({ anthropic: "sk-ant" }))
    const { keychain, store } = fakeKeychain()
    const backend = createSecretAwareBackend(file.backend, keychain)

    const secrets = await backend.loadSecrets()
    expect(secrets.anthropic).toBe("sk-ant")
    expect(store.get("anthropic")).toBe("sk-ant")
    expect(file.read()?.anthropic.apiKey).toBe("")
    expect(file.read()?.anthropic.keyPresent).toBe(true)
  })

  it("prefers the keychain key over a stale one left in the file", async () => {
    const file = fakeFile(config({ anthropic: "sk-stale" }))
    const { keychain, store } = fakeKeychain()
    store.set("anthropic", "sk-fresh")
    const backend = createSecretAwareBackend(file.backend, keychain)

    expect((await backend.loadSecrets()).anthropic).toBe("sk-fresh")
    expect(file.read()?.anthropic.apiKey).toBe("")
  })

  it("serves the on-disk copy and leaves the file when the keychain is unreachable", async () => {
    const file = fakeFile(config({ anthropic: "sk-file" }))
    const { keychain } = fakeKeychain({ failGet: true })
    const backend = createSecretAwareBackend(file.backend, keychain)

    expect((await backend.loadSecrets()).anthropic).toBe("sk-file")
    // Not stripped — the key must not be lost when the keychain is down.
    expect(file.read()?.anthropic.apiKey).toBe("sk-file")
  })

  it("throws when the read fails and there's nothing on disk to fall back to", async () => {
    // Steady state: key lives in the keychain, file stripped. A denied read has
    // no inline copy to serve, so it must surface as an error (not empty) —
    // callers distinguish a denied read from an absent key.
    const stored = { ...config(), anthropic: { apiKey: "", model: "m", keyPresent: true } }
    const file = fakeFile(stored)
    const { keychain } = fakeKeychain({ failGet: true })
    const backend = createSecretAwareBackend(file.backend, keychain)

    await expect(backend.loadSecrets()).rejects.toThrow()
  })

  it("keeps inline keys when the migration write fails", async () => {
    const file = fakeFile(config({ anthropic: "sk-ant" }))
    const { keychain } = fakeKeychain({ failSet: true })
    const backend = createSecretAwareBackend(file.backend, keychain)

    expect((await backend.loadSecrets()).anthropic).toBe("sk-ant")
    expect(file.read()?.anthropic.apiKey).toBe("sk-ant")
  })
})

describe("createSecretAwareBackend — save", () => {
  it("writes keys to the keychain and strips them from the file", async () => {
    const file = fakeFile(null)
    const { keychain, store } = fakeKeychain()
    const backend = createSecretAwareBackend(file.backend, keychain)

    await backend.save(config({ anthropic: "sk-ant", openai: "sk-oai" }))

    expect(store.get("anthropic")).toBe("sk-ant")
    expect(store.get("openai")).toBe("sk-oai")
    expect(file.read()?.anthropic.apiKey).toBe("")
    expect(file.read()?.anthropic.keyPresent).toBe(true)
    expect(file.read()?.openai.keyPresent).toBe(true)
    expect(file.read()?.provider).toBe("anthropic")
  })

  it("never touches the keychain when saving empty keys on a fresh install", async () => {
    const file = fakeFile(null)
    const { keychain } = fakeKeychain()
    const backend = createSecretAwareBackend(file.backend, keychain)

    await backend.save({ ...DEFAULT_INTELLIGENCE_CONFIG })

    expect(keychain.set).not.toHaveBeenCalled()
    expect(file.read()?.anthropic.keyPresent).toBe(false)
  })

  it("deletes the keychain entry when a previously-stored key is cleared", async () => {
    const file = fakeFile({ ...config(), anthropic: { apiKey: "", model: "m", keyPresent: true } })
    const { keychain, store } = fakeKeychain()
    store.set("anthropic", "sk-old")
    const backend = createSecretAwareBackend(file.backend, keychain)

    await backend.save(config({ anthropic: "" }))
    expect(store.has("anthropic")).toBe(false)
    expect(file.read()?.anthropic.keyPresent).toBe(false)
  })

  it("falls back to writing keys in the file when the keychain write fails", async () => {
    const file = fakeFile(null)
    const { keychain } = fakeKeychain({ failSet: true })
    const backend = createSecretAwareBackend(file.backend, keychain)

    await backend.save(config({ anthropic: "sk-ant" }))
    expect(file.read()?.anthropic.apiKey).toBe("sk-ant")
    expect(file.read()?.anthropic.keyPresent).toBe(true)
  })

  it("on a partial failure, only the failed provider's key stays in the file", async () => {
    const file = fakeFile(null)
    const { keychain, store } = fakeKeychain({ failSetFor: "openai" })
    const backend = createSecretAwareBackend(file.backend, keychain)

    await backend.save(config({ anthropic: "sk-ant", openai: "sk-oai" }))

    expect(store.get("anthropic")).toBe("sk-ant")
    expect(file.read()?.anthropic.apiKey).toBe("")
    expect(file.read()?.openai.apiKey).toBe("sk-oai")
  })
})
