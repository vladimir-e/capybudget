import { describe, it, expect, vi, beforeEach } from "vitest"
import Anthropic from "@anthropic-ai/sdk"
import type { BudgetRepository, FileAdapter } from "@capybudget/persistence"
import type { StreamEvent } from "../types"
import { CutOffError, RefusedError, UnreachableError } from "../structured"
import { REPLY_TOOL_CALL_BUDGET } from "../tools"
import { MAX_OUTPUT_TOKENS, STOPPED_MARKER, STOPPED_RESULT, UNANSWERED_RESULT } from "./agent-turn"
import { AnthropicSession } from "./anthropic-session"
import { anthropicApiError as apiError, anthropicSdk } from "./test-doubles/anthropic-sdk"
import { blockingTools, lastBlocks, mockRunTool } from "./test-doubles/harness"

vi.mock("@anthropic-ai/sdk", async () => ({ default: (await import("./test-doubles/anthropic-sdk")).FakeAnthropic }))
vi.mock("../tools", async (importOriginal) => (await import("./test-doubles/harness")).toolsWithMockedRun(importOriginal))

const { stream: mockStream, queueTurn, lastStreamCall, streamStubs } = anthropicSdk

function makeSession(onEvent?: (e: StreamEvent, session: AnthropicSession) => void) {
  const events: StreamEvent[] = []
  const session: AnthropicSession = new AnthropicSession({
    budgetPath: "/budget",
    systemPrompt: "you are capy",
    apiKey: "sk-ant-test",
    model: "claude-sonnet-4-6",
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

function history(session: AnthropicSession): Anthropic.MessageParam[] {
  return (session as unknown as { messages: Anthropic.MessageParam[] }).messages
}

beforeEach(() => {
  anthropicSdk.reset()
  mockRunTool.mockReset()
})

describe("AnthropicSession", () => {
  it("sends system as a cache-marked content block (caches the tools+system prefix)", async () => {
    queueTurn({ textDeltas: ["ok"], stop_reason: "end_turn" })
    const { session } = makeSession()
    await session.send("Hi")

    expect(lastStreamCall().system).toEqual([
      {
        type: "text",
        text: "you are capy",
        cache_control: { type: "ephemeral" },
      },
    ])
  })

  it("dispatches tool_use, returns the result, and continues the loop", async () => {
    queueTurn({
      textDeltas: ["Looking up..."],
      toolUses: [{ id: "tu1", name: "list_accounts", input: {} }],
      stop_reason: "tool_use",
    })
    queueTurn({
      textDeltas: ["Found 2 accounts."],
      stop_reason: "end_turn",
    })

    mockRunTool.mockResolvedValueOnce("checking $1.00; savings $5.00")

    const { session, events } = makeSession()
    await session.send("How much do I have?")

    expect(mockRunTool).toHaveBeenCalledTimes(1)
    expect(mockRunTool).toHaveBeenCalledWith(
      "list_accounts",
      {},
      expect.objectContaining({ budgetPath: "/budget", currency: "USD" }),
    )

    const second = lastStreamCall()
    const messages = second.messages as Array<{ role: string; content: unknown }>
    // user (initial) → assistant (tool_use) → user (tool_result)
    expect(messages).toHaveLength(3)
    const toolResultTurn = messages[2]
    expect(toolResultTurn.role).toBe("user")
    expect(toolResultTurn.content).toEqual([
      {
        type: "tool_result",
        tool_use_id: "tu1",
        content: "checking $1.00; savings $5.00",
      },
    ])

    const toolActivityFound = events.some(
      (e) =>
        e.type === "content" &&
        e.blocks.some(
          (b) => b.type === "tool-activity" && b.tool === "list_accounts",
        ),
    )
    expect(toolActivityFound).toBe(true)

    expect(events[events.length - 1]).toEqual({ type: "done" })
  })

  it("extracts the inner message from an Anthropic APIError-shaped throw", async () => {
    const apiError = new Error(
      `400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}`,
    ) as Error & { status: number; error: unknown }
    apiError.status = 400
    apiError.error = {
      type: "error",
      error: {
        type: "invalid_request_error",
        message: "Your credit balance is too low to access the Anthropic API.",
      },
    }

    queueTurn({ stop_reason: "end_turn", error: apiError })

    const { session, events } = makeSession()
    await session.send("Hi")

    const errorEvent = events.find((e) => e.type === "error")
    expect(errorEvent).toEqual({
      type: "error",
      message: "Your credit balance is too low to access the Anthropic API.",
      status: 400,
      provider: "anthropic",
      rolledBack: true,
    })
  })

  it("a max_tokens cut-off never runs or stores its tool calls, retracts them, and reports cutOff", async () => {
    queueTurn({
      thinking: [{ type: "thinking", thinking: "", signature: "sig-1" }],
      toolUses: [
        { id: "tu1", name: "create_transaction", input: { memo: "a" } },
        { id: "tu2", name: "create_transaction", input: { memo: "b" } },
      ],
      stop_reason: "max_tokens",
    })

    const { session, events } = makeSession()
    await session.send("Add thirty transactions")

    expect(mockRunTool).not.toHaveBeenCalled()
    expect(events[events.length - 1]).toMatchObject({ type: "error", code: "cutOff" })
    expect(events.some((e) => e.type === "done")).toBe(false)
    const lastContent = events.filter((e) => e.type === "content").pop()
    expect(lastContent).toEqual({ type: "content", blocks: [] })

    queueTurn({ textDeltas: ["ok"], stop_reason: "end_turn" })
    await session.send("Try fewer")
    expect(lastStreamCall().messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "Add thirty transactions" },
          { type: "text", text: "Try fewer" },
        ],
      },
    ])
  })

  it("a cut-off keeps its turn up to the last text before any tool call, thinking unchanged", async () => {
    const thinking = { type: "thinking" as const, thinking: "", signature: "sig-1" }
    queueTurn({
      thinking: [thinking],
      textDeltas: ["Adding them now."],
      toolUses: [{ id: "tu1", name: "create_transaction", input: {} }],
      stop_reason: "max_tokens",
    })

    const { session, events } = makeSession()
    await session.send("Add these")

    expect(mockRunTool).not.toHaveBeenCalled()
    expect(events[events.length - 1]).toMatchObject({ type: "error", code: "cutOff" })
    const lastContent = events.filter((e) => e.type === "content").pop()
    expect(lastContent).toEqual({
      type: "content",
      blocks: [{ type: "text", content: "Adding them now." }],
    })

    queueTurn({ textDeltas: ["ok"], stop_reason: "end_turn" })
    await session.send("Go on")
    const messages = lastStreamCall().messages as Anthropic.MessageParam[]
    expect(messages[1]).toEqual({
      role: "assistant",
      content: [thinking, { type: "text", text: "Adding them now." }],
    })
    expect(messages[2]).toEqual({ role: "user", content: [{ type: "text", text: "Go on" }] })
  })

  it("a text-only max_tokens cut-off keeps its text and reports cutOff", async () => {
    queueTurn({ textDeltas: ["A long answer that"], stop_reason: "max_tokens" })

    const { session, events } = makeSession()
    await session.send("Explain")

    expect(events.at(-1)).toMatchObject({ type: "error", code: "cutOff" })
    expect(history(session)[1]).toEqual({ role: "assistant", content: [{ type: "text", text: "A long answer that" }] })
  })

  it("a refusal with no text stores nothing and reports refused", async () => {
    queueTurn({ stop_reason: "refusal" })

    const { session, events } = makeSession()
    await session.send("Hi")

    expect(events[events.length - 1]).toMatchObject({ type: "error", code: "refused" })
    queueTurn({ textDeltas: ["ok"], stop_reason: "end_turn" })
    await session.send("Again")
    const messages = lastStreamCall().messages as Anthropic.MessageParam[]
    expect(messages.map((m) => m.role)).toEqual(["user"])
  })

  it("forwards multimodal initial messages (text + image + document) to the SDK, titling the document with its filename", async () => {
    queueTurn({ textDeltas: ["ok"], stop_reason: "end_turn" })
    const { session } = makeSession()
    await session.send([
      { type: "text", text: "Receipt extraction" },
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "AAAA" },
      },
      {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: "BBBB" },
        filename: "statement.pdf",
      },
    ])

    const call = lastStreamCall()
    const messages = call.messages as Array<{ role: string; content: unknown }>
    expect(messages).toHaveLength(1)
    const blocks = messages[0].content as Array<{ type: string; title?: string }>
    expect(blocks.map((b) => b.type)).toEqual(["text", "image", "document"])
    expect(blocks[2].title).toBe("statement.pdf")
  })

  it("does not abort the stream — lets the SDK drain in the background", async () => {
    queueTurn({
      toolUses: [{ id: "tu1", name: "list_accounts", input: {} }],
      stop_reason: "tool_use",
    })
    queueTurn({
      textDeltas: ["Found 2."],
      stop_reason: "end_turn",
    })
    mockRunTool.mockResolvedValueOnce("[]")

    const { session } = makeSession()
    await session.send("How much?")

    expect(streamStubs).toHaveLength(2)
    for (const stub of streamStubs) {
      expect(stub.abortSpy).not.toHaveBeenCalled()
      expect(stub.controller.signal.aborted).toBe(false)
    }
  })

  it("resolves and emits done as soon as `message` fires, without waiting on drain", async () => {
    // The mock fires `message` and stops — it never emits an `end`/finalMessage
    // event. If the loop were awaiting drain (or trying to abort and waiting on
    // the resulting `abort` event), this send() would hang and the test would
    // time out. Passing proves the loop exits purely on `message`.
    queueTurn({
      textDeltas: ["instant"],
      stop_reason: "end_turn",
    })

    const { session, events } = makeSession()
    await session.send("Hi")

    expect(events[events.length - 1]).toEqual({ type: "done" })
  })

  it("send() merges a new user message into the trailing user turn after a terminal-tool exit", async () => {
    queueTurn({
      toolUses: [
        {
          id: "tu_followups",
          name: "render_followups",
          input: { chips: [{ label: "More", prompt: "Tell me more" }] },
        },
      ],
      stop_reason: "tool_use",
    })
    mockRunTool.mockResolvedValueOnce("Rendered.")

    const { session } = makeSession()
    await session.send("First question")

    // Queue the next turn for the follow-up send.
    queueTurn({ textDeltas: ["Reply"], stop_reason: "end_turn" })
    await session.send("Second question")

    const second = lastStreamCall()
    const messages = second.messages as Array<{ role: string; content: unknown }>

    // Two consecutive user turns would violate Anthropic's alternation.
    for (let i = 1; i < messages.length; i++) {
      expect(messages[i].role).not.toBe(messages[i - 1].role)
    }

    // The trailing user turn should carry BOTH the tool_result and the new
    // text block — merged, not stacked.
    const lastUser = [...messages].reverse().find((m) => m.role === "user")
    expect(lastUser).toBeDefined()
    const blocks = lastUser!.content as Array<{ type: string }>
    expect(blocks.some((b) => b.type === "tool_result")).toBe(true)
    expect(blocks.some((b) => b.type === "text")).toBe(true)
  })
})

