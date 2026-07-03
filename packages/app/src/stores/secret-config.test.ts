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

function fakeFile(initial: IntelligenceConfig | null) {
  let value = initial
  const set = vi.fn(async (c: IntelligenceConfig) => {
    value = c
  })
  const backend: ConfigStoreBackend = {
    async get() {
      return value
    },
    set,
  }
  return { backend, set, read: () => value }
}

function fakeKeychain(
  opts: { failGet?: boolean; failSet?: boolean; failSetFor?: SecretProvider } = {},
) {
  const store = new Map<SecretProvider, string>()
  const keychain: Keychain = {
    async get(provider) {
      if (opts.failGet) throw new Error("no credential store")
      return store.has(provider) ? (store.get(provider) as string) : null
    },
    async set(provider, secret) {
      if (opts.failSet || opts.failSetFor === provider) {
        throw new Error("no credential store")
      }
      if (secret) store.set(provider, secret)
      else store.delete(provider)
    },
  }
  return { keychain, store }
}

describe("createSecretAwareBackend — no keychain (fallback)", () => {
  it("passes through to the file store unchanged", async () => {
    const file = fakeFile(config({ anthropic: "sk-file" }))
    const backend = createSecretAwareBackend(file.backend, null)

    const loaded = await backend.get()
    expect(loaded?.anthropic.apiKey).toBe("sk-file")

    await backend.set(config({ anthropic: "sk-new" }))
    // Fallback keeps the key on disk — no split.
    expect(file.read()?.anthropic.apiKey).toBe("sk-new")
  })
})

describe("createSecretAwareBackend — set", () => {
  it("writes keys to the keychain and strips them from the file", async () => {
    const file = fakeFile(null)
    const { keychain, store } = fakeKeychain()
    const backend = createSecretAwareBackend(file.backend, keychain)

    await backend.set(config({ anthropic: "sk-ant", openai: "sk-oai" }))

    expect(store.get("anthropic")).toBe("sk-ant")
    expect(store.get("openai")).toBe("sk-oai")
    expect(file.read()?.anthropic.apiKey).toBe("")
    expect(file.read()?.openai.apiKey).toBe("")
    // Non-secret config still lands in the file.
    expect(file.read()?.provider).toBe("anthropic")
  })

  it("removes the keychain entry when a key is cleared", async () => {
    const file = fakeFile(null)
    const { keychain, store } = fakeKeychain()
    store.set("anthropic", "sk-old")
    const backend = createSecretAwareBackend(file.backend, keychain)

    await backend.set(config({ anthropic: "" }))
    expect(store.has("anthropic")).toBe(false)
  })

  it("falls back to writing keys in the file when the keychain write fails", async () => {
    const file = fakeFile(null)
    const { keychain } = fakeKeychain({ failSet: true })
    const backend = createSecretAwareBackend(file.backend, keychain)

    await backend.set(config({ anthropic: "sk-ant" }))
    // Never lose the key: it stays on disk when the keychain is unusable.
    expect(file.read()?.anthropic.apiKey).toBe("sk-ant")
  })

  it("on a partial failure, only the failed provider's key stays in the file", async () => {
    const file = fakeFile(null)
    const { keychain, store } = fakeKeychain({ failSetFor: "openai" })
    const backend = createSecretAwareBackend(file.backend, keychain)

    await backend.set(config({ anthropic: "sk-ant", openai: "sk-oai" }))

    // anthropic reached the keychain and is never mirrored on disk…
    expect(store.get("anthropic")).toBe("sk-ant")
    expect(file.read()?.anthropic.apiKey).toBe("")
    // …only the failed provider falls back to plaintext.
    expect(file.read()?.openai.apiKey).toBe("sk-oai")
  })
})

describe("createSecretAwareBackend — get", () => {
  it("returns null when the file is empty", async () => {
    const file = fakeFile(null)
    const { keychain } = fakeKeychain()
    expect(await createSecretAwareBackend(file.backend, keychain).get()).toBeNull()
  })

  it("overlays keychain keys onto a stripped file", async () => {
    const file = fakeFile(config({ anthropic: "", openai: "" }))
    const { keychain, store } = fakeKeychain()
    store.set("anthropic", "sk-ant")
    store.set("openai", "sk-oai")
    const backend = createSecretAwareBackend(file.backend, keychain)

    const loaded = await backend.get()
    expect(loaded?.anthropic.apiKey).toBe("sk-ant")
    expect(loaded?.openai.apiKey).toBe("sk-oai")
    // A stripped file needs no migration write.
    expect(file.set).not.toHaveBeenCalled()
  })

  it("serves the on-disk copy when the keychain is unreachable", async () => {
    const file = fakeFile(config({ anthropic: "sk-file" }))
    const { keychain } = fakeKeychain({ failGet: true })
    const backend = createSecretAwareBackend(file.backend, keychain)

    const loaded = await backend.get()
    expect(loaded?.anthropic.apiKey).toBe("sk-file")
  })
})

describe("createSecretAwareBackend — migration", () => {
  it("moves plaintext keys into the keychain and strips the file", async () => {
    const file = fakeFile(config({ anthropic: "sk-ant", openai: "sk-oai" }))
    const { keychain, store } = fakeKeychain()
    const backend = createSecretAwareBackend(file.backend, keychain)

    const loaded = await backend.get()

    // Keys returned in-memory for consumers…
    expect(loaded?.anthropic.apiKey).toBe("sk-ant")
    expect(loaded?.openai.apiKey).toBe("sk-oai")
    // …now live in the keychain…
    expect(store.get("anthropic")).toBe("sk-ant")
    expect(store.get("openai")).toBe("sk-oai")
    // …and no longer on disk.
    expect(file.read()?.anthropic.apiKey).toBe("")
    expect(file.read()?.openai.apiKey).toBe("")
  })

  it("is idempotent — a second load does not rewrite the file", async () => {
    const file = fakeFile(config({ anthropic: "sk-ant" }))
    const { keychain } = fakeKeychain()
    const backend = createSecretAwareBackend(file.backend, keychain)

    await backend.get()
    const writesAfterFirst = file.set.mock.calls.length
    await backend.get()
    expect(file.set.mock.calls.length).toBe(writesAfterFirst)
  })

  it("keeps the plaintext file intact if the keychain write is interrupted", async () => {
    const file = fakeFile(config({ anthropic: "sk-ant" }))
    const { keychain } = fakeKeychain({ failSet: true })
    const backend = createSecretAwareBackend(file.backend, keychain)

    const loaded = await backend.get()
    // Consumers still get the key…
    expect(loaded?.anthropic.apiKey).toBe("sk-ant")
    // …and it is not dropped from disk before the keychain confirms.
    expect(file.read()?.anthropic.apiKey).toBe("sk-ant")
  })

  it("prefers the keychain key over a stale one left in the file", async () => {
    const file = fakeFile(config({ anthropic: "sk-stale" }))
    const { keychain, store } = fakeKeychain()
    store.set("anthropic", "sk-fresh")
    const backend = createSecretAwareBackend(file.backend, keychain)

    const loaded = await backend.get()
    expect(loaded?.anthropic.apiKey).toBe("sk-fresh")
    // The stale copy is scrubbed from disk.
    expect(file.read()?.anthropic.apiKey).toBe("")
  })
})
