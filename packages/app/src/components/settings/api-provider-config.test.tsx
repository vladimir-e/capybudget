import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { DEFAULT_INTELLIGENCE_CONFIG, type IntelligenceConfig } from "@capybudget/intelligence"
import { AnthropicConfig, OpenAiConfig } from "./api-provider-config"
import { _resetProviderModelsForTests } from "@/lib/provider-models"
import {
  useIntelligenceStore,
  _resetIntelligenceStoreForTests,
  _setStoreLoaderForTests,
  type SecretConfigBackend,
} from "@/stores/intelligence-store"

vi.mock("@/lib/api-testing", () => ({ pingApi: vi.fn() }))

const { anthropicList, openAiList } = vi.hoisted(() => ({
  anthropicList: vi.fn(),
  openAiList: vi.fn(),
}))

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    models = { list: anthropicList }
  },
}))

vi.mock("openai", () => ({
  default: class {
    models = { list: openAiList }
  },
}))

async function* page<T>(items: T[]) {
  yield* items
}

function failing(): AsyncIterable<never> {
  return {
    [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error("401 invalid x-api-key")) }),
  }
}

const FABLE = { id: "claude-fable-6", display_name: "Claude Fable 6", created_at: "2026-09-20T00:00:00Z" }

afterEach(cleanup)
beforeEach(() => {
  _resetIntelligenceStoreForTests()
  _resetProviderModelsForTests()
  anthropicList.mockReset()
  anthropicList.mockImplementation(() => page([FABLE]))
  openAiList.mockReset()
})

// A backend whose on-demand keychain read is held open until `release` is
// called — lets a test interleave user typing with the read resolving.
function backendWithGatedSecrets(config: IntelligenceConfig) {
  let release!: (s: { anthropic: string; openai: string }) => void
  const gate = new Promise<{ anthropic: string; openai: string }>((r) => {
    release = r
  })
  const backend: SecretConfigBackend = {
    load: async () => ({ config, gateSeen: true }),
    loadSecrets: () => gate,
    save: async () => undefined,
    markGateSeen: async () => undefined,
    clearGateSeen: async () => undefined,
  }
  return { backend, release: () => release }
}