describe("AnthropicSession.structured", () => {
  const SCHEMA = {
    type: "object" as const,
    properties: { ok: { type: "boolean" as const } },
    required: ["ok"],
  }

  it("makes one constrained, tool-free call and returns the parsed result", async () => {
    queueTurn({ textDeltas: ['{"ok": true}'], stop_reason: "end_turn" })

    const { session } = makeSession()
    const result = await session.structured<{ ok: boolean }>(
      [{ role: "user", content: "extract" }],
      SCHEMA,
    )

    expect(result).toEqual({ ok: true })
    expect(mockStream).toHaveBeenCalledTimes(1)

    const call = lastStreamCall()
    expect(call.tools).toBeUndefined()
    expect(call.output_config).toEqual({
      format: { type: "json_schema", schema: SCHEMA },
    })
    expect(call.model).toBe("claude-sonnet-4-6")
    expect(call.max_tokens).toBe(MAX_OUTPUT_TOKENS)
  })

  it("drops the OpenAI-only strict marker from the schema it sends", async () => {
    queueTurn({ textDeltas: ['{"ok": true}'], stop_reason: "end_turn" })
    const STRICT_SCHEMA = {
      type: "object" as const,
      additionalProperties: false,
      strict: true,
      properties: { ok: { type: "boolean" as const } },
      required: ["ok"],
    }

    const { session } = makeSession()
    await session.structured([{ role: "user", content: "x" }], STRICT_SCHEMA)

    const oc = lastStreamCall().output_config as { format: { schema: Record<string, unknown> } }
    // output_config.format enforces the schema unconditionally — `strict` is ours.
    expect(oc.format.schema).not.toHaveProperty("strict")
    expect(oc.format.schema).toMatchObject({ additionalProperties: false })
  })

  it("forwards multimodal content (text + image + document) to the SDK", async () => {
    queueTurn({ textDeltas: ['{"ok": true}'], stop_reason: "end_turn" })

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
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: "BBBB" },
            },
          ],
        },
      ],
      SCHEMA,
    )

    const call = lastStreamCall()
    const messages = call.messages as Array<{ role: string; content: unknown }>
    expect(messages).toHaveLength(1)
    const blocks = messages[0].content as Array<{ type: string }>
    expect(blocks.map((b) => b.type)).toEqual(["text", "image", "document"])
  })

  it("rejects when the model returns output that violates the schema", async () => {
    queueTurn({ textDeltas: ['{"ok": "not a boolean"}'], stop_reason: "end_turn" })

    const { session } = makeSession()
    await expect(
      session.structured([{ role: "user", content: "x" }], SCHEMA),
    ).rejects.toThrowError(/boolean/i)
  })

  it("passes an assistant turn through as plain text content", async () => {
    queueTurn({ textDeltas: ['{"ok": true}'], stop_reason: "end_turn" })

    const { session } = makeSession()
    await session.structured(
      [
        { role: "user", content: "extract" },
        { role: "assistant", content: '{"ok": false}' },
        { role: "user", content: "redo it" },
      ],
      SCHEMA,
    )

    const call = lastStreamCall()
    const messages = call.messages as Array<{ role: string; content: unknown }>
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user"])
    expect(messages[1].content).toBe('{"ok": false}')
  })

  it("surfaces accumulated (not per-delta) text through onText", async () => {
    queueTurn({ textDeltas: ['{"ok"', ": true}"], stop_reason: "end_turn" })
    const onText = vi.fn()

    const { session } = makeSession()
    const result = await session.structured<{ ok: boolean }>(
      [{ role: "user", content: "extract" }],
      SCHEMA,
      { onText },
    )

    expect(result).toEqual({ ok: true })
    expect(onText.mock.calls.map((c) => c[0])).toEqual(['{"ok"', '{"ok": true}'])
  })

  it("rejects the streaming call when the stream errors", async () => {
    queueTurn({ stop_reason: "end_turn", error: new Error("rate limited") })

    const { session } = makeSession()
    await expect(
      session.structured([{ role: "user", content: "x" }], SCHEMA, { onText: () => {} }),
    ).rejects.toThrow("rate limited")
  })

  it("rejects the streaming call when the stream aborts mid-generation", async () => {
    queueTurn({ textDeltas: ['{"ok"', ": true}"], stop_reason: "end_turn" })

    const { session } = makeSession()
    const promise = session.structured([{ role: "user", content: "x" }], SCHEMA, {
      onText: () => {},
    })
    // The stream stub exists synchronously; abort before its deferred emits run.
    streamStubs[streamStubs.length - 1].controller.abort()
    await expect(promise).rejects.toThrow(/aborted/i)
  })
})

