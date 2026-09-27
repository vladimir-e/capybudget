import { describe, it, expect, vi, beforeEach } from "vitest"
import type Anthropic from "@anthropic-ai/sdk"
import type { StreamEvent } from "@capybudget/intelligence"
import type { CurrencySettings } from "@capybudget/core"
import type { BudgetRepository, FileAdapter } from "@capybudget/persistence"
import { getToolDefinitions } from "../tools"

interface FakeBlock {
  type: "text" | "tool_use"
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
}

interface FakeTurn {
  thinking?: Array<{ type: "thinking"; thinking: string; signature: string }>
  blocks?: Array<{ text: string } | { toolUse: { id: string; name: string; input: Record<string, unknown> } }>
  textDeltas?: string[]
  toolUses?: Array<{ id: string; name: string; input: Record<string, unknown> }>
  stop_reason: Anthropic.StopReason | null
  error?: Error
}

const { mockStream, queueTurn, lastStreamCall, abortSignals, streamStubs } = vi.hoisted(() => {
  const queue: FakeTurn[] = []
  const calls: Array<Record<string, unknown>> = []
  const signals: AbortSignal[] = []
  const stubs: Array<{ controller: AbortController; abortSpy: ReturnType<typeof vi.fn> }> = []

  const stream = vi.fn().mockImplementation((params, opts) => {
    calls.push({ ...params, messages: JSON.parse(JSON.stringify(params.messages)) })
    if (opts?.signal) signals.push(opts.signal as AbortSignal)
    const turn = queue.shift()
    if (!turn) {
      throw new Error("Test bug: no turn queued for messages.stream()")
    }

    type Handler = (...args: unknown[]) => void
    const handlers: Record<string, Handler[]> = {}
    const controller = new AbortController()
    const abortSpy = vi.fn()
    const originalAbort = controller.abort.bind(controller)
    controller.abort = ((reason?: unknown) => {
      abortSpy(reason)
      return originalAbort(reason as Error | undefined)
    }) as typeof controller.abort
    let ended = false
    const completed: FakeBlock[] = []
    let textAccum = ""

    function emit(event: string, ...args: unknown[]): void {
      if (ended) return
      const list = handlers[event]
      if (!list) return
      handlers[event] = list.filter((h) => !(h as { once?: boolean }).once)
      for (const h of list) h(...args)
    }

    function on(event: string, handler: Handler): typeof stub {
      ;(handlers[event] ??= []).push(handler)
      return stub
    }

    function once(event: string, handler: Handler): typeof stub {
      const wrapped = ((...args: unknown[]) => handler(...args)) as Handler & {
        once?: boolean
      }
      wrapped.once = true
      ;(handlers[event] ??= []).push(wrapped)
      return stub
    }

    const toContent = (blocks: FakeBlock[]) =>
      blocks.map((b) =>
        b.type === "text"
          ? { type: "text", text: b.text }
          : { type: "tool_use", id: b.id, name: b.name, input: b.input },
      )

    const stub = {
      on,
      once,
      controller,
      get currentMessage() {
        const inProgress: FakeBlock[] = textAccum ? [{ type: "text", text: textAccum }] : []
        return { content: [...(turn.thinking ?? []), ...toContent([...completed, ...inProgress])], stop_reason: null }
      },
    }
    stubs.push({ controller, abortSpy })

    // Defer emits so the caller's `.on()` listeners are registered first.
    queueMicrotask(async () => {
      try {
        if (turn.error) {
          emit("error", turn.error)
          ended = true
          return
        }
        const sig = opts?.signal as AbortSignal | undefined
        for (const b of turn.blocks ?? []) {
          if (sig?.aborted || controller.signal.aborted) {
            const err = new Error("Aborted")
            err.name = "AbortError"
            emit("abort", err)
            ended = true
            return
          }
          const block: FakeBlock =
            "text" in b ? { type: "text", text: b.text } : { type: "tool_use", ...b.toolUse }
          if (block.type === "text") emit("text", block.text)
          emit("contentBlock", block)
          completed.push(block)
        }
        if (turn.textDeltas) {
          for (const delta of turn.textDeltas) {
            if (sig?.aborted || controller.signal.aborted) {
              const err = new Error("Aborted")
              err.name = "AbortError"
              emit("abort", err)
              ended = true
              return
            }
            textAccum += delta
            emit("text", delta)
          }
          if (textAccum) completed.push({ type: "text", text: textAccum })
          textAccum = ""
        }
        if (turn.toolUses) {
          for (const tu of turn.toolUses) {
            if (sig?.aborted || controller.signal.aborted) {
              const err = new Error("Aborted")
              err.name = "AbortError"
              emit("abort", err)
              ended = true
              return
            }
            const block: FakeBlock = {
              type: "tool_use",
              id: tu.id,
              name: tu.name,
              input: tu.input,
            }
            emit("contentBlock", block)
            completed.push(block)
          }
        }
        emit("message", {
          content: [...(turn.thinking ?? []), ...toContent(completed)],
          stop_reason: turn.stop_reason,
        })
        ended = true
      } catch (err) {
        emit("error", err)
        ended = true
      }
    })

    return stub
  })

  function queueTurn(turn: FakeTurn) {
    queue.push(turn)
  }

  return {
    mockStream: stream,
    queueTurn,
    lastStreamCall: () => calls[calls.length - 1],
    abortSignals: signals,
    streamStubs: stubs,
  }
})

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class {
      messages = { stream: mockStream }
    },
  }
})

