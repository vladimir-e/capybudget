import { beforeEach, describe, expect, it, vi } from "vitest"
import { OLLAMA_PLACEHOLDER_KEY } from "@capybudget/intelligence"

const { ctorArgs, modelsList, chatCreate, responsesCreate } = vi.hoisted(() => ({
  ctorArgs: [] as unknown[],
  modelsList: vi.fn(),
  chatCreate: vi.fn(),
  responsesCreate: vi.fn(),
}))

vi.mock("openai", () => ({
  default: class {
    static APIConnectionError = class extends Error {}
    models = { list: modelsList }
    chat = { completions: { create: chatCreate } }
    responses = { create: responsesCreate }
    constructor(opts: unknown) {
      ctorArgs.push(opts)
    }
  },
}))

import { listOllamaModels, pingOllama, pingOpenAi } from "./api-testing"

beforeEach(() => {
  ctorArgs.length = 0
  modelsList.mockReset()
  chatCreate.mockReset()
  responsesCreate.mockReset()
})

describe("listOllamaModels", () => {
  it("targets the given server with the placeholder key and sorts the ids", async () => {
    modelsList.mockResolvedValue({ data: [{ id: "qwen3" }, { id: "llama3.1" }] })

    expect(await listOllamaModels("http://box:11434/v1")).toEqual(["llama3.1", "qwen3"])
    expect(ctorArgs[0]).toMatchObject({ apiKey: OLLAMA_PLACEHOLDER_KEY, baseURL: "http://box:11434/v1" })
  })

  it("throws when the server is unreachable", async () => {
    modelsList.mockRejectedValue(new Error("fetch failed"))

    await expect(listOllamaModels("http://box:11434/v1")).rejects.toThrow("fetch failed")
  })
})

describe("pingOllama", () => {
  it("chats once with the chosen model against the given server", async () => {
    chatCreate.mockResolvedValue({})

    expect(await pingOllama("http://box:11434/v1", "qwen3")).toEqual({ ok: true, message: "" })
    expect(ctorArgs[0]).toMatchObject({ apiKey: OLLAMA_PLACEHOLDER_KEY, baseURL: "http://box:11434/v1" })
    expect(chatCreate).toHaveBeenCalledWith(expect.objectContaining({ model: "qwen3" }))
  })

  it("reports the failure message instead of throwing", async () => {
    chatCreate.mockRejectedValue(new Error("model 'qwen3' not found"))

    expect(await pingOllama("http://box:11434/v1", "qwen3")).toEqual({
      ok: false,
      message: "model 'qwen3' not found",
    })
  })
})

describe("pingOllama — routed failures", () => {
  it("flags an unreachable server and names it", async () => {
    const { default: OpenAI } = await import("openai")
    chatCreate.mockRejectedValue(new OpenAI.APIConnectionError({ message: "Connection error." }))

    expect(await pingOllama("http://box:11434/v1", "qwen3")).toEqual({
      ok: false,
      message: "Can't reach Ollama at http://box:11434",
      unreachable: true,
    })
  })

  it("reports the vendor message, not the raw status line", async () => {
    const err = Object.assign(new Error('404 {"error":{"message":"model \'qwen3\' not found"}}'), {
      status: 404,
      error: { message: "model 'qwen3' not found" },
    })
    chatCreate.mockRejectedValue(err)

    expect(await pingOllama("http://box:11434/v1", "qwen3")).toEqual({
      ok: false,
      message: "model 'qwen3' not found",
    })
  })
})

describe("pingOpenAi", () => {
  it("makes one tiny, unstored Responses call with the chosen model", async () => {
    responsesCreate.mockResolvedValue({})

    expect(await pingOpenAi("sk-test", "gpt-6-astra")).toEqual({ ok: true, message: "" })
    expect(responsesCreate).toHaveBeenCalledWith({
      model: "gpt-6-astra",
      max_output_tokens: 16,
      store: false,
      input: "Hi",
    })
    expect(chatCreate).not.toHaveBeenCalled()
  })

  it("reports the failure message instead of throwing", async () => {
    responsesCreate.mockRejectedValue(new Error("Incorrect API key provided"))

    expect(await pingOpenAi("sk-bad", "gpt-6-astra")).toEqual({ ok: false, message: "Incorrect API key provided" })
  })
})