describe("AnthropicSession.structured — cancellation and retries", () => {
  const SCHEMA = { type: "object" as const, properties: { ok: { type: "boolean" as const } }, required: ["ok"] }
  const requestOptions = () => mockStream.mock.lastCall?.[1] as { signal?: AbortSignal; maxRetries?: number }

  it("retries a failed request at most once", async () => {
    queueTurn({ textDeltas: ['{"ok": true}'], stop_reason: "end_turn" })
    const { session } = makeSession()
    await session.structured([{ role: "user", content: "x" }], SCHEMA)
    expect(requestOptions().maxRetries).toBe(1)
  })

  it("aborts the request when the caller's signal aborts mid-stream", async () => {
    queueTurn({ textDeltas: ['{"ok"', ": true}"], stop_reason: "end_turn" })
    const controller = new AbortController()
    const { session } = makeSession()
    const promise = session.structured([{ role: "user", content: "x" }], SCHEMA, {
      signal: controller.signal,
      onText: () => controller.abort(),
    })
    await expect(promise).rejects.toThrow(/aborted/i)
  })

  it("leaves a finished request alone when the caller's signal aborts later", async () => {
    queueTurn({ textDeltas: ['{"ok": true}'], stop_reason: "end_turn" })
    const controller = new AbortController()
    const { session } = makeSession()
    await session.structured([{ role: "user", content: "x" }], SCHEMA, { signal: controller.signal })
    controller.abort()
    expect(requestOptions().signal?.aborted).toBe(false)
  })

  it("reports a connection failure as unreachable", async () => {
    queueTurn({ stop_reason: "end_turn", error: new Anthropic.APIConnectionError({ message: "Connection error." }) })
    const { session } = makeSession()
    await expect(session.structured([{ role: "user", content: "x" }], SCHEMA)).rejects.toBeInstanceOf(UnreachableError)
  })
})

