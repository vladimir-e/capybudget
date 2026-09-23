import { describe, it, expect, beforeEach, vi } from "vitest"
import { DEFAULT_INTELLIGENCE_CONFIG, type IntelligenceConfig } from "@capybudget/intelligence"

const { storeMock } = vi.hoisted(() => ({
  storeMock: {
    get: vi.fn<() => Promise<unknown>>(),
    set: vi.fn<(value: unknown) => Promise<void>>(),
    save: vi.fn<() => Promise<void>>(),
  },
}))

vi.mock("@tauri-apps/plugin-store", () => ({
  Store: { load: vi.fn(async () => storeMock) },
}))

import {
  useIntelligenceStore,
  _resetIntelligenceStoreForTests,
  _setStoreLoaderForTests,
  _resetStoreForTests,
  needsSecrets,
  type SecretConfigBackend,
} from "./intelligence-store"
import { createSecretAwareBackend, type SecretProvider } from "./secret-config"

beforeEach(() => {
  storeMock.get.mockReset()
  storeMock.set.mockReset().mockResolvedValue(undefined)
  storeMock.save.mockReset().mockResolvedValue(undefined)
  _resetStoreForTests()
  _resetIntelligenceStoreForTests()
})

type FakeBackend = SecretConfigBackend & {
  load: ReturnType<typeof vi.fn>
  loadSecrets: ReturnType<typeof vi.fn>
  save: ReturnType<typeof vi.fn>
  markGateSeen: ReturnType<typeof vi.fn>
  clearGateSeen: ReturnType<typeof vi.fn>
}

function makeBackend(
  loaded: { config: IntelligenceConfig; gateSeen: boolean } | null,
  secrets: { anthropic: string; openai: string } = { anthropic: "", openai: "" },
): FakeBackend {
  return {
    load: vi.fn(async () => loaded),
    loadSecrets: vi.fn(async () => secrets),
    save: vi.fn(async () => undefined),
    markGateSeen: vi.fn(async () => undefined),
    clearGateSeen: vi.fn(async () => undefined),
  }
}

function stored(config: Partial<IntelligenceConfig>, gateSeen = false) {
  return { config: { ...DEFAULT_INTELLIGENCE_CONFIG, ...config }, gateSeen }
}

describe("useIntelligenceStore.hydrate", () => {
  it("loads the plaintext config without reading secrets", async () => {
    const backend = makeBackend(
      stored({
        provider: "anthropic",
        anthropic: { apiKey: "", model: "claude-sonnet-4-6", keyPresent: true },
      }),
    )
    _setStoreLoaderForTests(async () => backend)

    await useIntelligenceStore.getState().hydrate()
    const state = useIntelligenceStore.getState()
    expect(state.hydrated).toBe(true)
    expect(state.config.provider).toBe("anthropic")
    // Boot never reads the keychain — the value stays empty, presence is known.
    expect(state.config.anthropic.apiKey).toBe("")
    expect(state.config.anthropic.keyPresent).toBe(true)
    expect(needsSecrets(state.config)).toBe(true)
    expect(backend.loadSecrets).not.toHaveBeenCalled()
  })

  it("seeds provider null on first run and persists it", async () => {
    const backend = makeBackend(null)
    _setStoreLoaderForTests(async () => backend)

    await useIntelligenceStore.getState().hydrate()
    const state = useIntelligenceStore.getState()
    expect(state.config.provider).toBeNull()
    expect(backend.save).toHaveBeenCalledWith(
      expect.objectContaining({ provider: null }),
    )
  })

  it("backfills the claudeCli default for configs persisted before it existed", async () => {
    const backend = makeBackend({
      config: {
        provider: "anthropic",
        anthropic: { apiKey: "", model: "claude-sonnet-4-6" },
        openai: { apiKey: "", model: "gpt-5.4" },
      } as IntelligenceConfig,
      gateSeen: false,
    })
    _setStoreLoaderForTests(async () => backend)

    await useIntelligenceStore.getState().hydrate()
    const state = useIntelligenceStore.getState()
    expect(state.config.claudeCli).toEqual({ model: "" })
    expect(state.config.provider).toBe("anthropic")
    expect(state.config.openai.model).toBe("gpt-5.4")
  })

  it("carries the gate-seen flag into state", async () => {
    const backend = makeBackend(stored({ provider: "anthropic" }, true))
    _setStoreLoaderForTests(async () => backend)

    await useIntelligenceStore.getState().hydrate()
    expect(useIntelligenceStore.getState().secretGateSeen).toBe(true)
  })

  it("preserves an existing user's provider choice without re-persisting", async () => {
    const backend = makeBackend(stored({ provider: "claude-cli" }))
    _setStoreLoaderForTests(async () => backend)

    await useIntelligenceStore.getState().hydrate()
    expect(useIntelligenceStore.getState().config.provider).toBe("claude-cli")
    expect(backend.save).not.toHaveBeenCalled()
  })

  it("is idempotent — calling twice loads only once", async () => {
    const backend = makeBackend(stored({ provider: "claude-cli" }))
    _setStoreLoaderForTests(async () => backend)

    await useIntelligenceStore.getState().hydrate()
    await useIntelligenceStore.getState().hydrate()
    expect(backend.load).toHaveBeenCalledTimes(1)
  })

  it("dedupes concurrent hydrate calls", async () => {
    const backend = makeBackend(stored({ provider: "claude-cli" }))
    _setStoreLoaderForTests(async () => backend)
    const s = useIntelligenceStore.getState()
    await Promise.all([s.hydrate(), s.hydrate()])
    expect(backend.load).toHaveBeenCalledTimes(1)
  })
})

