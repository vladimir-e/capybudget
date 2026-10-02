import { describe, it, expect, vi, beforeEach } from "vitest"
import OpenAI from "openai"
import type { BudgetRepository, FileAdapter } from "@capybudget/persistence"
import type { StreamEvent } from "../types"
import { CutOffError, RefusedError, UnreachableError } from "../structured"
import { UNANSWERED_RESULT } from "./agent-turn"
import { OpenAiSession } from "./openai-session"
import { responsesApiError as apiError, responsesSdk } from "./test-doubles/openai-sdk"
import { lastBlocks, mockRunTool } from "./test-doubles/harness"

vi.mock("openai", async () => ({ default: (await import("./test-doubles/openai-sdk")).FakeOpenAI }))
vi.mock("../tools", async (importOriginal) => (await import("./test-doubles/harness")).toolsWithMockedRun(importOriginal))

type Item = Record<string, unknown>

const { create: mockCreate, queueTurn, queueStructured, lastCall: lastCreateCall, allCalls: allCreateCalls, streams } = responsesSdk

function makeSession(onEvent?: (e: StreamEvent, session: OpenAiSession) => void) {
  const events: StreamEvent[] = []
  const session: OpenAiSession = new OpenAiSession({
    budgetPath: "/budget",
    systemPrompt: "you are capy",
    apiKey: "sk-openai-test",
    model: "gpt-6-astra",
    onEvent: (e) => {
      events.push(e)
      onEvent?.(e, session)
    },
    repo: {} as BudgetRepository,
    fileAdapter: {} as FileAdapter,
    currency: "USD",
  })
  return { session, events }
}

function history(session: OpenAiSession): Item[] {
  return (session as unknown as { messages: Item[] }).messages
}

function outputs(input: Item[]): Array<{ call_id: unknown; output: unknown }> {
  return input
    .filter((item) => item.type === "function_call_output")
    .map((item) => ({ call_id: item.call_id, output: item.output }))
}

beforeEach(() => {
  responsesSdk.reset()
  mockRunTool.mockReset()
})

