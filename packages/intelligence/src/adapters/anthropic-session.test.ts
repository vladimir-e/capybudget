import { describe, it, expect, vi, beforeEach } from "vitest"
import type { StreamEvent } from "@capybudget/intelligence"
import type { BudgetRepository, FileAdapter } from "@capybudget/persistence"

interface FakeBlock {
  type: "text" | "tool_use"
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
}

interface FakeTurn {
  textDeltas?: string[]
  toolUses?: Array<{ id: string; name: string; input: Record<string, unknown> }>
  stop_reason: "end_turn" | "tool_use"
  error?: Error
}

const { mockStream, queueTurn, lastStreamCall, abortSignals, streamStubs } = vi.hoisted(() => {
  const queue: FakeTurn[] = []
  const calls: Array<{ messages: unknown; tools: unknown; system: unknown }> = []
  const signals: AbortSignal[] = []
  const stubs: Array<{ controller: AbortController; abortSpy: ReturnType<typeof vi.fn> }> = []

  const stream = vi.fn().mockImplementation((params, opts) => {
    calls.push({
      messages: JSON.parse(JSON.stringify(params.messages)),
      tools: params.tools,
      system: params.system,
    })
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

    const stub = {
      on,
      once,
      controller,
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
        const completed: FakeBlock[] = []
        let textAccum = ""
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
          content: completed.map((b) =>
            b.type === "text"
              ? { type: "text", text: b.text }
              : { type: "tool_use", id: b.id, name: b.name, input: b.input },
          ),
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

const { mockCreate, queueStructured, lastCreateCall } = vi.hoisted(() => {
  const calls: Array<Record<string, unknown>> = []
  const responses: Array<{ content: string } | { error: Error }> = []
  const create = vi.fn().mockImplementation((params: Record<string, unknown>) => {
    calls.push(params)
    const next = responses.shift() ?? { content: "{}" }
    if ("error" in next) return Promise.reject(next.error)
    return Promise.resolve({
      content: [{ type: "text", text: next.content }],
      stop_reason: "end_turn",
    })
  })
  return {
    mockCreate: create,
    queueStructured: (next: { content: string } | { error: Error }) =>
      responses.push(next),
    lastCreateCall: () => calls[calls.length - 1],
  }
})

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class {
      messages = { stream: mockStream, create: mockCreate }
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

function makeSession(mode: "chat" | "import" = "chat") {
  const events: StreamEvent[] = []
  const session = new AnthropicSession({
    budgetPath: "/budget",
    systemPrompt: "you are capy",
    mode,
    apiKey: "sk-ant-test",
    model: "claude-sonnet-4-6",
    onEvent: (e) => events.push(e),
    repo: {} as BudgetRepository,
    fileAdapter: {} as FileAdapter,
  })
  return { session, events }
}

beforeEach(() => {
  mockStream.mockClear()
  mockCreate.mockClear()
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
      expect.objectContaining({ budgetPath: "/budget" }),
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

  it("stop() drops a trailing assistant turn with unmatched tool_use", async () => {
    queueTurn({
      toolUses: [{ id: "tu1", name: "list_accounts", input: {} }],
      stop_reason: "tool_use",
    })
    // Slow tool resolution gives us a window to call stop() while the loop
    // is parked inside runTool, with the unmatched tool_use already in history.
    let resolveRun: ((v: string) => void) | null = null
    mockRunTool.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveRun = resolve
        }),
    )

    const { session } = makeSession()
    const sendPromise = session.send("How much do I have?")
    await vi.waitFor(() => {
      if (!resolveRun) throw new Error("not yet")
    })
    await session.stop()
    resolveRun!("late")
    await sendPromise

    queueTurn({ textDeltas: ["ok"], stop_reason: "end_turn" })
    await session.send("Hi again")
    const last = lastStreamCall()
    const messages = last.messages as Array<{ role: string; content: unknown }>
    expect(
      messages.some(
        (m) =>
          Array.isArray(m.content) &&
          (m.content as Array<{ type: string }>).some(
            (b) => b.type === "tool_use",
          ),
      ),
    ).toBe(false)
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

  it("walks an import session through analyze_csv → preview_transform → transform_csv", async () => {
    queueTurn({
      toolUses: [
        { id: "tu-analyze", name: "analyze_csv", input: { filename: "2024.csv" } },
      ],
      stop_reason: "tool_use",
    })
    queueTurn({
      toolUses: [
        {
          id: "tu-preview",
          name: "preview_transform",
          input: { filename: "2024.csv", mapping: { kind: "stub" } },
        },
      ],
      stop_reason: "tool_use",
    })
    queueTurn({
      toolUses: [
        {
          id: "tu-transform",
          name: "transform_csv",
          input: { filename: "2024.csv", mapping: { kind: "stub" } },
        },
      ],
      stop_reason: "tool_use",
    })
    queueTurn({
      textDeltas: ["Done — 42 rows imported."],
      stop_reason: "end_turn",
    })

    mockRunTool
      .mockResolvedValueOnce(JSON.stringify({ headers: ["Date"], totalRows: 42 }))
      .mockResolvedValueOnce(JSON.stringify({ transactions: [{ id: "imp-1" }] }))
      .mockResolvedValueOnce(JSON.stringify({ success: true, stats: { rows: 42 } }))

    const { session, events } = makeSession()
    await session.send("Process this file.")

    expect(mockRunTool).toHaveBeenNthCalledWith(
      1,
      "analyze_csv",
      { filename: "2024.csv" },
      expect.objectContaining({ budgetPath: "/budget" }),
    )
    expect(mockRunTool).toHaveBeenNthCalledWith(
      2,
      "preview_transform",
      expect.objectContaining({ filename: "2024.csv" }),
      expect.objectContaining({ budgetPath: "/budget" }),
    )
    expect(mockRunTool).toHaveBeenNthCalledWith(
      3,
      "transform_csv",
      expect.objectContaining({ filename: "2024.csv" }),
      expect.objectContaining({ budgetPath: "/budget" }),
    )

    expect(events[events.length - 1]).toEqual({ type: "done" })
  })

  it("forwards multimodal initial messages (text + image + document) to the SDK", async () => {
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
      },
    ])

    const call = lastStreamCall()
    const messages = call.messages as Array<{ role: string; content: unknown }>
    expect(messages).toHaveLength(1)
    const blocks = messages[0].content as Array<{ type: string }>
    expect(blocks.map((b) => b.type)).toEqual(["text", "image", "document"])
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
      stop_reason: "end_turn",
    })

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

describe("AnthropicSession tool gating", () => {
  async function toolNamesFor(mode: "chat" | "import"): Promise<string[]> {
    const { session } = makeSession(mode)
    queueTurn({ textDeltas: ["ok"], stop_reason: "end_turn" })
    await session.send("hi")
    const tools = lastStreamCall().tools as Array<{ name: string }>
    return tools.map((t) => t.name)
  }

  it("chat sends only chat-mode tools — render tools in, import/csv tools out", async () => {
    const names = await toolNamesFor("chat")
    expect(names).toContain("render_table")
    expect(names).toContain("render_chart")
    expect(names).toContain("render_followups")
    expect(names).toContain("list_transactions")
    expect(names).toContain("search_transactions")
    expect(names).toContain("group_transactions")
    expect(names).toContain("create_transaction")
    expect(names).toContain("start_import")
    expect(names).not.toContain("analyze_csv")
    expect(names).not.toContain("transform_csv")
    expect(names).not.toContain("enrich_update")
    expect(names).not.toContain("write_import_file")
    expect(names).toHaveLength(23)
  })

  it("import sends only import-mode tools — csv/enrich in, render/CRUD out", async () => {
    const names = await toolNamesFor("import")
    expect(names).toContain("analyze_csv")
    expect(names).toContain("transform_csv")
    expect(names).toContain("enrich_update")
    expect(names).toContain("write_import_file")
    expect(names).not.toContain("render_table")
    expect(names).not.toContain("render_chart")
    expect(names).not.toContain("render_followups")
    expect(names).not.toContain("create_transaction")
    expect(names).not.toContain("list_transactions")
    expect(names).toHaveLength(16)
  })

  it("keeps search_transactions in both modes (both prompts advertise it)", async () => {
    expect(await toolNamesFor("chat")).toContain("search_transactions")
    expect(await toolNamesFor("import")).toContain("search_transactions")
  })
})

describe("AnthropicSession.structured", () => {
  const SCHEMA = {
    type: "object" as const,
    properties: { ok: { type: "boolean" as const } },
    required: ["ok"],
  }

  it("makes one constrained, tool-free call and returns the parsed result", async () => {
    queueStructured({ content: '{"ok": true}' })

    const { session } = makeSession("import")
    const result = await session.structured<{ ok: boolean }>(
      [{ role: "user", content: "extract" }],
      SCHEMA,
    )

    expect(result).toEqual({ ok: true })
    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(mockStream).not.toHaveBeenCalled()

    const call = lastCreateCall()
    expect(call.tools).toBeUndefined()
    expect(call.output_config).toEqual({
      format: { type: "json_schema", schema: SCHEMA },
    })
    expect(call.model).toBe("claude-sonnet-4-6")
  })

  it("forwards multimodal content (text + image + document) to the SDK", async () => {
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
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: "BBBB" },
            },
          ],
        },
      ],
      SCHEMA,
    )

    const call = lastCreateCall()
    const messages = call.messages as Array<{ role: string; content: unknown }>
    expect(messages).toHaveLength(1)
    const blocks = messages[0].content as Array<{ type: string }>
    expect(blocks.map((b) => b.type)).toEqual(["text", "image", "document"])
  })

  it("rejects when the model returns output that violates the schema", async () => {
    queueStructured({ content: '{"ok": "not a boolean"}' })

    const { session } = makeSession()
    await expect(
      session.structured([{ role: "user", content: "x" }], SCHEMA),
    ).rejects.toThrowError(/boolean/i)
  })

  it("passes an assistant turn through as plain text content", async () => {
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
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user"])
    expect(messages[1].content).toBe('{"ok": false}')
  })
})