describe("useIntelligenceStore.ensureSecrets", () => {
  it("reads the keychain and merges the key into config (gate already seen)", async () => {
    const backend = makeBackend(
      stored({ provider: "anthropic", anthropic: { apiKey: "", model: "m", keyPresent: true } }, true),
      { anthropic: "sk-loaded", openai: "" },
    )
    _setStoreLoaderForTests(async () => backend)
    await useIntelligenceStore.getState().hydrate()

    await useIntelligenceStore.getState().ensureSecrets()
    const state = useIntelligenceStore.getState()
    expect(backend.loadSecrets).toHaveBeenCalledTimes(1)
    expect(state.config.anthropic.apiKey).toBe("sk-loaded")
    expect(state.config.anthropic.keyPresent).toBe(true)
    expect(needsSecrets(state.config)).toBe(false)
    expect(state.secretGateOpen).toBe(false)
  })

  it("does not clobber a key typed while an on-demand read is in flight", async () => {
    let releaseLoad!: (s: { anthropic: string; openai: string }) => void
    const loadGate = new Promise<{ anthropic: string; openai: string }>((r) => {
      releaseLoad = r
    })
    const backend = makeBackend(
      stored({ provider: "anthropic", anthropic: { apiKey: "", model: "m", keyPresent: true } }, true),
    )
    backend.loadSecrets.mockReturnValue(loadGate)
    _setStoreLoaderForTests(async () => backend)
    await useIntelligenceStore.getState().hydrate()

    const pending = useIntelligenceStore.getState().ensureSecrets()
    // The user types and saves a fresh key before the keychain read resolves.
    useIntelligenceStore.getState().setAnthropicKey("sk-typed")
    // The now-stale read resolves with the previous keychain value.
    releaseLoad({ anthropic: "sk-old", openai: "" })
    await pending

    expect(useIntelligenceStore.getState().config.anthropic.apiKey).toBe("sk-typed")
  })

  it("never touches the keychain for a non-API provider", async () => {
    const backend = makeBackend(stored({ provider: "claude-cli" }, false))
    _setStoreLoaderForTests(async () => backend)
    await useIntelligenceStore.getState().hydrate()

    await useIntelligenceStore.getState().ensureSecrets()
    expect(backend.loadSecrets).not.toHaveBeenCalled()
  })

  it("loads the stored key after switching from a non-API provider", async () => {
    const backend = makeBackend(
      stored({ provider: "claude-cli", openai: { apiKey: "", model: "m", keyPresent: true } }, true),
      { anthropic: "", openai: "sk-oai" },
    )
    _setStoreLoaderForTests(async () => backend)
    await useIntelligenceStore.getState().hydrate()
    await useIntelligenceStore.getState().ensureSecrets()

    useIntelligenceStore.getState().setProvider("openai")
    await useIntelligenceStore.getState().ensureSecrets()

    expect(backend.loadSecrets).toHaveBeenCalledTimes(1)
    expect(useIntelligenceStore.getState().config.openai.apiKey).toBe("sk-oai")
  })

  it("loads a stored key after a different provider's key was typed", async () => {
    const backend = makeBackend(
      stored({ provider: "anthropic", openai: { apiKey: "", model: "m", keyPresent: true } }, true),
      { anthropic: "", openai: "sk-oai" },
    )
    _setStoreLoaderForTests(async () => backend)
    await useIntelligenceStore.getState().hydrate()

    useIntelligenceStore.getState().setAnthropicKey("sk-ant")
    useIntelligenceStore.getState().setProvider("openai")
    expect(needsSecrets(useIntelligenceStore.getState().config)).toBe(true)
    await useIntelligenceStore.getState().ensureSecrets()

    const { config } = useIntelligenceStore.getState()
    expect(config.openai.apiKey).toBe("sk-oai")
    expect(config.anthropic.apiKey).toBe("sk-ant")
  })

  it("keeps a key cleared while an on-demand read is in flight cleared", async () => {
    let releaseLoad!: (s: { anthropic: string; openai: string }) => void
    const backend = makeBackend(
      stored({ provider: "anthropic", anthropic: { apiKey: "", model: "m", keyPresent: true } }, true),
    )
    backend.loadSecrets.mockReturnValue(new Promise((r) => (releaseLoad = r)))
    _setStoreLoaderForTests(async () => backend)
    await useIntelligenceStore.getState().hydrate()

    const pending = useIntelligenceStore.getState().ensureSecrets()
    useIntelligenceStore.getState().setAnthropicKey("")
    releaseLoad({ anthropic: "sk-old", openai: "" })
    await pending

    expect(useIntelligenceStore.getState().config.anthropic).toMatchObject({ apiKey: "", keyPresent: false })
  })

  it("shows the heads-up on the first-ever read, then loads on confirm", async () => {
    const backend = makeBackend(
      stored({ provider: "anthropic", anthropic: { apiKey: "", model: "m", keyPresent: true } }, false),
      { anthropic: "sk-loaded", openai: "" },
    )
    _setStoreLoaderForTests(async () => backend)
    await useIntelligenceStore.getState().hydrate()

    const pending = useIntelligenceStore.getState().ensureSecrets()
    // The gate is open and nothing has been read yet.
    expect(useIntelligenceStore.getState().secretGateOpen).toBe(true)
    expect(backend.loadSecrets).not.toHaveBeenCalled()

    useIntelligenceStore.getState().confirmSecretGate()
    await pending

    const state = useIntelligenceStore.getState()
    expect(state.secretGateOpen).toBe(false)
    expect(state.secretGateSeen).toBe(true)
    expect(state.config.anthropic.apiKey).toBe("sk-loaded")
    expect(backend.loadSecrets).toHaveBeenCalledTimes(1)
    expect(backend.markGateSeen).toHaveBeenCalledTimes(1)
  })

  it("dismissing the heads-up leaves secrets unloaded", async () => {
    const backend = makeBackend(
      stored({ provider: "anthropic", anthropic: { apiKey: "", model: "m", keyPresent: true } }, false),
      { anthropic: "sk-loaded", openai: "" },
    )
    _setStoreLoaderForTests(async () => backend)
    await useIntelligenceStore.getState().hydrate()

    const pending = useIntelligenceStore.getState().ensureSecrets()
    useIntelligenceStore.getState().dismissSecretGate()
    await pending
    await new Promise((r) => setTimeout(r, 0))

    const state = useIntelligenceStore.getState()
    expect(state.secretGateOpen).toBe(false)
    expect(needsSecrets(state.config)).toBe(true)
    expect(backend.loadSecrets).not.toHaveBeenCalled()
  })

  it("surfaces a retryable error when the read fails, without dropping presence", async () => {
    const backend = makeBackend(
      stored({ provider: "anthropic", anthropic: { apiKey: "", model: "m", keyPresent: true } }, true),
    )
    backend.loadSecrets.mockRejectedValue(new Error("keychain denied"))
    _setStoreLoaderForTests(async () => backend)
    await useIntelligenceStore.getState().hydrate()

    await useIntelligenceStore.getState().ensureSecrets()
    const state = useIntelligenceStore.getState()
    expect(state.secretsError).toBe(true)
    // Not latched as "loaded/absent" — a denied read must stay retryable and the
    // configured key must not flip to not-present.
    expect(needsSecrets(state.config)).toBe(true)
    expect(state.config.anthropic.keyPresent).toBe(true)
  })

  it("recovers on retry when the next read succeeds", async () => {
    const backend = makeBackend(
      stored({ provider: "anthropic", anthropic: { apiKey: "", model: "m", keyPresent: true } }, true),
    )
    backend.loadSecrets.mockRejectedValueOnce(new Error("keychain denied"))
    backend.loadSecrets.mockResolvedValue({ anthropic: "sk-loaded", openai: "" })
    _setStoreLoaderForTests(async () => backend)
    await useIntelligenceStore.getState().hydrate()

    await useIntelligenceStore.getState().ensureSecrets()
    expect(useIntelligenceStore.getState().secretsError).toBe(true)

    await useIntelligenceStore.getState().ensureSecrets()
    const state = useIntelligenceStore.getState()
    expect(state.secretsError).toBe(false)
    expect(needsSecrets(state.config)).toBe(false)
    expect(state.config.anthropic.apiKey).toBe("sk-loaded")
    expect(backend.loadSecrets).toHaveBeenCalledTimes(2)
  })
})

