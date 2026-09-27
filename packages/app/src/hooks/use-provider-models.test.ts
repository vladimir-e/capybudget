import { beforeEach, describe, expect, it } from "vitest"
import { renderHook } from "@testing-library/react"
import { anthropicList, page } from "@/test/model-sdk-mocks"
import {
  _resetProviderModelsForTests,
  cachedProviderModels,
  loadProviderModels,
} from "@/lib/provider-models"
import { useProviderModels } from "./use-provider-models"

const FABLE = { id: "claude-fable-6", display_name: "Claude Fable 6", created_at: "2026-09-20T00:00:00Z" }

beforeEach(async () => {
  _resetProviderModelsForTests()
  anthropicList.mockReset()
  anthropicList.mockImplementation(() => page([FABLE]))
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