describe("ApiProviderConfig", () => {
  it("keeps the user's in-progress key when an on-demand load resolves mid-typing", async () => {
    const user = userEvent.setup()
    const config: IntelligenceConfig = {
      ...DEFAULT_INTELLIGENCE_CONFIG,
      provider: "anthropic",
      anthropic: { apiKey: "", model: "m", keyPresent: true },
    }
    const { backend, release } = backendWithGatedSecrets(config)
    _setStoreLoaderForTests(async () => backend)
    await useIntelligenceStore.getState().hydrate()

    render(<AnthropicConfig />)
    const input = screen.getByLabelText("API key") as HTMLInputElement

    // Mount fires ensureSecrets (keyPresent, value not yet loaded); the read is
    // held open. The user types a fresh key before it resolves.
    await user.type(input, "sk-typed")
    expect(input.value).toBe("sk-typed")

    // The read now resolves with the previously-saved key.
    await act(async () => {
      release()({ anthropic: "sk-loaded", openai: "" })
      await Promise.resolve()
    })

    // The resolved value must not clobber the draft the user is editing.
    expect(input.value).toBe("sk-typed")
  })

  const unloaded: IntelligenceConfig = {
    ...DEFAULT_INTELLIGENCE_CONFIG,
    provider: "anthropic",
    anthropic: { apiKey: "", model: "m", keyPresent: true },
  }

  function backendWith(gateSeen: boolean, loadSecrets: SecretConfigBackend["loadSecrets"]) {
    const backend: SecretConfigBackend = {
      load: async () => ({ config: unloaded, gateSeen }),
      loadSecrets: vi.fn(loadSecrets),
      save: async () => undefined,
      markGateSeen: async () => undefined,
      clearGateSeen: async () => undefined,
    }
    return backend
  }

  it("a failed read shows retry and doesn't re-read on its own", async () => {
    const backend = backendWith(true, async () => {
      throw new Error("keychain denied")
    })
    _setStoreLoaderForTests(async () => backend)
    await useIntelligenceStore.getState().hydrate()

    render(<AnthropicConfig />)

    expect(await screen.findByRole("button", { name: "Retry" })).toBeTruthy()
    await act(() => new Promise((r) => setTimeout(r, 0)))
    expect(backend.loadSecrets).toHaveBeenCalledTimes(1)
  })

  it("a dismissed heads-up stays dismissed without reopening", async () => {
    const backend = backendWith(false, async () => ({ anthropic: "sk-loaded", openai: "" }))
    _setStoreLoaderForTests(async () => backend)
    await useIntelligenceStore.getState().hydrate()

    render(<AnthropicConfig />)
    expect(useIntelligenceStore.getState().secretGateOpen).toBe(true)

    await act(async () => {
      useIntelligenceStore.getState().dismissSecretGate()
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(useIntelligenceStore.getState().secretGateOpen).toBe(false)
    expect(backend.loadSecrets).not.toHaveBeenCalled()
  })
})

describe("model list", () => {
  async function hydrateWith(config: Partial<IntelligenceConfig>) {
    const full: IntelligenceConfig = { ...DEFAULT_INTELLIGENCE_CONFIG, ...config }
    const backend: SecretConfigBackend = {
      load: async () => ({ config: full, gateSeen: true }),
      loadSecrets: async () => ({ anthropic: full.anthropic.apiKey, openai: full.openai.apiKey }),
      save: async () => undefined,
      markGateSeen: async () => undefined,
      clearGateSeen: async () => undefined,
    }
    _setStoreLoaderForTests(async () => backend)
    await useIntelligenceStore.getState().hydrate()
  }

  const withAnthropicKey = (model = "claude-sonnet-5") => ({
    provider: "anthropic" as const,
    anthropic: { apiKey: "sk-1", model, keyPresent: true },
  })

  it("offers the curated fallback without fetching when there's no key", async () => {
    const user = userEvent.setup()
    await hydrateWith({ provider: "anthropic" })

    render(<AnthropicConfig />)
    await user.click(screen.getByLabelText("Model"))

    expect(await screen.findByRole("option", { name: "Claude Opus 5.5" })).toBeInTheDocument()
    expect(anthropicList).not.toHaveBeenCalled()
  })

  it("offers the vendor's live list once a key is saved", async () => {
    const user = userEvent.setup()
    await hydrateWith(withAnthropicKey())

    render(<AnthropicConfig />)
    await waitFor(() => expect(anthropicList).toHaveBeenCalledTimes(1))
    await user.click(screen.getByLabelText("Model"))

    expect(await screen.findByRole("option", { name: "Claude Fable 6" })).toBeInTheDocument()
    expect(screen.queryByRole("option", { name: "Claude Opus 5.5" })).not.toBeInTheDocument()
  })

  it("reuses the fetched list when the block remounts", async () => {
    await hydrateWith(withAnthropicKey())

    const { unmount } = render(<AnthropicConfig />)
    await waitFor(() => expect(anthropicList).toHaveBeenCalledTimes(1))
    unmount()
    render(<AnthropicConfig />)

    await act(() => new Promise((r) => setTimeout(r, 0)))
    expect(anthropicList).toHaveBeenCalledTimes(1)
  })

  it("keeps a saved model the list doesn't offer selected", async () => {
    await hydrateWith(withAnthropicKey("claude-legacy-pinned"))

    render(<AnthropicConfig />)
    await waitFor(() => expect(anthropicList).toHaveBeenCalled())

    expect(screen.getByRole("combobox")).toHaveTextContent("claude-legacy-pinned")
    expect(screen.queryByPlaceholderText("model-identifier")).not.toBeInTheDocument()
  })

  it("falls back quietly when the fetch fails, and retries on demand", async () => {
    const user = userEvent.setup()
    anthropicList.mockImplementationOnce(() => failing())
    await hydrateWith(withAnthropicKey())

    render(<AnthropicConfig />)

    expect(await screen.findByText(/couldn't load the latest models/i)).toBeInTheDocument()
    expect(screen.getByRole("combobox")).toHaveTextContent("Claude Sonnet 5")

    await user.click(screen.getByRole("button", { name: "Retry" }))

    await waitFor(() =>
      expect(screen.queryByText(/couldn't load the latest models/i)).not.toBeInTheDocument(),
    )
    expect(anthropicList).toHaveBeenCalledTimes(2)
  })

  it("filters OpenAI's catalogue down to chat models with readable labels", async () => {
    const user = userEvent.setup()
    openAiList.mockImplementation(() =>
      page([
        { id: "gpt-6-sol", created: 3 },
        { id: "gpt-image-2", created: 2 },
        { id: "gpt-5.4-mini", created: 1 },
      ]),
    )
    await hydrateWith({
      provider: "openai",
      openai: { apiKey: "sk-1", model: "gpt-6-sol", keyPresent: true },
    })

    render(<OpenAiConfig />)
    await waitFor(() => expect(openAiList).toHaveBeenCalled())
    await user.click(screen.getByLabelText("Model"))

    expect(await screen.findByRole("option", { name: "GPT-5.4 mini" })).toBeInTheDocument()
    expect(screen.queryByRole("option", { name: /image/i })).not.toBeInTheDocument()
  })
})