describe("useIntelligenceStore.secretsError", () => {
  it("clears when switching away from the provider whose read failed", async () => {
    const backend = makeBackend(
      stored({ provider: "anthropic", anthropic: { apiKey: "", model: "m", keyPresent: true } }, true),
    )
    backend.loadSecrets.mockRejectedValue(new Error("keychain denied"))
    _setStoreLoaderForTests(async () => backend)
    await useIntelligenceStore.getState().hydrate()
    await useIntelligenceStore.getState().ensureSecrets()
    expect(useIntelligenceStore.getState().secretsError).toBe(true)

    useIntelligenceStore.getState().setProvider("claude-cli")
    await useIntelligenceStore.getState().ensureSecrets()

    expect(useIntelligenceStore.getState().secretsError).toBe(false)
    expect(backend.loadSecrets).toHaveBeenCalledTimes(1)
  })

  it("stays set when the read left the current provider unresolved", async () => {
    const backend = makeBackend(
      stored({ provider: "openai", openai: { apiKey: "", model: "m", keyPresent: true } }, true),
    )
    backend.loadSecrets.mockResolvedValue({ anthropic: "sk-inline" })
    _setStoreLoaderForTests(async () => backend)
    await useIntelligenceStore.getState().hydrate()

    await useIntelligenceStore.getState().ensureSecrets()

    const state = useIntelligenceStore.getState()
    expect(state.secretsError).toBe(true)
    expect(state.config.openai).toMatchObject({ apiKey: "", keyPresent: true })
  })
})

