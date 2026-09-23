import { beforeEach, describe, expect, it, vi } from "vitest"
import { OLLAMA_PLACEHOLDER_KEY } from "@capybudget/intelligence"

const { ctorArgs, modelsList, chatCreate } = vi.hoisted(() => ({
  ctorArgs: [] as unknown[],
  modelsList: vi.fn(),
  chatCreate: vi.fn(),
}))

vi.mock("openai", () => ({
  default: class {
    models = { list: modelsList }
    chat = { completions: { create: chatCreate } }
    constructor(opts: unknown) {
      ctorArgs.push(opts)
    }
  },
}))

import { listOllamaModels, pingOllama } from "./api-testing"

beforeEach(() => {
  ctorArgs.length = 0
  modelsList.mockReset()
  chatCreate.mockReset()
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