describe("AnthropicSession partial turns", () => {
  it("Stop mid-text keeps the thinking ahead of the marked text", async () => {
    const thinking = { type: "thinking" as const, thinking: "", signature: "sig-1" }
    queueTurn({ thinking: [thinking], textDeltas: ["Hello", " there", " friend"], stop_reason: "end_turn" })

    const { session, events } = makeSession((e, s) => {
      if (e.type === "content" && JSON.stringify(e.blocks).includes("Hello there")) void s.stop()
    })
    await session.send("Hi")

    expect(events.some((e) => e.type === "done" || e.type === "error")).toBe(false)
    expect(lastBlocks(events)).toEqual([{ type: "text", content: "Hello there" }])

    queueTurn({ textDeltas: ["ok"], stop_reason: "end_turn" })
    await session.send("Go on")
    const messages = lastStreamCall().messages as Anthropic.MessageParam[]
    expect(messages[1]).toEqual({
      role: "assistant",
      content: [thinking, { type: "text", text: `Hello there${STOPPED_MARKER}` }],
    })
    expect(messages[2]).toEqual({ role: "user", content: [{ type: "text", text: "Go on" }] })
  })

  it("Stop after a streamed tool call keeps and shows only the text before it", async () => {
    queueTurn({
      blocks: [
        { text: "Adding it." },
        { toolUse: { id: "tu1", name: "create_transaction", input: {} } },
        { text: "Also" },
        { toolUse: { id: "tu2", name: "create_transaction", input: {} } },
      ],
      stop_reason: "tool_use",
    })

    const { session, events } = makeSession((e, s) => {
      if (e.type === "content" && JSON.stringify(e.blocks).includes("Also")) void s.stop()
    })
    await session.send("Add it")

    expect(mockRunTool).not.toHaveBeenCalled()
    expect(lastBlocks(events)).toEqual([{ type: "text", content: "Adding it." }])
    expect(history(session)[1]).toEqual({
      role: "assistant",
      content: [{ type: "text", text: `Adding it.${STOPPED_MARKER}` }],
    })
  })

  it("a cut-off [text, tool_use, text] keeps and shows only the text before the call", async () => {
    queueTurn({
      blocks: [
        { text: "Adding it." },
        { toolUse: { id: "tu1", name: "create_transaction", input: {} } },
        { text: "Also" },
      ],
      stop_reason: "max_tokens",
    })

    const { session, events } = makeSession()
    await session.send("Add it")

    expect(lastBlocks(events)).toEqual([{ type: "text", content: "Adding it." }])
    expect(events.at(-1)).toMatchObject({ type: "error", code: "cutOff" })
    expect(history(session)[1]).toEqual({ role: "assistant", content: [{ type: "text", text: "Adding it." }] })
  })

  it("a cut-off [tool_use, text] keeps and shows nothing", async () => {
    queueTurn({
      blocks: [{ toolUse: { id: "tu1", name: "create_transaction", input: {} } }, { text: "Done" }],
      stop_reason: "max_tokens",
    })

    const { session, events } = makeSession()
    await session.send("Add it")

    expect(lastBlocks(events)).toEqual([])
    expect(events.at(-1)).toMatchObject({ type: "error", code: "cutOff" })
    expect(history(session).map((m) => m.role)).toEqual(["user"])
  })
})

