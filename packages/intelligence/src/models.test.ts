import { describe, expect, it } from "vitest"
import { DEFAULT_INTELLIGENCE_CONFIG, type HostedProvider } from "./config"
import {
  anthropicModelOptions,
  FALLBACK_MODELS,
  isOpenAiChatModel,
  ollamaModelOptions,
  openAiModelLabel,
  openAiModelOptions,
} from "./models"

describe("isOpenAiChatModel", () => {
  it.each([
    "gpt-6-sol",
    "gpt-5.4-mini",
    "gpt-4o",
    "gpt-4.1-nano",
    "gpt-5-chat-latest",
    "o3",
    "o4-mini",
    "gpt-5-pro",
    "gpt-5-pro-2025-10-06",
    "gpt-5-codex",
    "gpt-5.1-codex-mini",
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
    "gpt-3.5-turbo-instruct",
    "o3-deep-research",
    "o1-mini",
    "o1-preview",
    "o1-mini-2024-09-12",
    "o1-pro",
    "o3-pro",
    "o3-pro-2025-06-10",
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
    ["o3-2025-04-16", "o3 (2025-04-16)"],
    ["o4-mini-2025-04-16", "o4-mini (2025-04-16)"],
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

describe("FALLBACK_MODELS", () => {
  it.each<HostedProvider>(["anthropic", "openai"])("offers the %s default model", (provider) => {
    const values = FALLBACK_MODELS[provider].map((m) => m.value)
    expect(values).toContain(DEFAULT_INTELLIGENCE_CONFIG[provider].model)
  })
})

describe("ollamaModelOptions", () => {
  it("labels each pulled model by its id, alphabetically", () => {
    expect(ollamaModelOptions([{ id: "qwen3" }, { id: "llama3.1" }])).toEqual([
      { value: "llama3.1", label: "llama3.1" },
      { value: "qwen3", label: "qwen3" },
    ])
  })
})
