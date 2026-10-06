import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ModelOption } from "@capybudget/intelligence"
import type { ProviderEndpoint } from "@capybudget/intelligence/adapters"

const { listModels } = vi.hoisted(() => ({
  listModels: vi.fn<(endpoint: ProviderEndpoint) => Promise<ModelOption[]>>(),
}))

vi.mock("@capybudget/intelligence/adapters", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@capybudget/intelligence/adapters")>()),
  listModels,
}))

import {
  _resetProviderModelsForTests,
  cachedProviderModels,
  forgetProviderModels,
  loadProviderModels,
} from "./provider-models"

const OPUS: ModelOption = { value: "claude-opus-5-5", label: "Claude Opus 5.5" }

beforeEach(() => {
  _resetProviderModelsForTests()
  listModels.mockReset()
  listModels.mockResolvedValue([OPUS])
})

describe("loadProviderModels", () => {
  it("fetches once per key and serves the cache after", async () => {
    const first = await loadProviderModels("anthropic", "sk-1")
    const second = await loadProviderModels("anthropic", "sk-1")

    expect(first).toEqual([OPUS])
    expect(second).toBe(first)
    expect(cachedProviderModels("anthropic", "sk-1")).toBe(first)
    expect(listModels).toHaveBeenCalledTimes(1)
    expect(listModels).toHaveBeenCalledWith({ provider: "anthropic", apiKey: "sk-1" })
  })

  it("shares one in-flight request between concurrent loads", async () => {
    let resolve!: (models: ModelOption[]) => void
    listModels.mockImplementation(() => new Promise((r) => (resolve = r)))

    const first = loadProviderModels("anthropic", "sk-1")
    const second = loadProviderModels("anthropic", "sk-1")
    resolve([OPUS])

    expect(second).toBe(first)
    expect(await second).toHaveLength(1)
    expect(listModels).toHaveBeenCalledTimes(1)
  })

  it("forgets a provider's entry on demand", async () => {
    await loadProviderModels("anthropic", "sk-1")
    forgetProviderModels("anthropic")

    expect(cachedProviderModels("anthropic", "sk-1")).toBeUndefined()
  })

  it("refetches when the key changes", async () => {
    await loadProviderModels("anthropic", "sk-1")
    await loadProviderModels("anthropic", "sk-2")

    expect(listModels).toHaveBeenCalledTimes(2)
    expect(cachedProviderModels("anthropic", "sk-1")).toBeUndefined()
  })

  it("keeps providers apart", async () => {
    const sol = { value: "gpt-6-sol", label: "GPT-6 Sol" }
    listModels.mockImplementation(async ({ provider }) => (provider === "openai" ? [sol] : [OPUS]))

    await loadProviderModels("anthropic", "sk-1")
    expect(await loadProviderModels("openai", "sk-1")).toEqual([sol])
  })

  it("forgets a failure so the next ask retries", async () => {
    listModels.mockRejectedValueOnce(new Error("401 invalid x-api-key"))
    await expect(loadProviderModels("anthropic", "sk-1")).rejects.toThrow("invalid x-api-key")

    expect(await loadProviderModels("anthropic", "sk-1")).toHaveLength(1)
    expect(listModels).toHaveBeenCalledTimes(2)
  })
})
