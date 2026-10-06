import { beforeEach, describe, expect, it, vi } from "vitest"

const sdk = vi.hoisted(() => ({
  anthropicArgs: [] as unknown[],
  openAiArgs: [] as unknown[],
  anthropicList: vi.fn(),
  anthropicCreate: vi.fn(),
  openAiList: vi.fn(),
  chatCreate: vi.fn(),
  responsesCreate: vi.fn(),
}))

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    static APIConnectionError = class extends Error {}
    models = { list: sdk.anthropicList }
    messages = { create: sdk.anthropicCreate }
    constructor(opts: unknown) {
      sdk.anthropicArgs.push(opts)
    }
  },
}))

vi.mock("openai", () => ({
  default: class {
    static APIConnectionError = class extends Error {}
    models = { list: sdk.openAiList }
    chat = { completions: { create: sdk.chatCreate } }
    responses = { create: sdk.responsesCreate }
    constructor(opts: unknown) {
      sdk.openAiArgs.push(opts)
    }
  },
}))

import { listModels, pingProvider } from "./providers"

async function* page<T>(items: T[]) {
  yield* items
}

function unreachable(): AsyncIterable<never> {
  return {
    [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error("fetch failed")) }),
  }
}

beforeEach(() => {
  sdk.anthropicArgs.length = 0
  sdk.openAiArgs.length = 0
  for (const mock of [sdk.anthropicList, sdk.anthropicCreate, sdk.openAiList, sdk.chatCreate, sdk.responsesCreate]) {
    mock.mockReset()
  }
})

describe("listModels", () => {
  it("lists Anthropic models newest first under their display names", async () => {
    sdk.anthropicList.mockImplementation(() =>
      page([
        { id: "claude-haiku-4-5", display_name: "Claude Haiku 4.5", created_at: "2025-10-01T00:00:00Z" },
        { id: "claude-opus-5-5", display_name: "Claude Opus 5.5", created_at: "2026-09-01T00:00:00Z" },
      ]),
    )

    expect(await listModels({ provider: "anthropic", apiKey: "sk-ant" })).toEqual([
      { value: "claude-opus-5-5", label: "Claude Opus 5.5" },
      { value: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
    ])
    expect(sdk.anthropicArgs[0]).toMatchObject({ apiKey: "sk-ant" })
  })

  it("keeps only OpenAI chat models", async () => {
    sdk.openAiList.mockImplementation(() =>
      page([
        { id: "gpt-image-2", created: 2 },
        { id: "gpt-6-sol", created: 1 },
      ]),
    )

    expect(await listModels({ provider: "openai", apiKey: "sk-oai" })).toEqual([
      { value: "gpt-6-sol", label: "GPT-6 Sol" },
    ])
  })

  it("targets the given Ollama server with the placeholder key", async () => {
    sdk.openAiList.mockImplementation(() => page([{ id: "qwen3" }, { id: "llama3.1" }]))

    expect(await listModels({ provider: "ollama", baseUrl: "http://box:11434/v1" })).toEqual([
      { value: "llama3.1", label: "llama3.1" },
      { value: "qwen3", label: "qwen3" },
    ])
    expect(sdk.openAiArgs[0]).toMatchObject({ apiKey: "ollama", baseURL: "http://box:11434/v1" })
  })

  it("throws when the server is unreachable", async () => {
    sdk.openAiList.mockImplementation(unreachable)

    await expect(listModels({ provider: "ollama", baseUrl: "http://box:11434/v1" })).rejects.toThrow("fetch failed")
  })
})

describe("pingProvider", () => {
  it("makes one tiny, unstored OpenAI Responses call with the chosen model", async () => {
    sdk.responsesCreate.mockResolvedValue({})

    expect(await pingProvider({ provider: "openai", apiKey: "sk-test", model: "gpt-6-astra" })).toEqual({ ok: true })
    expect(sdk.responsesCreate).toHaveBeenCalledWith({
      model: "gpt-6-astra",
      max_output_tokens: 16,
      store: false,
      input: "Hi",
    })
    expect(sdk.chatCreate).not.toHaveBeenCalled()
  })

  it("falls back to the default Anthropic model when none is picked", async () => {
    sdk.anthropicCreate.mockResolvedValue({})

    expect(await pingProvider({ provider: "anthropic", apiKey: "sk-ant", model: "" })).toEqual({ ok: true })
    expect(sdk.anthropicCreate).toHaveBeenCalledWith(expect.objectContaining({ model: "claude-sonnet-5" }))
  })

  it("chats once with the chosen model against the given Ollama server", async () => {
    sdk.chatCreate.mockResolvedValue({})

    expect(await pingProvider({ provider: "ollama", baseUrl: "http://box:11434/v1", model: "qwen3" })).toEqual({ ok: true })
    expect(sdk.openAiArgs[0]).toMatchObject({ apiKey: "ollama", baseURL: "http://box:11434/v1" })
    expect(sdk.chatCreate).toHaveBeenCalledWith(expect.objectContaining({ model: "qwen3" }))
  })

  it("reports the failure message instead of throwing", async () => {
    sdk.responsesCreate.mockRejectedValue(new Error("Incorrect API key provided"))

    expect(await pingProvider({ provider: "openai", apiKey: "sk-bad", model: "gpt-6-astra" })).toEqual({
      ok: false,
      message: "Incorrect API key provided",
      unreachable: false,
    })
  })

  it("reports the vendor message, not the raw status line", async () => {
    const err = Object.assign(new Error('404 {"error":{"message":"model \'qwen3\' not found"}}'), {
      status: 404,
      error: { message: "model 'qwen3' not found" },
    })
    sdk.chatCreate.mockRejectedValue(err)

    expect(await pingProvider({ provider: "ollama", baseUrl: "http://box:11434/v1", model: "qwen3" })).toEqual({
      ok: false,
      message: "model 'qwen3' not found",
      unreachable: false,
    })
  })

  it("flags an unreachable server", async () => {
    const { default: OpenAI } = await import("openai")
    sdk.chatCreate.mockRejectedValue(new OpenAI.APIConnectionError({ message: "Connection error." }))

    expect(await pingProvider({ provider: "ollama", baseUrl: "http://box:11434/v1", model: "qwen3" })).toMatchObject({
      ok: false,
      unreachable: true,
    })
  })
})