describe("OpenAiSession", () => {
  it("sends the system prompt as instructions and keeps no server-side state", async () => {
    queueTurn({ textDeltas: ["ok"], status: "completed" })
    const { session } = makeSession()
    await session.send("Hi")

    const call = lastCreateCall()
    expect(call.instructions).toBe("you are capy")
    expect(call.store).toBe(false)
    expect(call.previous_response_id).toBeUndefined()
    expect(call.include).toEqual(["reasoning.encrypted_content"])
    expect(call.input).toEqual([{ role: "user", content: "Hi" }])
  })

  it("replays the full input each turn, the stored reply included", async () => {
    queueTurn({ textDeltas: ["Hello"], status: "completed" })
    queueTurn({ textDeltas: ["Again"], status: "completed" })
    const { session } = makeSession()
    await session.send("Hi")
    await session.send("More")

    expect(lastCreateCall().input).toEqual([
      { role: "user", content: "Hi" },
      {
        type: "message",
        id: "msg_1",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: "Hello", annotations: [] }],
      },
      { role: "user", content: "More" },
    ])
  })

  it("keeps the tools + instructions prefix byte-stable across turns (prefix caching)", async () => {
    queueTurn({ calls: [{ id: "call_1", name: "list_accounts", argFragments: ["{}"] }], status: "completed" })
    queueTurn({ textDeltas: ["Done."], status: "completed" })
    mockRunTool.mockResolvedValueOnce("ok")

    const { session } = makeSession()
    await session.send("How much do I have?")

    const [turn1, turn2] = allCreateCalls().slice(-2)
    expect(turn1.tools).toEqual(turn2.tools)
    expect(turn1.instructions).toBe("you are capy")
    expect(turn2.instructions).toBe(turn1.instructions)
  })

  it("defines tools as flat, non-strict function tools", async () => {
    queueTurn({ textDeltas: ["ok"], status: "completed" })
    const { session } = makeSession()
    await session.send("hi")

    const tool = lastCreateCall().tools!.find((t) => t.name === "list_accounts")
    expect(tool).toMatchObject({ type: "function", name: "list_accounts", strict: false })
    expect(tool).toHaveProperty("parameters")
    expect(tool).toHaveProperty("description")
  })

  it("dispatches a tool call (arguments arrive across many deltas), answers it by call_id, and continues the loop", async () => {
    queueTurn({
      textDeltas: ["Looking up..."],
      calls: [{ id: "call_abc", name: "list_transactions", argFragments: ['{"', "limit", '":', " 5", "}"] }],
      status: "completed",
    })
    queueTurn({ textDeltas: ["Found 5 transactions."], status: "completed" })
    mockRunTool.mockResolvedValueOnce("5 transactions found")

    const { session, events } = makeSession()
    await session.send("Show recent")

    expect(mockRunTool).toHaveBeenCalledWith(
      "list_transactions",
      { limit: 5 },
      expect.objectContaining({ budgetPath: "/budget", currency: "USD" }),
    )
    const input = lastCreateCall().input
    expect(input.map((item) => item.type ?? item.role)).toEqual([
      "user",
      "message",
      "function_call",
      "function_call_output",
    ])
    expect(input[2]).toMatchObject({ call_id: "call_abc", name: "list_transactions", arguments: '{"limit": 5}' })
    expect(input[3]).toEqual({ type: "function_call_output", call_id: "call_abc", output: "5 transactions found" })
    expect(lastBlocks(events)).toEqual([
      { type: "text", content: "Looking up..." },
      { type: "tool-activity", tool: "list_transactions", status: "done" },
      { type: "text", content: "Found 5 transactions." },
    ])
    expect(events.at(-1)).toEqual({ type: "done" })
  })

  it("shows a call's card as soon as its item finishes streaming", async () => {
    let cardShownBeforeRun = false
    mockRunTool.mockImplementation(async () => {
      cardShownBeforeRun = true
      return "ok"
    })
    queueTurn({ calls: [{ id: "call_a", name: "list_accounts", argFragments: ["{}"] }], status: "completed" })
    queueTurn({ textDeltas: ["Done."], status: "completed" })

    const { session, events } = makeSession()
    await session.send("hi")

    const firstCard = events.findIndex(
      (e) => e.type === "content" && e.blocks.some((b) => b.type === "tool-activity"),
    )
    expect(firstCard).toBeGreaterThanOrEqual(0)
    expect(cardShownBeforeRun).toBe(true)
  })

  it("surfaces a parse error in the tool result when arguments are malformed JSON", async () => {
    queueTurn({ calls: [{ id: "call_bad", name: "create_transaction", argFragments: ['{"limit', ": 5"] }], status: "completed" })
    queueTurn({ textDeltas: ["Sorry, I'll try again."], status: "completed" })

    const { session, events } = makeSession()
    await session.send("Show recent")

    expect(mockRunTool).not.toHaveBeenCalled()
    const [reply] = outputs(lastCreateCall().input)
    expect(reply.call_id).toBe("call_bad")
    expect(reply.output).toMatch(/invalid JSON arguments/i)
    expect(events.filter((e) => e.type === "tool-result")).toEqual([
      { type: "tool-result", tool: "create_transaction", id: "call_bad", ok: false },
    ])
  })

  it("extracts the inner message from an OpenAI APIError-shaped throw", async () => {
    const err = new Error("429 You exceeded your current quota") as Error & { status: number; error: unknown }
    err.status = 429
    err.error = {
      type: "insufficient_quota",
      code: "insufficient_quota",
      message: "You exceeded your current quota, please check your plan and billing details.",
      param: null,
    }
    queueTurn({ status: null, error: err })

    const { session, events } = makeSession()
    await session.send("Hi")

    expect(events.find((e) => e.type === "error")).toEqual({
      type: "error",
      message: "You exceeded your current quota, please check your plan and billing details.",
      status: 429,
      provider: "openai",
    })
  })

  it.each([
    ["a response.failed event", { failure: "The server had an error." }],
    ["an error event", { errorEvent: "The server had an error." }],
  ])("reports %s as an error, not as a cut-off", async (_label, ending) => {
    queueTurn({ textDeltas: ["Let me"], status: null, ...ending })

    const { session, events } = makeSession()
    await session.send("Hi")

    expect(events.at(-1)).toEqual({ type: "error", message: "The server had an error.", provider: "openai" })
  })

  it("answers only the calls a trailing turn left unanswered before appending the next user message", async () => {
    const { session } = makeSession()
    history(session).push(
      { role: "user", content: "Add it" },
      { type: "function_call", call_id: "call_a", name: "create_transaction", arguments: "{}" },
      { type: "function_call", call_id: "call_b", name: "create_transaction", arguments: "{}" },
      { type: "function_call_output", call_id: "call_a", output: "created" },
    )

    queueTurn({ textDeltas: ["ok"], status: "completed" })
    await session.send("Hello?")

    expect(lastCreateCall().input.slice(3)).toEqual([
      { type: "function_call_output", call_id: "call_a", output: "created" },
      { type: "function_call_output", call_id: "call_b", output: UNANSWERED_RESULT },
      { role: "user", content: "Hello?" },
    ])
  })

  it("forwards images as input_image and PDFs as input_file", async () => {
    queueTurn({ textDeltas: ["ok"], status: "completed" })
    const { session } = makeSession()
    await session.send([
      { type: "text", text: "Receipt extraction" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
      {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: "BBBB" },
        filename: "statement.pdf",
      },
    ])

    expect(lastCreateCall().input[0]).toEqual({
      role: "user",
      content: [
        { type: "input_text", text: "Receipt extraction" },
        { type: "input_image", image_url: "data:image/png;base64,AAAA", detail: "auto" },
        { type: "input_file", filename: "statement.pdf", file_data: "data:application/pdf;base64,BBBB" },
      ],
    })
  })

  it("falls back to document.pdf when a document block carries no filename", async () => {
    queueTurn({ textDeltas: ["ok"], status: "completed" })
    const { session } = makeSession()
    await session.send([{ type: "document", source: { type: "base64", media_type: "application/pdf", data: "CCCC" } }])

    const content = lastCreateCall().input[0].content as Item[]
    expect(content[0]).toMatchObject({ type: "input_file", filename: "document.pdf" })
  })

  it("stores nothing for a completed response that carries no message or call", async () => {
    queueTurn({ calls: [{ id: "tc-1", name: "list_accounts", argFragments: ["{}"] }], status: "completed" })
    queueTurn({ reasoning: { id: "rs_empty", encrypted: "enc-empty" }, status: "completed" })
    mockRunTool.mockResolvedValue("ok")

    const { session, events } = makeSession()
    await session.send("how am I doing?")

    expect(history(session).some((item) => item.id === "rs_empty")).toBe(false)
    expect(events.at(-1)).toEqual({ type: "done" })
  })

  it("returns at the terminal event without consuming anything after it", async () => {
    queueTurn({ textDeltas: ["visible"], status: "completed", tailDelta: "INVISIBLE" })

    const { session, events } = makeSession()
    await session.send("Hi")

    expect(lastBlocks(events)).toEqual([{ type: "text", content: "visible" }])
  })
})