describe("useIntelligenceStore dev gate controls", () => {
  it("resetSecretGate clears the seen flag in memory and through the backend", async () => {
    const backend = makeBackend(
      stored({ provider: "anthropic", anthropic: { apiKey: "", model: "m", keyPresent: true } }, true),
      { anthropic: "sk-loaded", openai: "" },
    )
    _setStoreLoaderForTests(async () => backend)
    await useIntelligenceStore.getState().hydrate()
    await useIntelligenceStore.getState().ensureSecrets()
    expect(needsSecrets(useIntelligenceStore.getState().config)).toBe(false)
    expect(useIntelligenceStore.getState().secretGateSeen).toBe(true)

    useIntelligenceStore.getState().resetSecretGate()
    const state = useIntelligenceStore.getState()
    // Fresh-install shape: heads-up unseen, secrets dropped so the next load
    // re-reads the keychain.
    expect(state.secretGateSeen).toBe(false)
    expect(needsSecrets(state.config)).toBe(true)
    expect(state.secretsError).toBe(false)
    await new Promise((r) => setTimeout(r, 0))
    expect(backend.clearGateSeen).toHaveBeenCalledTimes(1)
  })
})

describe("useIntelligenceStore setters", () => {
  it("setProvider updates state and persists", () => {
    _setStoreLoaderForTests(async () => makeBackend(null))
    useIntelligenceStore.getState().setProvider("anthropic")
    expect(useIntelligenceStore.getState().config.provider).toBe("anthropic")
  })

  it("setAnthropicKey marks the key present", () => {
    _setStoreLoaderForTests(async () => makeBackend(null))
    const s = useIntelligenceStore.getState()
    s.setAnthropicKey("sk-1")
    s.setAnthropicModel("custom-model-xyz")
    const state = useIntelligenceStore.getState()
    expect(state.config.anthropic).toEqual({ apiKey: "sk-1", model: "custom-model-xyz", keyPresent: true })
    expect(state.config.openai).toEqual(DEFAULT_INTELLIGENCE_CONFIG.openai)
  })

  it("trims a typed key, so whitespace alone reads as no key", () => {
    _setStoreLoaderForTests(async () => makeBackend(null))
    const s = useIntelligenceStore.getState()
    s.setAnthropicKey("  sk-1 ")
    expect(useIntelligenceStore.getState().config.anthropic.apiKey).toBe("sk-1")
    s.setOpenAiKey(" ")
    expect(useIntelligenceStore.getState().config.openai).toMatchObject({ apiKey: "", keyPresent: false })
  })

  it("setOpenAiKey + setOpenAiModel update only the openai slice", () => {
    _setStoreLoaderForTests(async () => makeBackend(null))
    const s = useIntelligenceStore.getState()
    s.setOpenAiKey("sk-oa")
    s.setOpenAiModel("gpt-5-pro")
    const cfg = useIntelligenceStore.getState().config
    expect(cfg.openai).toEqual({ apiKey: "sk-oa", model: "gpt-5-pro", keyPresent: true })
    expect(cfg.anthropic).toEqual(DEFAULT_INTELLIGENCE_CONFIG.anthropic)
  })

  it("setClaudeCliModel updates only the claudeCli slice", () => {
    _setStoreLoaderForTests(async () => makeBackend(null))
    useIntelligenceStore.getState().setClaudeCliModel("sonnet")
    const cfg = useIntelligenceStore.getState().config
    expect(cfg.claudeCli).toEqual({ model: "sonnet" })
    expect(cfg.anthropic).toEqual(DEFAULT_INTELLIGENCE_CONFIG.anthropic)
    expect(cfg.openai).toEqual(DEFAULT_INTELLIGENCE_CONFIG.openai)
  })

  it("persists writes to the backend", async () => {
    const backend = makeBackend(null)
    _setStoreLoaderForTests(async () => backend)

    useIntelligenceStore.getState().setProvider("anthropic")
    await Promise.resolve()
    await Promise.resolve()
    expect(backend.save).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "anthropic" }),
    )
  })
})

