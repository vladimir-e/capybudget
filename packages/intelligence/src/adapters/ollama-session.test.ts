import { describe, it, expect, vi, beforeEach } from "vitest"
import type { StreamEvent } from "@capybudget/intelligence"
import type { BudgetRepository, FileAdapter } from "@capybudget/persistence"

// The Ollama adapter is the OpenAI transport with a different endpoint, so the
// only things worth asserting here are the two it actually changes: how the
// client is constructed, and how errors are attributed.
const { clientConfigs, mockCreate } = vi.hoisted(() => ({
  clientConfigs: [] as Array<{ apiKey: string; baseURL?: string }>,
  mockCreate: vi.fn(),
}))

vi.mock("openai", () => {
  return {
    default: class {
      chat = { completions: { create: mockCreate } }
      constructor(config: { apiKey: string; baseURL?: string }) {
        clientConfigs.push(config)
      }
    },
  }
})

import { OllamaSession } from "./ollama-session"
import { OpenAiSession } from "./openai-session"

function makeSession(baseUrl: string | undefined = "http://localhost:11434/v1") {
  const events: StreamEvent[] = []
  const session = new OllamaSession({
    budgetPath: "/budget",
    systemPrompt: "you are capy",
    apiKey: "ollama",
    model: "qwen3",
    baseUrl,
    onEvent: (e) => events.push(e),
    repo: {} as BudgetRepository,
    fileAdapter: {} as FileAdapter,
    currency: "USD",
  })
  return { session, events }
}

beforeEach(() => {
  clientConfigs.length = 0
  mockCreate.mockReset()
})

describe("OllamaSession", () => {
  it("points the OpenAI client at the configured local endpoint", () => {
    makeSession("http://127.0.0.1:9999/v1")
    expect(clientConfigs).toHaveLength(1)
    expect(clientConfigs[0]).toMatchObject({
      apiKey: "ollama",
      baseURL: "http://127.0.0.1:9999/v1",
    })
  })

  it("is the OpenAI transport — same session surface, one subclass", () => {
    const { session } = makeSession()
    expect(session).toBeInstanceOf(OpenAiSession)
  })

  it("attributes errors to ollama, not openai, so the UI routes copy correctly", async () => {
    const { session, events } = makeSession()
    mockCreate.mockRejectedValue(new Error("model 'qwen3' not found"))

    await session.send("hi")

    const error = events.find((e) => e.type === "error")
    expect(error).toMatchObject({ type: "error", provider: "ollama" })
  })
})
