import { describe, it, expect, vi, beforeEach } from "vitest"
import OpenAI from "openai"
import type { BudgetRepository, FileAdapter } from "@capybudget/persistence"
import type { StreamEvent } from "../types"
import { CutOffError, RefusedError, UnreachableError } from "../structured"
import { UNANSWERED_RESULT } from "./agent-turn"
import { OllamaSession } from "./ollama-session"
import { chatApiError as apiError, chatSdk, openAiClientConfigs as clientConfigs } from "./test-doubles/openai-sdk"
import { lastBlocks, mockRunTool } from "./test-doubles/harness"

vi.mock("openai", async () => ({ default: (await import("./test-doubles/openai-sdk")).FakeOpenAI }))
vi.mock("../tools", async (importOriginal) => (await import("./test-doubles/harness")).toolsWithMockedRun(importOriginal))

const { create: mockCreate, queueTurn, queueStructured, lastCall: lastCreateCall, allCalls: allCreateCalls, streams } = chatSdk

const CAP_ERROR =
  "max_tokens is too large: 32000. This model supports at most 16384 completion tokens, whereas you provided 32000."

function makeSession(
  onEvent?: (e: StreamEvent, session: OllamaSession) => void,
  baseUrl = "http://localhost:11434/v1",
) {
  const events: StreamEvent[] = []
  const session: OllamaSession = new OllamaSession({
    budgetPath: "/budget",
    systemPrompt: "you are capy",
    apiKey: "ollama",
    model: "qwen3",
    baseUrl,
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

function history(session: OllamaSession): Array<Record<string, unknown>> {
  return (session as unknown as { messages: Array<Record<string, unknown>> }).messages
}

beforeEach(() => {
  chatSdk.reset()
  mockRunTool.mockReset()
})

describe("OllamaSession", () => {
  it("points the client at the configured local endpoint", () => {
    clientConfigs.length = 0
    makeSession(undefined, "http://127.0.0.1:9999/v1")
    expect(clientConfigs).toEqual([{ apiKey: "ollama", baseURL: "http://127.0.0.1:9999/v1", dangerouslyAllowBrowser: true }])
  })

  it("prepends a system message with the system prompt", async () => {
    queueTurn({ textDeltas: ["ok"], finish_reason: "stop" })
    const { session } = makeSession()
    await session.send("Hi")
    const call = lastCreateCall()
    const messages = call.messages as Array<{ role: string; content: unknown }>
    expect(messages[0]).toEqual({ role: "system", content: "you are capy" })
    expect(messages[1].role).toBe("user")
  })

  it("keeps the tools + system prefix byte-stable across turns (prefix caching)", async () => {
    queueTurn({
      toolCallDeltas: [
        { index: 0, id: "call_1", name: "list_accounts", argFragments: ["{}"] },
      ],
      finish_reason: "tool_calls",
    })
    queueTurn({ textDeltas: ["Done."], finish_reason: "stop" })
    mockRunTool.mockResolvedValueOnce("ok")

    const { session } = makeSession()
    await session.send("How much do I have?")

    // The hoisted `calls` array spans the whole file; this session's two turns
    // are the last two entries.
    const all = allCreateCalls()
    const [turn1, turn2] = all.slice(-2)
    expect(turn1.tools).toEqual(turn2.tools)
    const firstSystem = (turn1.messages as Array<unknown>)[0]
    const secondSystem = (turn2.messages as Array<unknown>)[0]
    expect(firstSystem).toEqual({ role: "system", content: "you are capy" })
    expect(secondSystem).toEqual(firstSystem)
  })

  it("dispatches a tool call (arguments arrive across many deltas), threads tool_call_id, and continues the loop", async () => {
    queueTurn({
      textDeltas: ["Looking up..."],
      toolCallDeltas: [
        {
          index: 0,
          id: "call_abc",
          name: "list_transactions",
          argFragments: ['{"', "limit", '":', " 5", "}"],
        },
      ],
      finish_reason: "tool_calls",
    })
    queueTurn({
      textDeltas: ["Found 5 transactions."],
      finish_reason: "stop",
    })

    mockRunTool.mockResolvedValueOnce("5 transactions found")

    const { session, events } = makeSession()
    await session.send("Show recent")

    expect(mockRunTool).toHaveBeenCalledTimes(1)
    expect(mockRunTool).toHaveBeenCalledWith(
      "list_transactions",
      { limit: 5 },
      expect.objectContaining({ budgetPath: "/budget", currency: "USD" }),
    )

    // Second call: system, user, assistant (tool_calls), tool (tool_call_id).
    const second = lastCreateCall()
    const messages = second.messages as Array<{
      role: string
      content?: unknown
      tool_calls?: unknown
      tool_call_id?: string
    }>
    expect(messages[0].role).toBe("system")
    expect(messages[1].role).toBe("user")
    expect(messages[2].role).toBe("assistant")
    expect(messages[2].tool_calls).toBeTruthy()
    const last = messages[messages.length - 1]
    expect(last.role).toBe("tool")
    expect(last.tool_call_id).toBe("call_abc")
    expect(last.content).toBe("5 transactions found")

    const toolActivityFound = events.some(
      (e) =>
        e.type === "content" &&
        e.blocks.some(
          (b) => b.type === "tool-activity" && b.tool === "list_transactions",
        ),
    )
    expect(toolActivityFound).toBe(true)

    expect(events[events.length - 1]).toEqual({ type: "done" })
  })

  it("accumulates tool arguments across multiple deltas before parsing", async () => {
    queueTurn({
      toolCallDeltas: [
        {
          index: 0,
          id: "call_xyz",
          name: "list_transactions",
          argFragments: [
            '{"start',
            'Date":"',
            "2025",
            "-01-",
            '01"}',
          ],
        },
      ],
      finish_reason: "tool_calls",
    })
    queueTurn({ textDeltas: ["done"], finish_reason: "stop" })

    mockRunTool.mockResolvedValueOnce("ok")
    const { session } = makeSession()
    await session.send("Transactions in Jan 2025?")
    expect(mockRunTool).toHaveBeenCalledWith(
      "list_transactions",
      { startDate: "2025-01-01" },
      expect.anything(),
    )
  })

  it("surfaces a parse error in the tool result when arguments are malformed JSON", async () => {
    queueTurn({
      toolCallDeltas: [
        {
          index: 0,
          id: "call_bad",
          name: "list_transactions",
          argFragments: ['{"limit', ': 5'], // unbalanced — missing closing "}"
        },
      ],
      finish_reason: "tool_calls",
    })
    queueTurn({
      textDeltas: ["Sorry, I'll try again."],
      finish_reason: "stop",
    })

    const { session } = makeSession()
    await session.send("Show recent")

    expect(mockRunTool).not.toHaveBeenCalled()

    const second = lastCreateCall()
    const messages = second.messages as Array<{
      role: string
      tool_call_id?: string
      content?: string
    }>
    const toolMsg = messages.find((m) => m.role === "tool")
    expect(toolMsg).toBeTruthy()
    expect(toolMsg!.tool_call_id).toBe("call_bad")
    expect(toolMsg!.content).toMatch(/invalid JSON arguments/i)
    expect(toolMsg!.content!.length).toBeGreaterThan("Error: invalid JSON arguments — ".length)
  })

  it("extracts the inner message from an SDK APIError-shaped throw", async () => {
    const apiError = new Error("429 You exceeded your current quota") as Error & {
      status: number
      error: unknown
    }
    apiError.status = 429
    apiError.error = {
      type: "insufficient_quota",
      code: "insufficient_quota",
      message:
        "You exceeded your current quota, please check your plan and billing details.",
      param: null,
    }

    queueTurn({ finish_reason: "stop", error: apiError })

    const { session, events } = makeSession()
    await session.send("Hi")

    const errorEvent = events.find((e) => e.type === "error")
    expect(errorEvent).toEqual({
      type: "error",
      message:
        "You exceeded your current quota, please check your plan and billing details.",
      status: 429,
      provider: "ollama",
    })
  })

  it("answers only the calls a trailing turn left unanswered before appending the next user message", async () => {
    const { session } = makeSession()
    const history = (session as unknown as { messages: Array<Record<string, unknown>> }).messages
    history.push(
      { role: "user", content: "Add it" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "call_a", type: "function", function: { name: "create_transaction", arguments: "{}" } },
          { id: "call_b", type: "function", function: { name: "create_transaction", arguments: "{}" } },
        ],
      },
      { role: "tool", tool_call_id: "call_a", content: "created" },
    )

    queueTurn({ textDeltas: ["ok"], finish_reason: "stop" })
    await session.send("Hello?")

    const messages = lastCreateCall().messages as Array<Record<string, unknown>>
    expect(messages.slice(3)).toEqual([
      { role: "tool", tool_call_id: "call_a", content: "created" },
      { role: "tool", tool_call_id: "call_b", content: UNANSWERED_RESULT },
      { role: "user", content: "Hello?" },
    ])
  })

  it("forwards multimodal images via image_url", async () => {
    queueTurn({ textDeltas: ["ok"], finish_reason: "stop" })
    const { session } = makeSession()
    await session.send([
      { type: "text", text: "Receipt extraction" },
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "AAAA" },
      },
    ])

    const call = lastCreateCall()
    const messages = call.messages as Array<{
      role: string
      content: unknown
    }>
    expect(messages[0].role).toBe("system")
    const userBlocks = messages[1].content as Array<{
      type: string
      image_url?: { url: string }
    }>
    expect(userBlocks.map((b) => b.type)).toEqual(["text", "image_url"])
    expect(userBlocks[1].image_url).toEqual({ url: "data:image/png;base64,AAAA" })
  })

  it("never stores a null-content assistant turn with no tool_calls (poisoned-history regression)", async () => {
    // Mirrors the real failure: a turn uses a tool, then the terminal
    // completion returns neither text nor tool calls. That empty turn used
    // to be stored as {role:"assistant", content:null} with no tool_calls,
    // an invalid message rejected on every later send ("expected a string,
    // got null") — poisoning the rest of the session.
    queueTurn({
      toolCallDeltas: [
        { index: 0, id: "tc-1", name: "list_accounts", argFragments: ["{}"] },
      ],
      finish_reason: "tool_calls",
    })
    queueTurn({ finish_reason: "stop" }) // empty terminal turn — no text, no tools
    mockRunTool.mockResolvedValue("ok")

    const { session, events } = makeSession()
    await session.send("how am I doing?")

    // A follow-up send replays the full history to the API.
    queueTurn({ textDeltas: ["Doing great."], finish_reason: "stop" })
    await session.send("got it")

    const sent = lastCreateCall().messages as Array<{
      role: string
      content: unknown
      tool_calls?: unknown
    }>
    const poisoned = sent.filter(
      (m) => m.role === "assistant" && m.content === null && !m.tool_calls,
    )
    expect(poisoned).toEqual([])
    expect(events.some((e) => e.type === "error")).toBe(false)
  })

  it("treats a tool_calls finish with no tool calls as terminal (no infinite loop)", async () => {
    // A contradictory response: finish_reason says tool_calls but no tool-call
    // deltas arrive. Nothing is executed, so history is unchanged — looping
    // would re-send the identical request forever and burn tokens on each
    // pass. Only one turn is queued: if the loop spins, the second
    // chat.completions.create() finds an empty queue and throws.
    queueTurn({ finish_reason: "tool_calls" })

    const { session, events } = makeSession()
    await session.send("hi")

    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(events.some((e) => e.type === "done")).toBe(true)
    expect(events.some((e) => e.type === "error")).toBe(false)
  })

  describe("Ollama-shaped streams", () => {
    function toolRoles() {
      const messages = lastCreateCall().messages as Array<{ role: string; tool_call_id?: string }>
      return messages.filter((m) => m.role === "tool").map((m) => m.tool_call_id)
    }

    it("continues the loop when tool calls arrive with a stop finish", async () => {
      queueTurn({
        toolCallDeltas: [{ index: 0, id: "call_1", name: "list_transactions", arguments: "{}" }],
        finish_reason: "stop",
      })
      queueTurn({ textDeltas: ["Done."], finish_reason: "stop" })
      mockRunTool.mockResolvedValueOnce("ok")

      const { session } = makeSession()
      await session.send("hi")

      expect(mockRunTool).toHaveBeenCalledTimes(1)
      expect(mockCreate).toHaveBeenCalledTimes(2)
      expect(toolRoles()).toEqual(["call_1"])
    })

    it("separates tool calls that arrive without an index by id", async () => {
      queueTurn({
        toolCallDeltas: [
          { id: "call_a", name: "list_transactions", arguments: '{"limit":1}' },
          { id: "call_b", name: "list_categories", arguments: "{}" },
        ],
        finish_reason: "tool_calls",
      })
      queueTurn({ textDeltas: ["Done."], finish_reason: "stop" })
      mockRunTool.mockResolvedValue("ok")

      const { session } = makeSession()
      await session.send("hi")

      expect(mockRunTool.mock.calls.map(([name, input]) => [name, input])).toEqual([
        ["list_transactions", { limit: 1 }],
        ["list_categories", {}],
      ])
      expect(toolRoles()).toEqual(["call_a", "call_b"])
    })

    it("appends index-less argument fragments to the call they follow", async () => {
      queueTurn({
        toolCallDeltas: [{ id: "call_a", name: "list_transactions", argFragments: ['{"limit"', ":2}"] }],
        finish_reason: "tool_calls",
      })
      queueTurn({ textDeltas: ["Done."], finish_reason: "stop" })
      mockRunTool.mockResolvedValue("ok")

      const { session } = makeSession()
      await session.send("hi")

      expect(mockRunTool).toHaveBeenCalledWith("list_transactions", { limit: 2 }, expect.anything())
    })
  })

  it.each([
    ["a length finish", "length" as const, "cutOff"],
    ["a content_filter finish", "content_filter" as const, "refused"],
    ["no finish chunk", null, "cutOff"],
  ])("never executes tool calls from a turn ended by %s, keeps only its text, and reports %s", async (_label, finish_reason, code) => {
    queueTurn({
      textDeltas: ["Let me check"],
      toolCallDeltas: [{ index: 0, id: "call_1", name: "list_transactions", argFragments: ['{"lim'] }],
      finish_reason,
    })
    queueTurn({ textDeltas: ["ok"], finish_reason: "stop" })

    const { session, events } = makeSession()
    await session.send("hi")
    expect(mockRunTool).not.toHaveBeenCalled()
    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(events[events.length - 1]).toMatchObject({ type: "error", code })

    await session.send("again")
    const messages = lastCreateCall().messages as Array<{ role: string; content: unknown; tool_calls?: unknown }>
    expect(messages.some((m) => m.tool_calls)).toBe(false)
    expect(messages).toContainEqual({ role: "assistant", content: "Let me check" })
  })

  it("reports a streamed refusal that finishes with stop as refused, not as an empty reply", async () => {
    queueTurn({ refusalDeltas: ["I can't ", "help with that."], finish_reason: "stop" })

    const { session, events } = makeSession()
    await session.send("hi")

    expect(events.at(-1)).toMatchObject({ type: "error", code: "refused" })
    expect(events.some((e) => e.type === "done")).toBe(false)
    expect(history(session).some((m) => m.role === "assistant")).toBe(false)
  })

  it("reports a text-only turn cut off by length as cutOff, keeping its text", async () => {
    queueTurn({ textDeltas: ["A long answer that"], finish_reason: "length" })

    const { session, events } = makeSession()
    await session.send("Explain")

    expect(events.at(-1)).toMatchObject({ type: "error", code: "cutOff" })
    expect(history(session).at(-1)).toEqual({ role: "assistant", content: "A long answer that" })
  })

  it.each([
    ["a length finish", "length" as const, "cutOff"],
    ["a content_filter finish", "content_filter" as const, "refused"],
    ["no finish chunk", null, "cutOff"],
  ])("reports a text-less turn ended by %s as %s instead of an empty reply", async (_label, finish_reason, code) => {
    queueTurn({
      toolCallDeltas: [{ index: 0, id: "call_1", name: "list_transactions", argFragments: ['{"lim'] }],
      finish_reason,
    })

    const { session, events } = makeSession()
    await session.send("hi")

    expect(events.find((e) => e.type === "error")).toMatchObject({ type: "error", code })
    expect(events.some((e) => e.type === "done")).toBe(false)
    expect(mockRunTool).not.toHaveBeenCalled()
  })

  it("stays silent when stop() lands as a text-less turn is cut off", async () => {
    const { session, events } = makeSession()
    mockCreate.mockImplementationOnce(async () => ({
      async *[Symbol.asyncIterator]() {
        yield {
          choices: [
            {
              delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "list_transactions", arguments: "" } }] },
              finish_reason: null,
              index: 0,
            },
          ],
        }
        await session.stop()
      },
    }))

    await session.send("hi")

    expect(events.some((e) => e.type === "error")).toBe(false)
    expect(events.some((e) => e.type === "done")).toBe(false)
  })

  it("breaks out of the chunk loop on finish_reason without consuming queued tail chunks", async () => {
    // Mock emits one more chunk AFTER finish_reason; if the adapter ever
    // kept iterating we'd see "INVISIBLE" land in a content event. Passing
    // proves the `break` on finish_reason holds — and that we don't need an
    // explicit stream.controller.abort() to enforce it.
    queueTurn({
      textDeltas: ["visible"],
      finish_reason: "stop",
      tailChunk: { content: "INVISIBLE" },
    })

    const { session, events } = makeSession()
    await session.send("Hi")

    const allText = events
      .filter((e) => e.type === "content")
      .flatMap((e) => (e.type === "content" ? e.blocks : []))
      .filter((b) => b.type === "text")
      .map((b) => (b.type === "text" ? b.content : ""))
      .join("")
    expect(allText).toBe("visible")
    expect(allText).not.toContain("INVISIBLE")
  })

  it("emits tool-result with ok=false when tool_call arguments are malformed JSON", async () => {
    queueTurn({
      toolCallDeltas: [
        {
          index: 0,
          id: "call_bad_args",
          name: "create_transaction",
          argFragments: ['{"amount": 100'],
        },
      ],
      finish_reason: "tool_calls",
    })
    queueTurn({ textDeltas: ["Recovered."], finish_reason: "stop" })

    const { session, events } = makeSession()
    await session.send("Add it.")

    expect(mockRunTool).not.toHaveBeenCalled()

    const toolResults = events.filter((e) => e.type === "tool-result")
    expect(toolResults).toEqual([
      {
        type: "tool-result",
        tool: "create_transaction",
        id: "call_bad_args",
        ok: false,
      },
    ])
  })
})