describe("OpenAiSession reasoning", () => {
  it("replays reasoning items, encrypted content intact, ahead of the calls they led to", async () => {
    queueTurn({
      reasoning: { id: "rs_1", encrypted: "gAAAA-opaque" },
      calls: [{ id: "call_a", name: "list_accounts", argFragments: ["{}"] }],
      status: "completed",
    })
    queueTurn({ reasoning: { id: "rs_2", encrypted: "gAAAA-second" }, textDeltas: ["Done."], status: "completed" })
    mockRunTool.mockResolvedValueOnce("ok")

    const { session } = makeSession()
    await session.send("Balances?")

    const input = lastCreateCall().input
    expect(input.map((item) => item.type ?? item.role)).toEqual(["user", "reasoning", "function_call", "function_call_output"])
    expect(input[1]).toEqual({ type: "reasoning", id: "rs_1", summary: [], encrypted_content: "gAAAA-opaque" })
    expect(input[2]).toMatchObject({ type: "function_call", id: "fc_call_a", call_id: "call_a" })

    queueTurn({ textDeltas: ["ok"], status: "completed" })
    await session.send("Thanks")
    expect(lastCreateCall().input.find((item) => item.id === "rs_2")).toEqual({
      type: "reasoning",
      id: "rs_2",
      summary: [],
      encrypted_content: "gAAAA-second",
    })
  })

  it("drops the reasoning include for the session when the model rejects encrypted content", async () => {
    queueTurn({ status: null, error: apiError(400, "Encrypted content is not supported with this model.", "include") })
    queueTurn({ textDeltas: ["ok"], status: "completed" })
    queueTurn({ textDeltas: ["again"], status: "completed" })

    const { session, events } = makeSession()
    await session.send("Hi")
    expect(events.at(-1)).toEqual({ type: "done" })
    expect(lastCreateCall().include).toBeUndefined()

    await session.send("More")
    expect(mockCreate).toHaveBeenCalledTimes(3)
    expect(lastCreateCall().include).toBeUndefined()
  })

  it("surfaces encrypted content that fails verification, keeping the reasoning include", async () => {
    const message = "The encrypted content for item rs_1 could not be verified."
    queueTurn({ status: null, error: apiError(400, message, null, "invalid_encrypted_content") })

    const { session, events } = makeSession()
    await session.send("Hi")
    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(events.at(-1)).toMatchObject({ type: "error", status: 400, message })

    queueTurn({ textDeltas: ["ok"], status: "completed" })
    await session.send("Again")
    expect(lastCreateCall().include).toEqual(["reasoning.encrypted_content"])
  })
})