describe("AnthropicSession tool results", () => {
  it("marks the budget-exhausted result as an error", async () => {
    for (let i = 0; i < REPLY_TOOL_CALL_BUDGET + 1; i++) {
      queueTurn({ toolUses: [{ id: `tu-${i}`, name: "list_accounts", input: {} }], stop_reason: "tool_use" })
    }
    mockRunTool.mockResolvedValue("ok")

    const { session } = makeSession()
    await session.send("Loop forever")

    const last = history(session).at(-1)!.content as Anthropic.ToolResultBlockParam[]
    expect(last[0]).toMatchObject({ is_error: true, content: expect.stringMatching(/budget exhausted/i) })
  })

  it("marks the results of calls a stop skipped as errors", async () => {
    queueTurn({
      toolUses: [
        { id: "tu1", name: "create_transaction", input: {} },
        { id: "tu2", name: "create_transaction", input: {} },
      ],
      stop_reason: "tool_use",
    })
    const tools = blockingTools()

    const { session } = makeSession()
    const sending = session.send("Add these")
    await tools.started()
    await session.stop()
    tools.resolvers[0]("created")
    await sending

    expect(history(session).at(-1)).toEqual({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "tu1", content: "created" },
        { type: "tool_result", tool_use_id: "tu2", content: STOPPED_RESULT, is_error: true },
      ],
    })
  })

  it("marks the results it supplies for a trailing turn's unanswered calls as errors", async () => {
    const { session } = makeSession()
    history(session).push(
      { role: "user", content: [{ type: "text", text: "Add it" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "tu1", name: "create_transaction", input: {} }] },
    )

    queueTurn({ textDeltas: ["ok"], stop_reason: "end_turn" })
    await session.send("Hello?")

    expect(history(session)[2]).toEqual({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "tu1", content: UNANSWERED_RESULT, is_error: true },
        { type: "text", text: "Hello?" },
      ],
    })
  })
})