describe("OllamaSession.structured", () => {
  const SCHEMA = {
    type: "object" as const,
    properties: { ok: { type: "boolean" as const } },
    required: ["ok"],
  }

  it("makes one constrained, tool-free call and returns the parsed result", async () => {
    queueStructured({ content: '{"ok": true}' })

    const { session } = makeSession()
    const result = await session.structured<{ ok: boolean }>(
      [{ role: "user", content: "extract" }],
      SCHEMA,
    )

    expect(result).toEqual({ ok: true })
    expect(mockCreate).toHaveBeenCalledTimes(1)

    const call = lastCreateCall()
    expect(call.tools).toBeUndefined()
    expect(call.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "structured_output", schema: SCHEMA },
    })
    const messages = call.messages as Array<{ role: string }>
    expect(messages[0].role).toBe("system")
  })

  it("sends strict on the json_schema wrapper, not inside the schema, for a strict schema", async () => {
    queueStructured({ content: '{"ok": true}' })
    const STRICT_SCHEMA = {
      type: "object" as const,
      additionalProperties: false,
      strict: true,
      properties: { ok: { type: "boolean" as const } },
      required: ["ok"],
    }

    const { session } = makeSession()
    await session.structured([{ role: "user", content: "x" }], STRICT_SCHEMA)

    const rf = lastCreateCall().response_format as {
      json_schema: { strict?: boolean; schema: Record<string, unknown> }
    }
    expect(rf.json_schema.strict).toBe(true)
    // The marker is stripped from the schema the server validates against.
    expect(rf.json_schema.schema).not.toHaveProperty("strict")
    expect(rf.json_schema.schema).toMatchObject({ additionalProperties: false })
  })

  it("omits strict from the wrapper for a non-strict schema", async () => {
    queueStructured({ content: '{"ok": true}' })

    const { session } = makeSession()
    await session.structured([{ role: "user", content: "x" }], SCHEMA)

    const rf = lastCreateCall().response_format as { json_schema: Record<string, unknown> }
    expect(rf.json_schema).not.toHaveProperty("strict")
  })

  it("forwards image content as image_url", async () => {
    queueStructured({ content: '{"ok": true}' })

    const { session } = makeSession()
    await session.structured(
      [
        {
          role: "user",
          content: [
            { type: "text", text: "read this receipt" },
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: "AAAA" },
            },
          ],
        },
      ],
      SCHEMA,
    )

    const call = lastCreateCall()
    const messages = call.messages as Array<{ role: string; content: unknown }>
    const userBlocks = messages[1].content as Array<{ type: string; image_url?: { url: string } }>
    expect(userBlocks.map((b) => b.type)).toEqual(["text", "image_url"])
    expect(userBlocks[1].image_url).toEqual({ url: "data:image/png;base64,AAAA" })
  })

  it("rejects document content instead of sending it as an image", async () => {
    const { session } = makeSession()
    await expect(
      session.structured(
        [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: { type: "base64", media_type: "application/pdf", data: "AAAA" },
              },
            ],
          },
        ],
        SCHEMA,
      ),
    ).rejects.toThrow(/document/)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("rejects when the model returns output that violates the schema", async () => {
    queueStructured({ content: '{"ok": "not a boolean"}' })

    const { session } = makeSession()
    await expect(
      session.structured([{ role: "user", content: "x" }], SCHEMA),
    ).rejects.toThrowError(/boolean/i)
  })

  it("passes an assistant turn through as plain text content (after the system message)", async () => {
    queueStructured({ content: '{"ok": true}' })

    const { session } = makeSession()
    await session.structured(
      [
        { role: "user", content: "extract" },
        { role: "assistant", content: '{"ok": false}' },
        { role: "user", content: "redo it" },
      ],
      SCHEMA,
    )

    const call = lastCreateCall()
    const messages = call.messages as Array<{ role: string; content: unknown }>
    expect(messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"])
    expect(messages[2].content).toBe('{"ok": false}')
  })

  it("streams when onText is set, surfacing accumulated (not per-delta) text", async () => {
    queueTurn({ textDeltas: ['{"ok"', ": true}"], finish_reason: "stop" })
    const onText = vi.fn()

    const { session } = makeSession()
    const result = await session.structured<{ ok: boolean }>(
      [{ role: "user", content: "extract" }],
      SCHEMA,
      { onText },
    )

    expect(result).toEqual({ ok: true })
    expect(onText.mock.calls.map((c) => c[0])).toEqual(['{"ok"', '{"ok": true}'])
    // The streaming request carries the same schema constraint.
    const params = mockCreate.mock.lastCall?.[0] as Record<string, unknown>
    expect(params.stream).toBe(true)
    expect(params.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "structured_output", schema: SCHEMA },
    })
  })

  it("resolves the streaming call to the same value as the non-streaming path", async () => {
    const { session } = makeSession()

    queueTurn({ textDeltas: ['{"ok":', " true}"], finish_reason: "stop" })
    const streamed = await session.structured<{ ok: boolean }>(
      [{ role: "user", content: "extract" }],
      SCHEMA,
      { onText: () => {} },
    )

    queueStructured({ content: '{"ok": true}' })
    const plain = await session.structured<{ ok: boolean }>(
      [{ role: "user", content: "extract" }],
      SCHEMA,
    )

    expect(streamed).toEqual(plain)
  })

  it("rejects the streaming call when the request errors", async () => {
    queueTurn({ finish_reason: "stop", error: new Error("rate limited") })

    const { session } = makeSession()
    await expect(
      session.structured([{ role: "user", content: "x" }], SCHEMA, { onText: () => {} }),
    ).rejects.toThrow("rate limited")
  })

  it("rejects the streaming call when the stream aborts mid-iteration", async () => {
    queueTurn({ textDeltas: ['{"ok"', ": true}"], finish_reason: "stop" })

    const { session } = makeSession()
    const promise = session.structured([{ role: "user", content: "x" }], SCHEMA, {
      onText: () => {},
    })
    // The mock's create() resolves to a stream whose controller forces the
    // chunk iterator to throw AbortError on its next step.
    const results = mockCreate.mock.results
    const stream = (await results[results.length - 1].value) as { controller: AbortController }
    stream.controller.abort()
    await expect(promise).rejects.toThrow(/aborted/i)
  })
})