describe("useIntelligenceStore persistence before secrets load", () => {
  function realBackend(
    onDisk: IntelligenceConfig,
    keys: Partial<Record<SecretProvider, string>>,
    opts: { failGet?: boolean } = {},
  ) {
    let file = onDisk
    const keychain = new Map(Object.entries(keys) as [SecretProvider, string][])
    const get = vi.fn(async (p: SecretProvider) => {
      if (opts.failGet) throw new Error("keychain denied")
      return keychain.get(p) ?? null
    })
    const backend = createSecretAwareBackend(
      {
        get: async () => file,
        set: async (c) => {
          file = c
        },
        getGateSeen: async () => true,
        setGateSeen: async () => undefined,
        clearGateSeen: async () => undefined,
      },
      {
        get,
        set: async (p, secret) => {
          if (secret) keychain.set(p, secret)
          else keychain.delete(p)
        },
      },
    )
    return { backend, keychain, file: () => file, keychainGet: get }
  }

  const flush = () => new Promise((r) => setTimeout(r, 0))

  it("keeps an unloaded key when a setter persists after restart", async () => {
    const disk = realBackend(
      {
        ...DEFAULT_INTELLIGENCE_CONFIG,
        provider: "claude-cli",
        openai: { apiKey: "", model: "gpt", keyPresent: true },
      },
      { openai: "sk-oai" },
    )
    _setStoreLoaderForTests(async () => disk.backend)
    await useIntelligenceStore.getState().hydrate()

    useIntelligenceStore.getState().setProvider("openai")
    useIntelligenceStore.getState().setOpenAiModel("gpt-5-pro")
    await flush()

    expect(disk.keychain.get("openai")).toBe("sk-oai")
    expect(disk.file().openai.keyPresent).toBe(true)

    await useIntelligenceStore.getState().ensureSecrets()
    expect(useIntelligenceStore.getState().config.openai.apiKey).toBe("sk-oai")
  })

  it("still deletes the key on an explicit clear", async () => {
    const disk = realBackend(
      {
        ...DEFAULT_INTELLIGENCE_CONFIG,
        provider: "openai",
        openai: { apiKey: "", model: "gpt", keyPresent: true },
      },
      { openai: "sk-oai" },
    )
    _setStoreLoaderForTests(async () => disk.backend)
    await useIntelligenceStore.getState().hydrate()

    useIntelligenceStore.getState().setOpenAiKey("")
    await flush()

    expect(disk.keychain.has("openai")).toBe(false)
    expect(disk.file().openai.keyPresent).toBe(false)
  })

  it("keeps a keychain-only key when a denied read resolved only the other provider", async () => {
    const disk = realBackend(
      {
        ...DEFAULT_INTELLIGENCE_CONFIG,
        provider: "openai",
        anthropic: { apiKey: "sk-inline", model: "claude", keyPresent: true },
        openai: { apiKey: "", model: "gpt", keyPresent: true },
      },
      { openai: "sk-oai" },
      { failGet: true },
    )
    _setStoreLoaderForTests(async () => disk.backend)
    await useIntelligenceStore.getState().hydrate()

    await useIntelligenceStore.getState().ensureSecrets()
    const state = useIntelligenceStore.getState()
    expect(state.config.anthropic.apiKey).toBe("sk-inline")
    expect(state.config.openai.keyPresent).toBe(true)
    expect(state.secretsError).toBe(true)

    useIntelligenceStore.getState().setOpenAiModel("gpt-5-pro")
    useIntelligenceStore.getState().setProvider("anthropic")
    await flush()

    expect(disk.keychain.get("openai")).toBe("sk-oai")
    expect(disk.file().openai.keyPresent).toBe(true)
    expect(useIntelligenceStore.getState().config.openai.keyPresent).toBe(true)
  })

  it("a failed read stays pending without re-reading on its own", async () => {
    const disk = realBackend(
      {
        ...DEFAULT_INTELLIGENCE_CONFIG,
        provider: "openai",
        openai: { apiKey: "", model: "gpt", keyPresent: true },
      },
      { openai: "sk-oai" },
      { failGet: true },
    )
    _setStoreLoaderForTests(async () => disk.backend)
    await useIntelligenceStore.getState().hydrate()

    await useIntelligenceStore.getState().ensureSecrets()
    await flush()

    expect(needsSecrets(useIntelligenceStore.getState().config)).toBe(true)
    expect(useIntelligenceStore.getState().secretsError).toBe(true)
    expect(disk.keychainGet).toHaveBeenCalledTimes(1)
  })
})
