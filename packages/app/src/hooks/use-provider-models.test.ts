import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderHook } from "@testing-library/react"
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
  loadProviderModels,
} from "@/lib/provider-models"
import { useProviderModels } from "./use-provider-models"

beforeEach(async () => {
  _resetProviderModelsForTests()
  listModels.mockReset()
  listModels.mockResolvedValue([{ value: "claude-fable-6", label: "Claude Fable 6" }])
  await loadProviderModels("anthropic", "sk-1")
})

describe("useProviderModels without a loaded key", () => {
  it("keeps the cached list while a saved key hasn't loaded yet", () => {
    renderHook(() => useProviderModels("anthropic", "", true))

    expect(cachedProviderModels("anthropic", "sk-1")).toBeDefined()
  })

  it("drops the cached list once the key is cleared", () => {
    renderHook(() => useProviderModels("anthropic", "", false))

    expect(cachedProviderModels("anthropic", "sk-1")).toBeUndefined()
  })
})