describe("OllamaSession output cap", () => {
  const SCHEMA = {
    type: "object" as const,
    properties: { ok: { type: "boolean" as const } },
    required: ["ok"],
  }

  it("structured() retries a cap 400 on both the plain and the streaming path", async () => {
    const { session } = makeSession()
    queueStructured({ error: apiError(400, CAP_ERROR) })
    queueStructured({ content: '{"ok": true}' })
    expect(await session.structured([{ role: "user", content: "x" }], SCHEMA)).toEqual({ ok: true })
    expect(lastCreateCall().max_completion_tokens).toBe(16384)

    const fresh = makeSession().session
    queueTurn({ finish_reason: null, error: apiError(400, CAP_ERROR) })
    queueTurn({ textDeltas: ['{"ok": true}'], finish_reason: "stop" })
    const streamed = await fresh.structured([{ role: "user", content: "x" }], SCHEMA, { onText: () => {} })
    expect(streamed).toEqual({ ok: true })
    expect(lastCreateCall().max_completion_tokens).toBe(16384)
  })

  it("structured() reports a truncated reply as cut off, not as a parse error", async () => {
    const { session } = makeSession()
    queueStructured({ content: '{"ok": tr', finish_reason: "length" })
    await expect(session.structured([{ role: "user", content: "x" }], SCHEMA)).rejects.toBeInstanceOf(
      CutOffError,
    )

    queueTurn({ textDeltas: ['{"ok": tr'], finish_reason: "length" })
    await expect(
      session.structured([{ role: "user", content: "x" }], SCHEMA, { onText: () => {} }),
    ).rejects.toBeInstanceOf(CutOffError)
  })

  it("structured() reports a content filter as refused, not as cut off", async () => {
    const { session } = makeSession()
    queueStructured({ content: "", finish_reason: "content_filter" })
    await expect(session.structured([{ role: "user", content: "x" }], SCHEMA)).rejects.toBeInstanceOf(
      RefusedError,
    )

    queueTurn({ textDeltas: [], finish_reason: "content_filter" })
    await expect(
      session.structured([{ role: "user", content: "x" }], SCHEMA, { onText: () => {} }),
    ).rejects.toBeInstanceOf(RefusedError)
  })

  it("structured() reports a refusal that finishes with stop as refused, not as a parse error", async () => {
    const { session } = makeSession()
    queueStructured({ content: "", refusal: "I can't help with that." })
    await expect(session.structured([{ role: "user", content: "x" }], SCHEMA)).rejects.toBeInstanceOf(
      RefusedError,
    )

    queueTurn({ refusalDeltas: ["I can't ", "help with that."], finish_reason: "stop" })
    await expect(
      session.structured([{ role: "user", content: "x" }], SCHEMA, { onText: () => {} }),
    ).rejects.toBeInstanceOf(RefusedError)
  })
})