describe("OpenAiSession endings", () => {
  it.each([
    ["incomplete with max_output_tokens", "max_output_tokens" as const, "cutOff"],
    ["incomplete with content_filter", "content_filter" as const, "refused"],
  ])("never runs calls from a response %s, keeps only its text, and reports %s", async (_label, reason, code) => {
    queueTurn({
      textDeltas: ["Let me check"],
      calls: [{ id: "call_1", name: "list_transactions", argFragments: ['{"lim'] }],
      status: "incomplete",
      incompleteReason: reason,
    })

    const { session, events } = makeSession()
    await session.send("hi")
    expect(mockRunTool).not.toHaveBeenCalled()
    expect(events.at(-1)).toMatchObject({ type: "error", code })
    expect(lastBlocks(events)).toEqual([{ type: "text", content: "Let me check" }])

    queueTurn({ textDeltas: ["ok"], status: "completed" })
    await session.send("again")
    const input = lastCreateCall().input
    expect(input.some((item) => item.type === "function_call")).toBe(false)
    expect(input).toContainEqual({ role: "assistant", content: "Let me check" })
  })

  it("reports a stream with no terminal event as cutOff, keeping its text", async () => {
    queueTurn({ textDeltas: ["A long answer that"], status: null })

    const { session, events } = makeSession()
    await session.send("Explain")

    expect(events.at(-1)).toMatchObject({ type: "error", code: "cutOff" })
    expect(history(session).at(-1)).toEqual({ role: "assistant", content: "A long answer that" })
  })

  it("keeps only the text streamed before the first call when a response is cut off", async () => {
    queueTurn({
      textDeltas: ["Checking"],
      calls: [{ id: "call_1", name: "list_accounts", argFragments: ["{}"] }],
      trailingTextDeltas: ["and more"],
      status: "incomplete",
      incompleteReason: "max_output_tokens",
    })

    const { session, events } = makeSession()
    await session.send("hi")

    expect(lastBlocks(events)).toEqual([{ type: "text", content: "Checking" }])
    expect(history(session).slice(1)).toEqual([{ role: "assistant", content: "Checking" }])
  })

  it("reports a streamed refusal as refused, storing nothing", async () => {
    queueTurn({ refusalDeltas: ["I can't ", "help with that."], status: "completed" })

    const { session, events } = makeSession()
    await session.send("hi")

    expect(events.at(-1)).toMatchObject({ type: "error", code: "refused" })
    expect(events.some((e) => e.type === "done")).toBe(false)
    expect(history(session).some((item) => item.role === "assistant" || item.type === "message")).toBe(false)
  })

  it("reports a refusal alongside a function call as refused, never running the call", async () => {
    queueTurn({
      refusalDeltas: ["I can't help with that."],
      calls: [{ id: "call_1", name: "list_accounts", argFragments: ["{}"] }],
      status: "completed",
    })

    const { session, events } = makeSession()
    await session.send("hi")

    expect(mockRunTool).not.toHaveBeenCalled()
    expect(events.at(-1)).toMatchObject({ type: "error", code: "refused" })
    expect(history(session).some((item) => item.type === "function_call")).toBe(false)
  })

  it.each([
    ["incomplete with max_output_tokens", "incomplete" as const, "max_output_tokens" as const, "cutOff"],
    ["incomplete with content_filter", "incomplete" as const, "content_filter" as const, "refused"],
    ["cut short of a terminal event", null, undefined, "cutOff"],
  ])("reports a text-less response %s as %s instead of an empty reply", async (_label, status, reason, code) => {
    queueTurn({
      calls: [{ id: "call_1", name: "list_transactions", argFragments: ['{"lim'] }],
      status,
      incompleteReason: reason,
    })

    const { session, events } = makeSession()
    await session.send("hi")

    expect(events.find((e) => e.type === "error")).toMatchObject({ type: "error", code })
    expect(events.some((e) => e.type === "done")).toBe(false)
    expect(lastBlocks(events)).toEqual([])
    expect(history(session)).toEqual([{ role: "user", content: "hi" }])
  })

  it("stays silent when stop() lands as a text-less response is cut off", async () => {
    const { session, events } = makeSession()
    mockCreate.mockImplementationOnce(async () => ({
      async *[Symbol.asyncIterator]() {
        yield {
          type: "response.output_item.added",
          output_index: 0,
          item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "list_transactions", arguments: "" },
        }
        await session.stop()
      },
    }))

    await session.send("hi")

    expect(events.some((e) => e.type === "error" || e.type === "done")).toBe(false)
  })
})