const { mockRunTool } = vi.hoisted(() => ({
  mockRunTool: vi.fn<
    (
      name: string,
      input: Record<string, unknown>,
      ctx: unknown,
    ) => Promise<string>
  >(),
}))

vi.mock("../tools", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>
  return {
    ...original,
    runTool: mockRunTool,
  }
})

import { AnthropicSession } from "./anthropic-session"
import { MAX_OUTPUT_TOKENS, STOPPED_MARKER, STOPPED_RESULT, UNANSWERED_RESULT } from "./agent-turn"
import { CutOffError } from "../structured"

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

beforeEach(() => {
  mockStream.mockClear()
  mockRunTool.mockReset()
  abortSignals.length = 0
  streamStubs.length = 0
})

describe("AnthropicSession", () => {
  it("emits cumulative content events and a done event on a one-turn reply", async () => {
    queueTurn({
      textDeltas: ["Hello", ", world"],
      stop_reason: "end_turn",
    })

    const { session, events } = makeSession()
    await session.send("Hi")

    const contentEvents = events.filter((e) => e.type === "content")
    expect(contentEvents).toHaveLength(2)
    expect(contentEvents[0]).toEqual({
      type: "content",
      blocks: [{ type: "text", content: "Hello" }],
    })
    expect(contentEvents[1]).toEqual({
      type: "content",
      blocks: [{ type: "text", content: "Hello, world" }],
    })
    expect(events[events.length - 1]).toEqual({ type: "done" })
  })

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

  it("reads currencies live at tool-run time, so a rate edit lands without a session rebuild", async () => {
    // The session is constructed with a frozen snapshot, but `getCurrencies`
    // is the live source. A manual rate edit after construction must reach the
    // next tool call — the adapter must prefer the getter over the snapshot.
    const liveCurrencies: { ref: Record<string, CurrencySettings> } = {
      ref: { USD: { decimals: 2, symbolPosition: "before" } },
    }

    queueTurn({
      toolUses: [{ id: "tu1", name: "create_transaction", input: {} }],
      stop_reason: "tool_use",
    })
    queueTurn({ textDeltas: ["Added."], stop_reason: "end_turn" })
    mockRunTool.mockResolvedValueOnce(JSON.stringify({ success: true }))

    const events: StreamEvent[] = []
    const session = new AnthropicSession({
      budgetPath: "/budget",
      systemPrompt: "you are capy",
      apiKey: "sk-ant-test",
      model: "claude-sonnet-4-6",
      onEvent: (e) => events.push(e),
      repo: {} as BudgetRepository,
      fileAdapter: {} as FileAdapter,
      currency: "EUR",
      currencies: { EUR: { decimals: 2, symbolPosition: "before" } },
      getCurrencies: () => liveCurrencies.ref,
    })

    // The user edits a rate before sending — the live map now differs from the
    // construction-time snapshot.
    liveCurrencies.ref = {
      EUR: { decimals: 2, symbolPosition: "before" },
      RUB: { decimals: 0, symbolPosition: "after", rate: 0.0125, rateSource: "manual" },
    }

    await session.send("Add a RUB expense")

    expect(mockRunTool).toHaveBeenCalledWith(
      "create_transaction",
      {},
      expect.objectContaining({ currencies: liveCurrencies.ref }),
    )
  })

  it("emits a render-tool ContentBlock without a tool-activity block", async () => {
    queueTurn({
      toolUses: [
        {
          id: "tu-render",
          name: "render_table",
          input: {
            headers: ["Account", "Balance"],
            rows: [["Checking", "$1,000.00"]],
          },
        },
      ],
      stop_reason: "tool_use",
    })
    queueTurn({ textDeltas: ["done"], stop_reason: "end_turn" })

    mockRunTool.mockResolvedValueOnce("Rendered.")

    const { session, events } = makeSession()
    await session.send("Show me a table")

    const allBlocks = events.flatMap((e) =>
      e.type === "content" ? e.blocks : [],
    )
    const tableBlock = allBlocks.find((b) => b.type === "table")
    expect(tableBlock).toEqual({
      type: "table",
      headers: ["Account", "Balance"],
      rows: [["Checking", "$1,000.00"]],
    })
    expect(
      allBlocks.some(
        (b) => b.type === "tool-activity" && b.tool === "render_table",
      ),
    ).toBe(false)
  })

  it("emits an error event when the SDK throws", async () => {
    queueTurn({
      stop_reason: "end_turn",
      error: new Error("rate limited"),
    })

    const { session, events } = makeSession()
    await session.send("Hi")

    const errorEvent = events.find((e) => e.type === "error")
    expect(errorEvent).toEqual({
      type: "error",
      message: "rate limited",
      provider: "anthropic",
    })
    expect(events.some((e) => e.type === "done")).toBe(false)
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
    })
  })

  it("stop() mid-batch finishes the running tool, runs no more, and keeps the round answered", async () => {
    queueTurn({
      toolUses: [
        { id: "tu1", name: "create_transaction", input: { memo: "a" } },
        { id: "tu2", name: "create_transaction", input: { memo: "b" } },
        { id: "tu3", name: "create_transaction", input: { memo: "c" } },
      ],
      stop_reason: "tool_use",
    })
    let resolveRun: ((v: string) => void) | null = null
    mockRunTool.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveRun = resolve
        }),
    )

    const { session, events } = makeSession()
    const sendPromise = session.send("Add these")
    await vi.waitFor(() => {
      if (!resolveRun) throw new Error("not yet")
    })
    await session.stop()
    resolveRun!("created a")
    await sendPromise

    expect(mockRunTool).toHaveBeenCalledTimes(1)
    expect(events.some((e) => e.type === "done" || e.type === "error")).toBe(false)

    queueTurn({ textDeltas: ["ok"], stop_reason: "end_turn" })
    await session.send("Hi again")
    const messages = lastStreamCall().messages as Anthropic.MessageParam[]
    expect(messages).toHaveLength(3)
    expect(messages[2]).toEqual({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "tu1", content: "created a" },
        { type: "tool_result", tool_use_id: "tu2", content: STOPPED_RESULT, is_error: true },
        { type: "tool_result", tool_use_id: "tu3", content: STOPPED_RESULT, is_error: true },
        { type: "text", text: "Hi again" },
      ],
    })
  })

  it("a send issued while a stopped round winds down waits for it before touching history", async () => {
    queueTurn({
      toolUses: [{ id: "tu1", name: "create_transaction", input: {} }],
      stop_reason: "tool_use",
    })
    let resolveRun: ((v: string) => void) | null = null
    mockRunTool.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveRun = resolve
        }),
    )

    const { session } = makeSession()
    const first = session.send("Add it")
    await vi.waitFor(() => {
      if (!resolveRun) throw new Error("not yet")
    })
    await session.stop()
    queueTurn({ textDeltas: ["ok"], stop_reason: "end_turn" })
    const second = session.send("Next")
    resolveRun!("created")
    await Promise.all([first, second])

    const messages = lastStreamCall().messages as Anthropic.MessageParam[]
    expect(messages[2]).toEqual({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "tu1", content: "created" },
        { type: "text", text: "Next" },
      ],
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

  it("answers a trailing turn's unanswered tool_use before appending the next user message", async () => {
    const { session } = makeSession()
    const history = (session as unknown as { messages: Anthropic.MessageParam[] }).messages
    history.push(
      { role: "user", content: [{ type: "text", text: "Add it" }] },
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "tu1", name: "create_transaction", input: {} },
          { type: "tool_use", id: "tu2", name: "create_transaction", input: {} },
        ],
      },
    )

    queueTurn({ textDeltas: ["ok"], stop_reason: "end_turn" })
    await session.send("Hello?")

    const messages = lastStreamCall().messages as Anthropic.MessageParam[]
    expect(messages[2]).toEqual({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "tu1", content: UNANSWERED_RESULT, is_error: true },
        { type: "tool_result", tool_use_id: "tu2", content: UNANSWERED_RESULT, is_error: true },
        { type: "text", text: "Hello?" },
      ],
    })
  })

  it("streams the agent loop with the raised output cap", async () => {
    queueTurn({ textDeltas: ["ok"], stop_reason: "end_turn" })
    const { session } = makeSession()
    await session.send("Hi")
    expect(lastStreamCall().max_tokens).toBe(MAX_OUTPUT_TOKENS)
  })

  it("kill() flips isAlive false and aborts in-flight requests", async () => {
    queueTurn({
      textDeltas: ["typing"],
      stop_reason: "end_turn",
    })
    const { session } = makeSession()
    await session.send("Hi")
    expect(session.isAlive).toBe(true)
    await session.kill()
    expect(session.isAlive).toBe(false)
  })

  it("walks a multi-turn tool loop, threading each result back to the model", async () => {
    queueTurn({
      toolUses: [
        { id: "tu-search", name: "search_transactions", input: { query: "Apple" } },
      ],
      stop_reason: "tool_use",
    })
    queueTurn({
      toolUses: [
        {
          id: "tu-group",
          name: "group_transactions",
          input: { groupBy: ["merchant"], metrics: ["sum"] },
        },
      ],
      stop_reason: "tool_use",
    })
    queueTurn({
      textDeltas: ["You spent $312 across 8 Apple charges."],
      stop_reason: "end_turn",
    })

    mockRunTool
      .mockResolvedValueOnce(JSON.stringify({ rows: [{ id: "t-1" }] }))
      .mockResolvedValueOnce(JSON.stringify({ groups: [{ key: "Apple", sum: -31200 }] }))

    const { session, events } = makeSession()
    await session.send("How much have I spent at Apple?")

    expect(mockRunTool).toHaveBeenNthCalledWith(
      1,
      "search_transactions",
      { query: "Apple" },
      expect.objectContaining({ budgetPath: "/budget" }),
    )
    expect(mockRunTool).toHaveBeenNthCalledWith(
      2,
      "group_transactions",
      expect.objectContaining({ groupBy: ["merchant"] }),
      expect.objectContaining({ budgetPath: "/budget" }),
    )

    expect(events[events.length - 1]).toEqual({ type: "done" })
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

  it("terminates with a budget-exhausted error after SESSION_TOOL_CALL_BUDGET tool calls", async () => {
    const { SESSION_TOOL_CALL_BUDGET } = await import("@capybudget/intelligence")
    for (let i = 0; i < SESSION_TOOL_CALL_BUDGET + 1; i++) {
      queueTurn({
        toolUses: [{ id: `tu-${i}`, name: "list_accounts", input: {} }],
        stop_reason: "tool_use",
      })
    }
    mockRunTool.mockResolvedValue("ok")

    const { session, events } = makeSession()
    await session.send("Loop forever")

    expect(mockRunTool).toHaveBeenCalledTimes(SESSION_TOOL_CALL_BUDGET)

    const errorEvent = events.find((e) => e.type === "error")
    expect(errorEvent).toMatchObject({ code: "budgetExhausted" })
    expect(errorEvent?.message).toMatch(/budget exhausted/i)
    expect(events.some((e) => e.type === "done")).toBe(false)
  })

  it("accumulates render blocks across agentic-loop iterations (cumulative cycle)", async () => {
    queueTurn({
      textDeltas: ["Here's the split:"],
      toolUses: [
        {
          id: "tu-donut",
          name: "render_chart",
          input: {
            title: "Spending",
            type: "donut",
            data: [{ label: "Food", value: 50 }],
          },
        },
      ],
      stop_reason: "tool_use",
    })
    queueTurn({
      toolUses: [
        {
          id: "tu-table",
          name: "render_table",
          input: {
            headers: ["Category", "Amount"],
            rows: [["Food", "$50"]],
          },
        },
      ],
      stop_reason: "tool_use",
    })
    queueTurn({ textDeltas: ["done"], stop_reason: "end_turn" })

    mockRunTool.mockResolvedValue("Rendered.")

    const { session, events } = makeSession()
    await session.send("Breakdown please")

    const contentEvents = events.filter((e) => e.type === "content")
    const finalEmit = contentEvents[contentEvents.length - 1]
    if (finalEmit?.type !== "content") throw new Error("expected content event")
    const types = finalEmit.blocks.map((b) => b.type)
    expect(types).toContain("donut-chart")
    expect(types).toContain("table")
  })

  it("restart() resets the budget counter so the next session starts fresh", async () => {
    const { SESSION_TOOL_CALL_BUDGET } = await import("@capybudget/intelligence")
    for (let i = 0; i < SESSION_TOOL_CALL_BUDGET + 1; i++) {
      queueTurn({
        toolUses: [{ id: `tu-${i}`, name: "list_accounts", input: {} }],
        stop_reason: "tool_use",
      })
    }
    mockRunTool.mockResolvedValue("ok")

    const { session } = makeSession()
    await session.send("Loop forever")
    expect(mockRunTool).toHaveBeenCalledTimes(SESSION_TOOL_CALL_BUDGET)

    await session.restart()
    mockRunTool.mockClear()
    queueTurn({
      toolUses: [{ id: "tu-post-restart", name: "list_accounts", input: {} }],
      stop_reason: "tool_use",
    })
    queueTurn({
      textDeltas: ["Done."],
      stop_reason: "end_turn",
    })

    await session.send("After restart")

    expect(mockRunTool).toHaveBeenCalledTimes(1)
  })

  it("emits a tool-result event with ok=true after a tool resolves", async () => {
    queueTurn({
      toolUses: [{ id: "tu_ok", name: "create_transaction", input: {} }],
      stop_reason: "tool_use",
    })
    queueTurn({ textDeltas: ["Done."], stop_reason: "end_turn" })
    mockRunTool.mockResolvedValueOnce(JSON.stringify({ success: true }))

    const { session, events } = makeSession()
    await session.send("Add it.")

    const toolResults = events.filter((e) => e.type === "tool-result")
    expect(toolResults).toEqual([
      { type: "tool-result", tool: "create_transaction", id: "tu_ok", ok: true },
    ])
  })

  it("emits tool-result with ok=false when the handler throws", async () => {
    queueTurn({
      toolUses: [{ id: "tu_err", name: "create_transaction", input: {} }],
      stop_reason: "tool_use",
    })
    queueTurn({ textDeltas: ["Sorry."], stop_reason: "end_turn" })
    mockRunTool.mockRejectedValueOnce(new Error("disk full"))

    const { session, events } = makeSession()
    await session.send("Add it.")

    const toolResults = events.filter((e) => e.type === "tool-result")
    expect(toolResults).toEqual([
      { type: "tool-result", tool: "create_transaction", id: "tu_err", ok: false },
    ])
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

    // The previous fix aborted each stream after `message` to short-circuit
    // drain; the abort didn't propagate through the WKWebView fetch body and
    // wedged the next iteration. Now we just stop listening and let the SDK
    // finish on its own — abort must never fire from the loop itself.
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

  it("emits one tool-result per tool when a turn carries multiple tool_use blocks", async () => {
    queueTurn({
      toolUses: [
        { id: "tu_a", name: "create_transaction", input: {} },
        { id: "tu_b", name: "list_accounts", input: {} },
      ],
      stop_reason: "tool_use",
    })
    queueTurn({ textDeltas: ["Done."], stop_reason: "end_turn" })
    mockRunTool
      .mockResolvedValueOnce(JSON.stringify({ success: true }))
      .mockResolvedValueOnce("[]")

    const { session, events } = makeSession()
    await session.send("Two things.")

    const toolResults = events.filter((e) => e.type === "tool-result")
    expect(toolResults).toEqual([
      { type: "tool-result", tool: "create_transaction", id: "tu_a", ok: true },
      { type: "tool-result", tool: "list_accounts", id: "tu_b", ok: true },
    ])
  })

  it("treats render_followups as terminal — exits the loop without a second API call", async () => {
    queueTurn({
      textDeltas: ["Done."],
      toolUses: [
        {
          id: "tu_followups",
          name: "render_followups",
          input: {
            chips: [
              { label: "Compare to 2023", prompt: "How does that compare to 2023?" },
              { label: "Monthly breakdown", prompt: "Show me the monthly breakdown." },
            ],
          },
        },
      ],
      stop_reason: "tool_use",
    })
    // No second turn is queued — if the loop tried to iterate again the mock
    // would throw "no turn queued".
    mockRunTool.mockResolvedValueOnce("Rendered.")

    const { session, events } = makeSession()
    await session.send("How much did I spend?")

    expect(mockStream).toHaveBeenCalledTimes(1)
    expect(mockRunTool).toHaveBeenCalledTimes(1)
    expect(events[events.length - 1]).toEqual({ type: "done" })
    expect(events.filter((e) => e.type === "done")).toHaveLength(1)

    // History after the exit should end with the user-role tool_results that
    // reference the render_followups call — the action is preserved.
    queueTurn({ textDeltas: ["next"], stop_reason: "end_turn" })
    await session.send("Next question")
    const second = lastStreamCall()
    const messages = second.messages as Array<{ role: string; content: unknown }>
    const toolResultPresent = messages.some(
      (m) =>
        m.role === "user" &&
        Array.isArray(m.content) &&
        (m.content as Array<{ type: string; tool_use_id?: string }>).some(
          (b) => b.type === "tool_result" && b.tool_use_id === "tu_followups",
        ),
    )
    expect(toolResultPresent).toBe(true)
  })

  it("continues the loop when render_followups fails validation, so the model can recover", async () => {
    queueTurn({
      toolUses: [
        { id: "tu_bad_followups", name: "render_followups", input: { chips: [] } },
      ],
      stop_reason: "tool_use",
    })
    // The retry turn — if the failed call were treated as terminal, the loop
    // would exit without requesting it and the user would see nothing.
    queueTurn({
      textDeltas: ["Here's a recap instead."],
      stop_reason: "end_turn",
    })
    mockRunTool.mockRejectedValueOnce(
      new Error("Invalid input: render_followups expects {chips: [{label, prompt}, ...]} with at least one chip. Nothing was rendered."),
    )

    const { session, events } = makeSession()
    await session.send("How much did I spend?")

    expect(mockStream).toHaveBeenCalledTimes(2)
    expect(events).toContainEqual({
      type: "tool-result",
      tool: "render_followups",
      id: "tu_bad_followups",
      ok: false,
    })

    // The error tool_result reached the model on the retry request.
    const second = lastStreamCall()
    const messages = second.messages as Array<{ role: string; content: unknown }>
    const errorResultSent = messages.some(
      (m) =>
        m.role === "user" &&
        Array.isArray(m.content) &&
        (m.content as Array<{ type: string; content?: string }>).some(
          (b) => b.type === "tool_result" && b.content?.includes("Invalid input"),
        ),
    )
    expect(errorResultSent).toBe(true)

    // The model's recovery text rendered.
    const lastContent = [...events].reverse().find((e) => e.type === "content")
    if (lastContent?.type !== "content") throw new Error("expected content event")
    expect(lastContent.blocks).toContainEqual({
      type: "text",
      content: "Here's a recap instead.",
    })
    expect(events[events.length - 1]).toEqual({ type: "done" })
  })

  it("runs an action tool bundled with render_followups in the same turn, then exits once", async () => {
    queueTurn({
      toolUses: [
        { id: "tu_action", name: "list_accounts", input: {} },
        {
          id: "tu_followups",
          name: "render_followups",
          input: { chips: [{ label: "More", prompt: "Tell me more" }] },
        },
      ],
      stop_reason: "tool_use",
    })
    // No second turn — terminal-tool exit must short-circuit the loop even
    // when paired with an action tool.
    mockRunTool
      .mockResolvedValueOnce("checking $1.00")
      .mockResolvedValueOnce("Rendered.")

    const { session, events } = makeSession()
    await session.send("Show me balances")

    expect(mockStream).toHaveBeenCalledTimes(1)
    expect(mockRunTool).toHaveBeenCalledTimes(2)
    expect(mockRunTool).toHaveBeenNthCalledWith(
      1,
      "list_accounts",
      {},
      expect.objectContaining({ budgetPath: "/budget" }),
    )

    const toolResultIds = events
      .filter((e) => e.type === "tool-result")
      .map((e) => (e.type === "tool-result" ? e.id : ""))
    expect(toolResultIds).toEqual(["tu_action", "tu_followups"])

    expect(events.filter((e) => e.type === "done")).toHaveLength(1)
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

describe("AnthropicSession tool surface", () => {
  async function loopToolNames(): Promise<string[]> {
    const { session } = makeSession()
    queueTurn({ textDeltas: ["ok"], stop_reason: "end_turn" })
    await session.send("hi")
    const tools = lastStreamCall().tools as Array<{ name: string }>
    return tools.map((t) => t.name)
  }

  it("the agent loop sends the full tool surface, byte-identical to the MCP surface", async () => {
    const names = await loopToolNames()
    expect(new Set(names)).toEqual(new Set(getToolDefinitions().map((t) => t.name)))
    expect(names).toContain("render_table")
    expect(names).toContain("create_transaction")
    expect(names).toContain("start_import")
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

function apiError(status: number, message: string): Error {
  const err = new Error(`${status} ${message}`) as Error & { status: number; error: unknown }
  err.status = status
  err.error = { type: "error", error: { type: "invalid_request_error", message } }
  return err
}

function blockingTools() {
  const resolvers: Array<(v: string) => void> = []
  mockRunTool.mockImplementation(
    () =>
      new Promise<string>((resolve) => {
        resolvers.push(resolve)
      }),
  )
  return {
    resolvers,
    started: () =>
      vi.waitFor(() => {
        if (resolvers.length === 0) throw new Error("not yet")
      }),
  }
}

function history(session: AnthropicSession): Anthropic.MessageParam[] {
  return (session as unknown as { messages: Anthropic.MessageParam[] }).messages
}

function lastBlocks(events: StreamEvent[]) {
  const last = events.filter((e) => e.type === "content").pop()
  if (last?.type !== "content") throw new Error("expected content event")
  return last.blocks
}

describe("AnthropicSession lifecycle", () => {
  it("stop() mid-batch retracts the cards of calls that never run and reports only the run call", async () => {
    queueTurn({
      toolUses: [
        { id: "tu1", name: "create_transaction", input: {} },
        { id: "tu2", name: "list_accounts", input: {} },
        { id: "tu3", name: "list_categories", input: {} },
      ],
      stop_reason: "tool_use",
    })
    const tools = blockingTools()

    const { session, events } = makeSession()
    const sending = session.send("Add these")
    await tools.started()
    await session.stop()
    const afterStop = events.length
    tools.resolvers[0]("created")
    await sending

    expect(lastBlocks(events)).toEqual([{ type: "tool-activity", tool: "create_transaction" }])
    expect(events.slice(afterStop)).toEqual([
      { type: "tool-result", tool: "create_transaction", id: "tu1", ok: true },
    ])
    expect(events.filter((e) => e.type === "tool-result")).toHaveLength(1)
  })

  it("stop() in the tool phase leaves the finished stream un-aborted", async () => {
    queueTurn({
      toolUses: [{ id: "tu1", name: "create_transaction", input: {} }],
      stop_reason: "tool_use",
    })
    const tools = blockingTools()

    const { session } = makeSession()
    const sending = session.send("Add it")
    await tools.started()
    await session.stop()
    tools.resolvers[0]("created")
    await sending

    expect(abortSignals[0].aborted).toBe(false)
    expect(streamStubs[0].abortSpy).not.toHaveBeenCalled()
  })

  it("kill() during the tool loop answers the rest with STOPPED and emits nothing more", async () => {
    queueTurn({
      toolUses: [
        { id: "tu1", name: "create_transaction", input: {} },
        { id: "tu2", name: "create_transaction", input: {} },
      ],
      stop_reason: "tool_use",
    })
    const tools = blockingTools()

    const { session, events } = makeSession()
    const sending = session.send("Add these")
    await tools.started()
    const queued = session.send("And another")
    await session.kill()
    const afterKill = events.length
    tools.resolvers[0]("created")
    await Promise.all([sending, queued])

    expect(events.slice(afterKill)).toEqual([])
    expect(mockStream).toHaveBeenCalledTimes(1)
    expect(history(session).at(-1)).toEqual({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "tu1", content: "created" },
        { type: "tool_result", tool_use_id: "tu2", content: STOPPED_RESULT, is_error: true },
      ],
    })
  })

  it("restart() waits for an in-flight tool before clearing history", async () => {
    queueTurn({
      toolUses: [{ id: "tu1", name: "create_transaction", input: {} }],
      stop_reason: "tool_use",
    })
    const tools = blockingTools()

    const { session } = makeSession()
    const sending = session.send("Add it")
    await tools.started()
    const restarting = session.restart()
    tools.resolvers[0]("created")
    await Promise.all([sending, restarting])

    expect(history(session)).toEqual([])
    queueTurn({ textDeltas: ["ok"], stop_reason: "end_turn" })
    await session.send("Fresh")
    expect(lastStreamCall().messages).toEqual([{ role: "user", content: [{ type: "text", text: "Fresh" }] }])
  })

  it("a second Stop cancels a send queued behind the stopped round", async () => {
    queueTurn({
      toolUses: [{ id: "tu1", name: "create_transaction", input: {} }],
      stop_reason: "tool_use",
    })
    const tools = blockingTools()

    const { session, events } = makeSession()
    const first = session.send("Add it")
    await tools.started()
    await session.stop()
    const queued = session.send("Next")
    await session.stop()
    tools.resolvers[0]("created")
    await Promise.all([first, queued])

    expect(mockStream).toHaveBeenCalledTimes(1)
    expect(events.some((e) => e.type === "done" || e.type === "error")).toBe(false)
    expect(history(session).at(-1)).toEqual({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "tu1", content: "created" }],
    })
  })

  it("restart() cancels a send queued behind a stopped round, so it never runs against the old history", async () => {
    queueTurn({
      toolUses: [{ id: "tu1", name: "create_transaction", input: {} }],
      stop_reason: "tool_use",
    })
    const tools = blockingTools()

    const { session } = makeSession()
    const first = session.send("Add it")
    await tools.started()
    await session.stop()
    const queued = session.send("Next")
    const restarting = session.restart()
    tools.resolvers[0]("created")
    await Promise.all([first, queued, restarting])

    expect(mockStream).toHaveBeenCalledTimes(1)
    expect(history(session)).toEqual([])
  })

  it("Stop mid-text keeps the streamed text, marked as stopped, and shows exactly that text", async () => {
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

  it("a send whose content can't be converted reports an error and doesn't wedge the session", async () => {
    const { session, events } = makeSession()
    await session.send(42 as unknown as string)
    expect(events.at(-1)).toMatchObject({ type: "error", provider: "anthropic" })

    queueTurn({ textDeltas: ["ok"], stop_reason: "end_turn" })
    await session.send("Hi")
    expect(events.at(-1)).toEqual({ type: "done" })
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

  it("marks the budget-exhausted result as an error", async () => {
    const { SESSION_TOOL_CALL_BUDGET } = await import("@capybudget/intelligence")
    for (let i = 0; i < SESSION_TOOL_CALL_BUDGET + 1; i++) {
      queueTurn({ toolUses: [{ id: `tu-${i}`, name: "list_accounts", input: {} }], stop_reason: "tool_use" })
    }
    mockRunTool.mockResolvedValue("ok")

    const { session } = makeSession()
    await session.send("Loop forever")

    const last = history(session).at(-1)!.content as Anthropic.ToolResultBlockParam[]
    expect(last[0]).toMatchObject({ is_error: true, content: expect.stringMatching(/budget exhausted/i) })
  })
})

describe("AnthropicSession output cap", () => {
  it("retries once with the limit a max_tokens 400 names, and keeps it for the session", async () => {
    queueTurn({
      stop_reason: null,
      error: apiError(
        400,
        "max_tokens: 32000 > 8192, which is the maximum allowed number of output tokens for claude-3-5-haiku-20241022",
      ),
    })
    queueTurn({ textDeltas: ["ok"], stop_reason: "end_turn" })

    const { session, events } = makeSession()
    await session.send("Hi")
    expect(lastStreamCall().max_tokens).toBe(8192)
    expect(events.at(-1)).toEqual({ type: "done" })

    queueTurn({ textDeltas: ['{"ok": true}'], stop_reason: "end_turn" })
    await session.structured([{ role: "user", content: "x" }], {
      type: "object",
      properties: { ok: { type: "boolean" } },
      required: ["ok"],
    })
    expect(mockStream).toHaveBeenCalledTimes(3)
    expect(lastStreamCall().max_tokens).toBe(8192)
  })

  it("falls back to 8192 when the cap error names no smaller limit", async () => {
    queueTurn({ stop_reason: null, error: apiError(400, "max_tokens is too large for this model") })
    queueTurn({ textDeltas: ["ok"], stop_reason: "end_turn" })

    const { session } = makeSession()
    await session.send("Hi")
    expect(lastStreamCall().max_tokens).toBe(8192)
  })

  it("a retry that 400s again surfaces the error and leaves the cap unchanged", async () => {
    queueTurn({ stop_reason: null, error: apiError(400, "max_tokens: 32000 > 8192, which is the maximum allowed number of output tokens for claude-3-5-haiku-20241022") })
    queueTurn({ stop_reason: null, error: apiError(400, "messages: text content blocks must be non-empty") })

    const { session, events } = makeSession()
    await session.send("Hi")
    expect(mockStream).toHaveBeenCalledTimes(2)
    expect(events.at(-1)).toMatchObject({ type: "error", status: 400, message: "messages: text content blocks must be non-empty" })

    queueTurn({ textDeltas: ["ok"], stop_reason: "end_turn" })
    await session.send("Again")
    expect(lastStreamCall().max_tokens).toBe(MAX_OUTPUT_TOKENS)
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

  it("surfaces an unrelated 400 without retrying", async () => {
    queueTurn({ stop_reason: null, error: apiError(400, "messages: roles must alternate") })

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
})
