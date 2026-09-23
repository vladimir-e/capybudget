import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  DEFAULT_INTELLIGENCE_CONFIG,
  DEFAULT_OLLAMA_BASE_URL,
  type IntelligenceConfig,
} from "@capybudget/intelligence"
import { OllamaConfig } from "./ollama-config"
import {
  useIntelligenceStore,
  _resetIntelligenceStoreForTests,
  _setStoreLoaderForTests,
  type SecretConfigBackend,
} from "@/stores/intelligence-store"
import { listOllamaModels } from "@/lib/api-testing"

vi.mock("@/lib/api-testing", () => ({
  listOllamaModels: vi.fn(),
  pingOllama: vi.fn(),
}))

const mockList = vi.mocked(listOllamaModels)

afterEach(cleanup)
beforeEach(() => {
  _resetIntelligenceStoreForTests()
  mockList.mockReset()
})

/** Hydrate the store from a config, with a backend that persists nowhere. */
async function hydrate(ollama: Partial<IntelligenceConfig["ollama"]> = {}) {
  const config: IntelligenceConfig = {
    ...DEFAULT_INTELLIGENCE_CONFIG,
    provider: "ollama",
    ollama: { ...DEFAULT_INTELLIGENCE_CONFIG.ollama, ...ollama },
  }
  const backend: SecretConfigBackend = {
    load: async () => ({ config, gateSeen: true }),
    loadSecrets: async () => ({ anthropic: "", openai: "" }),
    save: async () => undefined,
    markGateSeen: async () => undefined,
    clearGateSeen: async () => undefined,
  }
  _setStoreLoaderForTests(async () => backend)
  await useIntelligenceStore.getState().hydrate()
}

describe("OllamaConfig", () => {
  it("probes the saved endpoint and offers what the server has pulled", async () => {
    mockList.mockResolvedValue(["llama3.1:8b", "qwen3:8b"])
    await hydrate({ model: "qwen3:8b" })

    render(<OllamaConfig />)

    await waitFor(() => expect(mockList).toHaveBeenCalledWith(DEFAULT_OLLAMA_BASE_URL))
    expect(await screen.findByText("Detected")).toBeInTheDocument()
  })

  it("says the server is unreachable rather than silently offering nothing", async () => {
    mockList.mockRejectedValue(new Error("ECONNREFUSED"))
    await hydrate()

    render(<OllamaConfig />)

    expect(await screen.findByText("Not detected")).toBeInTheDocument()
    expect(
      screen.getByText(/can't reach Ollama at this address/i),
    ).toBeInTheDocument()
  })

  it("flags a reachable server with nothing pulled", async () => {
    mockList.mockResolvedValue([])
    await hydrate()

    render(<OllamaConfig />)

    expect(await screen.findByText(/no models yet/i)).toBeInTheDocument()
  })

  it("re-probes the new endpoint when the URL is committed", async () => {
    mockList.mockResolvedValue(["llama3.1:8b"])
    await hydrate()
    const user = userEvent.setup()

    render(<OllamaConfig />)
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(1))

    const url = screen.getByLabelText("Server URL") as HTMLInputElement
    await user.clear(url)
    await user.type(url, "http://192.168.0.9:11434/v1")
    await user.tab()

    await waitFor(() =>
      expect(mockList).toHaveBeenLastCalledWith("http://192.168.0.9:11434/v1"),
    )
    expect(useIntelligenceStore.getState().config.ollama.baseUrl).toBe(
      "http://192.168.0.9:11434/v1",
    )
  })

  it("snaps a cleared URL back to the stock endpoint instead of persisting an empty one", async () => {
    mockList.mockResolvedValue(["llama3.1:8b"])
    await hydrate({ baseUrl: "http://192.168.0.9:11434/v1" })
    const user = userEvent.setup()

    render(<OllamaConfig />)
    const url = screen.getByLabelText("Server URL") as HTMLInputElement
    await user.clear(url)
    await user.tab()

    expect(url.value).toBe(DEFAULT_OLLAMA_BASE_URL)
    expect(useIntelligenceStore.getState().config.ollama.baseUrl).toBe(
      DEFAULT_OLLAMA_BASE_URL,
    )
  })
})