describe("OpenAiSession.structured", () => {
  const SCHEMA = {
    type: "object" as const,
    properties: { ok: { type: "boolean" as const } },
    required: ["ok"],
  }

  it("makes one constrained, tool-free, stateless call and returns the parsed result", async () => {
    queueStructured({ text: '{"ok": true}' })

    const { session } = makeSession()
    const result = await session.structured<{ ok: boolean }>([{ role: "user", content: "extract" }], SCHEMA)

    expect(result).toEqual({ ok: true })
    expect(mockCreate).toHaveBeenCalledTimes(1)
    const call = lastCreateCall()
    expect(call.tools).toBeUndefined()
    expect(call.store).toBe(false)
    expect(call.instructions).toBe("you are capy")
    expect(call.text).toEqual({
      format: { type: "json_schema", name: "structured_output", schema: SCHEMA, strict: false },
    })
  })

  it("sends strict on the format wrapper, not inside the schema, for a strict schema", async () => {
    queueStructured({ text: '{"ok": true}' })
    const STRICT_SCHEMA = {
      type: "object" as const,
      additionalProperties: false,
      strict: true,
      properties: { ok: { type: "boolean" as const } },
      required: ["ok"],
    }

    const { session } = makeSession()
    await session.structured([{ role: "user", content: "x" }], STRICT_SCHEMA)

    const { format } = lastCreateCall().text as { format: { strict: boolean; schema: Record<string, unknown> } }
    expect(format.strict).toBe(true)
    expect(format.schema).not.toHaveProperty("strict")
    expect(format.schema).toMatchObject({ additionalProperties: false })
  })

  it("forwards images as input_image and PDFs as input_file", async () => {
    queueStructured({ text: '{"ok": true}' })

    const { session } = makeSession()
    await session.structured(
      [
        {
          role: "user",
          content: [
            { type: "text", text: "read this receipt" },
            { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: "BBBB" },
              filename: "receipt.pdf",
            },
          ],
        },
      ],
      SCHEMA,
    )

    const content = lastCreateCall().input[0].content as Item[]
    expect(content.map((part) => part.type)).toEqual(["input_text", "input_image", "input_file"])
    expect(content[2]).toEqual({
      type: "input_file",
      filename: "receipt.pdf",
      file_data: "data:application/pdf;base64,BBBB",
    })
  })

  it("rejects when the model returns output that violates the schema", async () => {
    queueStructured({ text: '{"ok": "not a boolean"}' })

    const { session } = makeSession()
    await expect(session.structured([{ role: "user", content: "x" }], SCHEMA)).rejects.toThrowError(/boolean/i)
  })

  it("passes an assistant turn through as plain text content", async () => {
    queueStructured({ text: '{"ok": true}' })

    const { session } = makeSession()
    await session.structured(
      [
        { role: "user", content: "extract" },
        { role: "assistant", content: '{"ok": false}' },
        { role: "user", content: "redo it" },
      ],
      SCHEMA,
    )

    expect(lastCreateCall().input).toEqual([
      { role: "user", content: "extract" },
      { role: "assistant", content: '{"ok": false}' },
      { role: "user", content: "redo it" },
    ])
  })

  it("streams when onText is set, surfacing accumulated (not per-delta) text", async () => {
    queueTurn({ textDeltas: ['{"ok"', ": true}"], status: "completed" })
    const onText = vi.fn()

    const { session } = makeSession()
    const result = await session.structured<{ ok: boolean }>([{ role: "user", content: "extract" }], SCHEMA, { onText })

    expect(result).toEqual({ ok: true })
    expect(onText.mock.calls.map((c) => c[0])).toEqual(['{"ok"', '{"ok": true}'])
    const call = lastCreateCall()
    expect(call.stream).toBe(true)
    expect(call.text).toEqual({
      format: { type: "json_schema", name: "structured_output", schema: SCHEMA, strict: false },
    })
  })

  it("resolves the streaming call to the same value as the non-streaming path", async () => {
    const { session } = makeSession()
    queueTurn({ textDeltas: ['{"ok":', " true}"], status: "completed" })
    const streamed = await session.structured([{ role: "user", content: "extract" }], SCHEMA, { onText: () => {} })
    queueStructured({ text: '{"ok": true}' })
    const plain = await session.structured([{ role: "user", content: "extract" }], SCHEMA)

    expect(streamed).toEqual(plain)
  })

  it("rejects the streaming call when the request errors", async () => {
    queueTurn({ status: null, error: new Error("rate limited") })

    const { session } = makeSession()
    await expect(
      session.structured([{ role: "user", content: "x" }], SCHEMA, { onText: () => {} }),
    ).rejects.toThrow("rate limited")
  })

  it("rejects the streaming call when the stream aborts mid-iteration", async () => {
    queueTurn({ textDeltas: ['{"ok"', ": true}"], status: "completed" })

    const { session } = makeSession()
    const promise = session.structured([{ role: "user", content: "x" }], SCHEMA, { onText: () => {} })
    const results = mockCreate.mock.results
    const stream = (await results[results.length - 1].value) as { controller: AbortController }
    stream.controller.abort()
    await expect(promise).rejects.toThrow(/aborted/i)
  })

  it("reports a truncated reply as cut off, not as a parse error", async () => {
    const { session } = makeSession()
    queueStructured({ text: '{"ok": tr', status: "incomplete", incompleteReason: "max_output_tokens" })
    await expect(session.structured([{ role: "user", content: "x" }], SCHEMA)).rejects.toBeInstanceOf(CutOffError)

    queueTurn({ textDeltas: ['{"ok": tr'], status: "incomplete", incompleteReason: "max_output_tokens" })
    await expect(
      session.structured([{ role: "user", content: "x" }], SCHEMA, { onText: () => {} }),
    ).rejects.toBeInstanceOf(CutOffError)
  })

  it("reports a content filter as refused, not as cut off", async () => {
    const { session } = makeSession()
    queueStructured({ text: "", status: "incomplete", incompleteReason: "content_filter" })
    await expect(session.structured([{ role: "user", content: "x" }], SCHEMA)).rejects.toBeInstanceOf(RefusedError)

    queueTurn({ status: "incomplete", incompleteReason: "content_filter" })
    await expect(
      session.structured([{ role: "user", content: "x" }], SCHEMA, { onText: () => {} }),
    ).rejects.toBeInstanceOf(RefusedError)
  })

  it("reports a refusal as refused, not as a parse error", async () => {
    const { session } = makeSession()
    queueStructured({ text: "", refusal: "I can't help with that." })
    await expect(session.structured([{ role: "user", content: "x" }], SCHEMA)).rejects.toBeInstanceOf(RefusedError)

    queueTurn({ refusalDeltas: ["I can't ", "help with that."], status: "completed" })
    await expect(
      session.structured([{ role: "user", content: "x" }], SCHEMA, { onText: () => {} }),
    ).rejects.toBeInstanceOf(RefusedError)
  })
})

