import { beforeEach, describe, expect, it, vi } from "vitest"

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

import {
  _resetProviderModelsForTests,
  anthropicModelOptions,
  cachedProviderModels,
  isOpenAiChatModel,
  loadProviderModels,
  openAiModelLabel,
  openAiModelOptions,
  withSavedModel,
} from "./provider-models"

async function* page<T>(items: T[]) {
  yield* items
}

function failing(): AsyncIterable<never> {
  return {
    [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error("401 invalid x-api-key")) }),
  }
}

beforeEach(() => {
  _resetProviderModelsForTests()
  anthropicList.mockReset()
  openAiList.mockReset()
})

describe("isOpenAiChatModel", () => {
  it.each([
    "gpt-6-sol",
    "gpt-5.4-mini",
    "gpt-4o",
    "gpt-4.1-nano",
    "gpt-5-chat-latest",
    "o3",
    "o4-mini",
  ])("keeps %s", (id) => {
    expect(isOpenAiChatModel(id)).toBe(true)
  })

  it.each([
    "gpt-image-1",
    "gpt-4o-audio-preview",
    "gpt-realtime",
    "gpt-4o-realtime-preview",
    "gpt-4o-mini-tts",
    "gpt-4o-transcribe",
    "text-embedding-3-large",
    "omni-moderation-latest",
    "gpt-4o-search-preview",
    "gpt-5-codex",
    "gpt-3.5-turbo-instruct",
    "o3-deep-research",
    "o1-pro",
    "gpt-5-pro-2025-10-06",
    "computer-use-preview",
    "dall-e-3",
    "whisper-1",
    "tts-1",
    "chatgpt-4o-latest",
    "babbage-002",
  ])("drops %s", (id) => {
    expect(isOpenAiChatModel(id)).toBe(false)
  })
})

describe("openAiModelLabel", () => {
  it.each([
    ["gpt-6-sol", "GPT-6 Sol"],
    ["gpt-5.4-mini", "GPT-5.4 mini"],
    ["gpt-4.1-nano", "GPT-4.1 nano"],
    ["gpt-4o", "GPT-4o"],
    ["gpt-4-turbo", "GPT-4 Turbo"],
    ["gpt-4o-2024-08-06", "GPT-4o (2024-08-06)"],
    ["o4-mini", "o4-mini"],
  ])("%s → %s", (id, label) => {
    expect(openAiModelLabel(id)).toBe(label)
  })
})

describe("openAiModelOptions", () => {
  it("keeps chat models newest first and hides snapshots shadowed by their base id", () => {
    const options = openAiModelOptions([
      { id: "gpt-5.4-mini", created: 100 },
      { id: "gpt-5.4-mini-2026-03-01", created: 101 },
      { id: "gpt-4o-2024-08-06", created: 50 },
      { id: "gpt-image-2", created: 400 },
      { id: "gpt-6-sol", created: 300 },
      { id: "o3", created: 200 },
    ])

    expect(options).toEqual([
      { value: "gpt-6-sol", label: "GPT-6 Sol" },
      { value: "o3", label: "o3" },
      { value: "gpt-5.4-mini", label: "GPT-5.4 mini" },
      { value: "gpt-4o-2024-08-06", label: "GPT-4o (2024-08-06)" },
    ])
  })
})

describe("anthropicModelOptions", () => {
  it("labels by display name, newest first", () => {
    expect(
      anthropicModelOptions([
        { id: "claude-haiku-4-5", display_name: "Claude Haiku 4.5", created_at: "2025-10-01T00:00:00Z" },
        { id: "claude-opus-5-5", display_name: "Claude Opus 5.5", created_at: "2026-09-01T00:00:00Z" },
      ]),
    ).toEqual([
      { value: "claude-opus-5-5", label: "Claude Opus 5.5" },
      { value: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
    ])
  })
})

describe("withSavedModel", () => {
  const list = [{ value: "a", label: "A" }]

  it("appends a saved model the list lacks", () => {
    expect(withSavedModel(list, "custom")).toEqual([...list, { value: "custom", label: "custom" }])
  })

  it("leaves the list alone when the model is listed or empty", () => {
    expect(withSavedModel(list, "a")).toBe(list)
    expect(withSavedModel(list, "")).toBe(list)
  })
})

describe("loadProviderModels", () => {
  const opus = { id: "claude-opus-5-5", display_name: "Claude Opus 5.5", created_at: "2026-09-01T00:00:00Z" }

  it("fetches once per key and serves the cache after", async () => {
    anthropicList.mockImplementation(() => page([opus]))

    const first = await loadProviderModels("anthropic", "sk-1")
    const second = await loadProviderModels("anthropic", "sk-1")

    expect(first).toEqual([{ value: "claude-opus-5-5", label: "Claude Opus 5.5" }])
    expect(second).toBe(first)
    expect(cachedProviderModels("anthropic", "sk-1")).toBe(first)
    expect(anthropicList).toHaveBeenCalledTimes(1)
  })

  it("refetches when the key changes", async () => {
    anthropicList.mockImplementation(() => page([opus]))

    await loadProviderModels("anthropic", "sk-1")
    await loadProviderModels("anthropic", "sk-2")

    expect(anthropicList).toHaveBeenCalledTimes(2)
    expect(cachedProviderModels("anthropic", "sk-1")).toBeUndefined()
  })

  it("keeps providers apart", async () => {
    anthropicList.mockImplementation(() => page([opus]))
    openAiList.mockImplementation(() => page([{ id: "gpt-6-sol", created: 1 }]))

    await loadProviderModels("anthropic", "sk-1")
    expect(await loadProviderModels("openai", "sk-1")).toEqual([
      { value: "gpt-6-sol", label: "GPT-6 Sol" },
    ])
  })

  it("forgets a failure so the next ask retries", async () => {
    anthropicList.mockImplementationOnce(() => failing())
    await expect(loadProviderModels("anthropic", "sk-1")).rejects.toThrow("invalid x-api-key")

    anthropicList.mockImplementation(() => page([opus]))
    expect(await loadProviderModels("anthropic", "sk-1")).toHaveLength(1)
    expect(anthropicList).toHaveBeenCalledTimes(2)
  })
})
