import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  DEFAULT_INTELLIGENCE_CONFIG,
  DEFAULT_OLLAMA_BASE_URL,
  type IntelligenceConfig,
  type ModelOption,
} from "@capybudget/intelligence"
import { OllamaConfig } from "./ollama-config"
import {
  useIntelligenceStore,
  _resetIntelligenceStoreForTests,
  _setStoreLoaderForTests,
  type SecretConfigBackend,
} from "@/stores/intelligence-store"
import type { ProviderEndpoint } from "@capybudget/intelligence/adapters"

const { listModels } = vi.hoisted(() => ({
  listModels: vi.fn<(endpoint: ProviderEndpoint) => Promise<ModelOption[]>>(),
}))

vi.mock("@capybudget/intelligence/adapters", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@capybudget/intelligence/adapters")>()),
  listModels,
  pingProvider: vi.fn(),
}))

function pulled(...ids: string[]): ModelOption[] {
  return ids.map((id) => ({ value: id, label: id }))
}

afterEach(cleanup)
beforeEach(() => {
  _resetIntelligenceStoreForTests()
  listModels.mockReset()
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
    listModels.mockResolvedValue(pulled("llama3.1:8b", "qwen3:8b"))
    await hydrate({ model: "qwen3:8b" })

    render(<OllamaConfig />)

    await waitFor(() => expect(listModels).toHaveBeenCalledWith({ provider: "ollama", baseUrl: DEFAULT_OLLAMA_BASE_URL }))
    expect(await screen.findByText("Detected")).toBeInTheDocument()
  })

  it("says the server is unreachable rather than silently offering nothing", async () => {
    listModels.mockRejectedValue(new Error("ECONNREFUSED"))
    await hydrate()

    render(<OllamaConfig />)

    expect(await screen.findByText("Not detected")).toBeInTheDocument()
    expect(
      screen.getByText(/can't reach Ollama at this address/i),
    ).toBeInTheDocument()
  })

  it("guides a reachable server with nothing pulled to the library and a typed model name", async () => {
    listModels.mockResolvedValue(pulled())
    await hydrate()
    const user = userEvent.setup()

    render(<OllamaConfig />)

    expect(await screen.findByText(/no models yet/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Browse Ollama models" })).toBeInTheDocument()
    expect(screen.queryByLabelText("Use a custom model")).not.toBeInTheDocument()

    await user.type(screen.getByPlaceholderText("model-identifier"), "qwen3:8b")

    expect(useIntelligenceStore.getState().config.ollama.model).toBe("qwen3:8b")
  })

  it("shows no empty state when the server has models", async () => {
    listModels.mockResolvedValue(pulled("llama3.1:8b"))
    await hydrate()

    render(<OllamaConfig />)

    expect(await screen.findByText("Detected")).toBeInTheDocument()
    expect(screen.queryByText(/no models yet/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText("Use a custom model")).toBeInTheDocument()
  })

  it("keeps a saved model the server no longer has in the picker", async () => {
    listModels.mockResolvedValue(pulled("llama3.1:8b"))
    await hydrate({ model: "mistral:7b" })
    const user = userEvent.setup()

    render(<OllamaConfig />)
    expect(await screen.findByText("Detected")).toBeInTheDocument()
    expect(screen.queryByPlaceholderText("model-identifier")).not.toBeInTheDocument()

    await user.click(screen.getByLabelText("Model"))

    expect(await screen.findByRole("option", { name: "mistral:7b" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "llama3.1:8b" })).toBeInTheDocument()
    expect(useIntelligenceStore.getState().config.ollama.model).toBe("mistral:7b")
  })

  it("re-probes the new endpoint when the URL is committed", async () => {
    listModels.mockResolvedValue(pulled("llama3.1:8b"))
    await hydrate()
    const user = userEvent.setup()

    render(<OllamaConfig />)
    await waitFor(() => expect(listModels).toHaveBeenCalledTimes(1))

    const url = screen.getByLabelText("Server URL") as HTMLInputElement
    await user.clear(url)
    await user.type(url, "http://192.168.0.9:11434/v1")
    await user.tab()

    await waitFor(() =>
      expect(listModels).toHaveBeenLastCalledWith({ provider: "ollama", baseUrl: "http://192.168.0.9:11434/v1" }),
    )
    expect(useIntelligenceStore.getState().config.ollama.baseUrl).toBe(
      "http://192.168.0.9:11434/v1",
    )
  })

  it("snaps a cleared URL back to the stock endpoint instead of persisting an empty one", async () => {
    listModels.mockResolvedValue(pulled("llama3.1:8b"))
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
