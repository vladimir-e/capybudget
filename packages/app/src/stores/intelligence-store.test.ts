import { describe, it, expect, beforeEach, vi } from "vitest"
import { DEFAULT_INTELLIGENCE_CONFIG } from "@capybudget/intelligence"

const { storeMock, claudeDetectorMock } = vi.hoisted(() => ({
  storeMock: {
    get: vi.fn<() => Promise<unknown>>(),
    set: vi.fn<(value: unknown) => Promise<void>>(),
    save: vi.fn<() => Promise<void>>(),
  },
  claudeDetectorMock: vi.fn<() => Promise<boolean>>(),
}))

vi.mock("@tauri-apps/plugin-store", () => ({
  Store: { load: vi.fn(async () => storeMock) },
}))

vi.mock("@/services/claude-cli-detect", () => ({
  detectClaudeCli: claudeDetectorMock,
}))

import {
  useIntelligenceStore,
  _resetIntelligenceStoreForTests,
  _setStoreLoaderForTests,
  _setClaudeDetectorForTests,
  _resetStoreForTests,
  type ConfigStoreBackend,
} from "./intelligence-store"

beforeEach(() => {
  storeMock.get.mockReset()
  storeMock.set.mockReset().mockResolvedValue(undefined)
  storeMock.save.mockReset().mockResolvedValue(undefined)
  claudeDetectorMock.mockReset()
  _resetStoreForTests()
  _resetIntelligenceStoreForTests()
})

function makeBackend(initial: unknown): ConfigStoreBackend & {
  get: ReturnType<typeof vi.fn>
  set: ReturnType<typeof vi.fn>
} {
  const get = vi.fn(async () => initial as never)
  const set = vi.fn(async () => undefined)
  return { get, set }
}

describe("useIntelligenceStore.hydrate", () => {
  it("loads existing config from the backend", async () => {
    const backend = makeBackend({
      provider: "anthropic",
      anthropic: { apiKey: "sk-x", model: "claude-sonnet-4-5" },
      openai: { apiKey: "", model: "gpt-5" },
    })
    _setStoreLoaderForTests(async () => backend)

    await useIntelligenceStore.getState().hydrate()
    const state = useIntelligenceStore.getState()
    expect(state.hydrated).toBe(true)
    expect(state.config.provider).toBe("anthropic")
    expect(state.config.anthropic.apiKey).toBe("sk-x")
  })

  it("auto-defaults to claude-cli on first run when claude is detected", async () => {
    const backend = makeBackend(null)
    _setStoreLoaderForTests(async () => backend)
    _setClaudeDetectorForTests(async () => true)

    await useIntelligenceStore.getState().hydrate()
    const state = useIntelligenceStore.getState()
    expect(state.config.provider).toBe("claude-cli")
    // Persists the seed so it sticks across restarts
    expect(backend.set).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "claude-cli" }),
    )
  })

  it("leaves provider null on first run when claude is not detected", async () => {
    const backend = makeBackend(null)
    _setStoreLoaderForTests(async () => backend)
    _setClaudeDetectorForTests(async () => false)

    await useIntelligenceStore.getState().hydrate()
    expect(useIntelligenceStore.getState().config.provider).toBeNull()
  })

  it("treats detector errors as 'claude not detected'", async () => {
    const backend = makeBackend(null)
    _setStoreLoaderForTests(async () => backend)
    _setClaudeDetectorForTests(async () => {
      throw new Error("shell unavailable")
    })

    await useIntelligenceStore.getState().hydrate()
    expect(useIntelligenceStore.getState().config.provider).toBeNull()
  })

  it("is idempotent — calling twice loads only once", async () => {
    const backend = makeBackend({
      ...DEFAULT_INTELLIGENCE_CONFIG,
      provider: "claude-cli",
    })
    _setStoreLoaderForTests(async () => backend)

    await useIntelligenceStore.getState().hydrate()
    await useIntelligenceStore.getState().hydrate()
    expect(backend.get).toHaveBeenCalledTimes(1)
  })

  it("dedupes concurrent hydrate calls", async () => {
    const backend = makeBackend({
      ...DEFAULT_INTELLIGENCE_CONFIG,
      provider: "claude-cli",
    })
    _setStoreLoaderForTests(async () => backend)
    const s = useIntelligenceStore.getState()
    await Promise.all([s.hydrate(), s.hydrate()])
    expect(backend.get).toHaveBeenCalledTimes(1)
  })
})

describe("useIntelligenceStore setters", () => {
  it("setProvider updates state and persists", () => {
    const backend = makeBackend(null)
    _setStoreLoaderForTests(async () => backend)

    useIntelligenceStore.getState().setProvider("anthropic")
    expect(useIntelligenceStore.getState().config.provider).toBe("anthropic")
  })

  it("setAnthropicKey + setAnthropicModel update only the anthropic slice", () => {
    const backend = makeBackend(null)
    _setStoreLoaderForTests(async () => backend)
    const s = useIntelligenceStore.getState()
    s.setAnthropicKey("sk-1")
    s.setAnthropicModel("claude-opus-4-7")
    const cfg = useIntelligenceStore.getState().config
    expect(cfg.anthropic).toEqual({ apiKey: "sk-1", model: "claude-opus-4-7" })
    // openai untouched
    expect(cfg.openai).toEqual(DEFAULT_INTELLIGENCE_CONFIG.openai)
  })

  it("setOpenAiKey + setOpenAiModel update only the openai slice", () => {
    const backend = makeBackend(null)
    _setStoreLoaderForTests(async () => backend)
    const s = useIntelligenceStore.getState()
    s.setOpenAiKey("sk-oa")
    s.setOpenAiModel("gpt-5-pro")
    const cfg = useIntelligenceStore.getState().config
    expect(cfg.openai).toEqual({ apiKey: "sk-oa", model: "gpt-5-pro" })
    expect(cfg.anthropic).toEqual(DEFAULT_INTELLIGENCE_CONFIG.anthropic)
  })

  it("persists writes to the backend", async () => {
    const backend = makeBackend(null)
    _setStoreLoaderForTests(async () => backend)

    useIntelligenceStore.getState().setProvider("anthropic")

    // Persist is fire-and-forget — drain microtasks
    await Promise.resolve()
    await Promise.resolve()
    expect(backend.set).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "anthropic" }),
    )
  })
})