describe("OpenAiSession output cap", () => {
  const SCHEMA = {
    type: "object" as const,
    properties: { ok: { type: "boolean" as const } },
    required: ["ok"],
  }
  const CAP_ERROR =
    "max_output_tokens is too large: 32000. This model supports at most 16384 output tokens, whereas you provided 32000."

  it("structured() retries a cap 400 on both the plain and the streaming path", async () => {
    const { session } = makeSession()
    queueStructured({ error: apiError(400, CAP_ERROR) })
    queueStructured({ text: '{"ok": true}' })
    expect(await session.structured([{ role: "user", content: "x" }], SCHEMA)).toEqual({ ok: true })
    expect(lastCreateCall().max_output_tokens).toBe(16384)

    const fresh = makeSession().session
    queueTurn({ status: null, error: apiError(400, CAP_ERROR) })
    queueTurn({ textDeltas: ['{"ok": true}'], status: "completed" })
    expect(await fresh.structured([{ role: "user", content: "x" }], SCHEMA, { onText: () => {} })).toEqual({ ok: true })
    expect(lastCreateCall().max_output_tokens).toBe(16384)
  })
})

describe("OpenAiSession failures", () => {
  it("never aborts a stream that finished — the rest drains in the background", async () => {
    queueTurn({ textDeltas: ["visible"], status: "completed", tailDelta: "INVISIBLE" })

    const { session, events } = makeSession()
    await session.send("Hi")

    await vi.waitFor(() => expect(streams[0].drained).toBe(true))
    expect(streams[0].controller.signal.aborted).toBe(false)
    expect(lastBlocks(events)).toEqual([{ type: "text", content: "visible" }])
  })

  it("reports a response that fails mid-stream with rate_limit_exceeded as rateLimited", async () => {
    queueTurn({ status: null, failure: "Rate limit reached for gpt-6-astra", failureCode: "rate_limit_exceeded" })

    const { session, events } = makeSession()
    await session.send("hi")

    expect(events.at(-1)).toMatchObject({ type: "error", code: "rateLimited", provider: "openai" })
    expect(history(session)).toEqual([{ role: "user", content: "hi" }])
  })

  it.each(["invalid_image", "image_too_large", "invalid_prompt", "image_content_policy_violation"])(
    "rolls back a send whose response fails mid-stream with %s",
    async (failureCode) => {
      queueTurn({ status: null, failure: "The image could not be processed.", failureCode })

      const { session, events } = makeSession()
      await session.send("what's on this receipt?")
      expect(events.at(-1)).toMatchObject({ type: "error", provider: "openai", rolledBack: true })
      expect(history(session)).toEqual([])

      queueTurn({ textDeltas: ["Hi"], status: "completed" })
      await session.send("hello")
      expect(lastCreateCall().input).toEqual([{ role: "user", content: "hello" }])
    },
  )

  it("rolls back a send whose stream ends with a content-coded error event", async () => {
    queueTurn({ status: null, errorEvent: "Invalid image.", errorEventCode: "invalid_image" })

    const { session, events } = makeSession()
    await session.send("what's on this receipt?")
    expect(events.at(-1)).toEqual({ type: "error", message: "Invalid image.", provider: "openai", rolledBack: true })
    expect(history(session)).toEqual([])
  })

  it("reports a stream that ends with a rate_limit_exceeded error event as rateLimited, keeping the question", async () => {
    queueTurn({ status: null, errorEvent: "Rate limit reached.", errorEventCode: "rate_limit_exceeded" })

    const { session, events } = makeSession()
    await session.send("hi")
    expect(events.at(-1)).toEqual({ type: "error", message: "Rate limit reached.", provider: "openai", code: "rateLimited" })
    expect(history(session)).toEqual([{ role: "user", content: "hi" }])
  })

  it.each(["server_error", "vector_store_timeout"])(
    "keeps the question in history after a response fails mid-stream with %s",
    async (failureCode) => {
      queueTurn({ status: null, failure: "Something went wrong.", failureCode })

      const { session, events } = makeSession()
      await session.send("hi")
      expect(events.at(-1)).not.toHaveProperty("rolledBack")
      expect(history(session)).toEqual([{ role: "user", content: "hi" }])
    },
  )

  it("an error while a completed stream drains in the background raises nothing and emits nothing", async () => {
    queueTurn({ textDeltas: ["visible"], status: "completed", failAfter: new Error("socket closed") })

    const { session, events } = makeSession()
    await session.send("Hi")
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(events.filter((e) => e.type !== "content")).toEqual([{ type: "done" }])
  })

  it("leaves an exhausted-quota 429 as the vendor's billing message", async () => {
    queueTurn({ status: null, error: apiError(429, "You exceeded your current quota.", null, "insufficient_quota") })

    const { session, events } = makeSession()
    await session.send("hi")

    const end = events.at(-1)
    expect(end).toMatchObject({ type: "error", status: 429, message: "You exceeded your current quota." })
    expect(end).not.toHaveProperty("code")
  })
})