describe("OllamaSession failures", () => {
  it("never aborts a stream that finished — the rest drains in the background", async () => {
    queueTurn({ textDeltas: ["Hi"], finish_reason: "stop", tailChunk: { content: "IGNORED" } })

    const { session, events } = makeSession()
    await session.send("hi")

    await vi.waitFor(() => expect(streams[0].drained).toBe(true))
    expect(streams[0].controller.signal.aborted).toBe(false)
    expect(lastBlocks(events)).toEqual([{ type: "text", content: "Hi" }])
  })

  it("never aborts a finished structured stream", async () => {
    queueTurn({ textDeltas: ['{"ok": true}'], finish_reason: "stop", tailChunk: { content: "IGNORED" } })

    const { session } = makeSession()
    await session.structured(
      [{ role: "user", content: "x" }],
      { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
      { onText: () => {} },
    )

    await vi.waitFor(() => expect(streams[0].drained).toBe(true))
    expect(streams[0].controller.signal.aborted).toBe(false)
  })

  it("reports a usage-cap 429 with a plain-string error body as rateLimited", async () => {
    const error = Object.assign(new Error("429 you have reached your hourly usage limit"), {
      status: 429,
      error: "you have reached your hourly usage limit",
    })
    queueTurn({ finish_reason: null, error })

    const { session, events } = makeSession()
    await session.send("hi")

    expect(events.at(-1)).toMatchObject({ type: "error", code: "rateLimited", status: 429, provider: "ollama" })
  })

  it("an error while a finished stream drains in the background raises nothing and emits nothing", async () => {
    queueTurn({ textDeltas: ["Hi"], finish_reason: "stop", failAfter: new Error("socket closed") })

    const { session, events } = makeSession()
    await session.send("hi")
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(events.filter((e) => e.type !== "content")).toEqual([{ type: "done" }])
  })
})

describe("OllamaSession.structured — cancellation and retries", () => {
  const SCHEMA = { type: "object" as const, properties: { ok: { type: "boolean" as const } }, required: ["ok"] }
  const requestOptions = () => mockCreate.mock.lastCall?.[1] as { signal?: AbortSignal; maxRetries?: number }

  it("retries a failed request at most once, streaming or not", async () => {
    const { session } = makeSession()
    queueStructured({ content: '{"ok": true}' })
    await session.structured([{ role: "user", content: "x" }], SCHEMA)
    expect(requestOptions().maxRetries).toBe(1)
    queueTurn({ textDeltas: ['{"ok": true}'], finish_reason: "stop" })
    await session.structured([{ role: "user", content: "x" }], SCHEMA, { onText: () => {} })
    expect(requestOptions().maxRetries).toBe(1)
  })

  it("aborts the request when the caller's signal aborts mid-stream", async () => {
    queueTurn({ textDeltas: ['{"ok"', ": true}"], finish_reason: "stop" })
    const controller = new AbortController()
    const { session } = makeSession()
    const promise = session.structured([{ role: "user", content: "x" }], SCHEMA, {
      signal: controller.signal,
      onText: () => controller.abort(),
    })
    await expect(promise).rejects.toThrow(/aborted/i)
  })

  it("leaves a finished request alone when the caller's signal aborts later", async () => {
    queueStructured({ content: '{"ok": true}' })
    const controller = new AbortController()
    const { session } = makeSession()
    await session.structured([{ role: "user", content: "x" }], SCHEMA, { signal: controller.signal })
    controller.abort()
    expect(requestOptions().signal?.aborted).toBe(false)
  })

  it("reports a server it can't reach as unreachable", async () => {
    queueStructured({ error: new OpenAI.APIConnectionError({ message: "Connection error." }) })
    const { session } = makeSession(undefined, "http://box:11434/v1")
    const err = await session.structured([{ role: "user", content: "x" }], SCHEMA).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(UnreachableError)
    expect((err as Error).message).toBe("ollama unreachable")
  })
})