describe("AnthropicSession output cap", () => {
  it("falls back to 8192 when the cap error names no smaller limit", async () => {
    queueTurn({ stop_reason: null, error: apiError(400, "max_tokens is too large for this model") })
    queueTurn({ textDeltas: ["ok"], stop_reason: "end_turn" })

    const { session } = makeSession()
    await session.send("Hi")
    expect(lastStreamCall().max_tokens).toBe(8192)
  })

  it("never lowers the cap for a context-window overflow", async () => {
    queueTurn({
      stop_reason: null,
      error: apiError(400, "input length and `max_tokens` exceed context limit: 197000 + 32000 > 200000, decrease input length or `max_tokens` and try again"),
    })

    const { session, events } = makeSession()
    await session.send("Hi")
    expect(mockStream).toHaveBeenCalledTimes(1)
    expect(events.at(-1)).toMatchObject({ type: "error", status: 400 })
  })

  it("structured() retries a cap 400 too", async () => {
    queueTurn({ stop_reason: null, error: apiError(400, "max_tokens: 32000 > 4096, which is the maximum") })
    queueTurn({ textDeltas: ['{"ok": true}'], stop_reason: "end_turn" })

    const { session } = makeSession()
    const result = await session.structured([{ role: "user", content: "x" }], {
      type: "object",
      properties: { ok: { type: "boolean" } },
      required: ["ok"],
    })
    expect(result).toEqual({ ok: true })
    expect(lastStreamCall().max_tokens).toBe(4096)
  })

  it("structured() reports a truncated reply as cut off, not as a parse error", async () => {
    queueTurn({ textDeltas: ['{"ok": tr'], stop_reason: "max_tokens" })

    const { session } = makeSession()
    await expect(
      session.structured([{ role: "user", content: "x" }], { type: "object", properties: {} }),
    ).rejects.toBeInstanceOf(CutOffError)
  })

  it("structured() reports a refusal as refused, not as cut off", async () => {
    queueTurn({ textDeltas: [], stop_reason: "refusal" })

    const { session } = makeSession()
    await expect(
      session.structured([{ role: "user", content: "x" }], { type: "object", properties: {} }),
    ).rejects.toBeInstanceOf(RefusedError)
  })
})