describe("OpenAiSession.structured — cancellation and retries", () => {
  const SCHEMA = { type: "object" as const, properties: { ok: { type: "boolean" as const } }, required: ["ok"] }
  const requestOptions = () => mockCreate.mock.lastCall?.[1] as { signal?: AbortSignal; maxRetries?: number }

  it("retries a failed request at most once, streaming or not", async () => {
    const { session } = makeSession()
    queueStructured({ text: '{"ok": true}' })
    await session.structured([{ role: "user", content: "x" }], SCHEMA)
    expect(requestOptions().maxRetries).toBe(1)
    queueTurn({ textDeltas: ['{"ok": true}'], status: "completed" })
    await session.structured([{ role: "user", content: "x" }], SCHEMA, { onText: () => {} })
    expect(requestOptions().maxRetries).toBe(1)
  })

  it("aborts the request when the caller's signal aborts mid-stream", async () => {
    queueTurn({ textDeltas: ['{"ok"', ": true}"], status: "completed" })
    const controller = new AbortController()
    const { session } = makeSession()
    const promise = session.structured([{ role: "user", content: "x" }], SCHEMA, {
      signal: controller.signal,
      onText: () => controller.abort(),
    })
    await expect(promise).rejects.toThrow(/aborted/i)
  })

  it("leaves a finished request alone when the caller's signal aborts later", async () => {
    queueStructured({ text: '{"ok": true}' })
    const controller = new AbortController()
    const { session } = makeSession()
    await session.structured([{ role: "user", content: "x" }], SCHEMA, { signal: controller.signal })
    controller.abort()
    expect(requestOptions().signal?.aborted).toBe(false)
  })

  it("reports a connection failure as unreachable", async () => {
    queueStructured({ error: new OpenAI.APIConnectionError({ message: "Connection error." }) })
    const { session } = makeSession()
    await expect(session.structured([{ role: "user", content: "x" }], SCHEMA)).rejects.toBeInstanceOf(UnreachableError)
  })
})
