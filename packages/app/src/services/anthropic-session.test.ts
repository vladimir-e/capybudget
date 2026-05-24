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
  const calls: Array<{ messages: unknown; tools: unknown }> = []
  const signals: AbortSignal[] = []
  const stubs: Array<{ controller: AbortController; abortSpy: ReturnType<typeof vi.fn> }> = []

  const stream = vi.fn().mockImplementation((params, opts) => {
    calls.push({
      messages: JSON.parse(JSON.stringify(params.messages)),
      tools: params.tools,
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

vi.mock("@capybudget/intelligence", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>
  return {
    ...original,
    runTool: mockRunTool,
  }
})

import { AnthropicSession } from "./anthropic-session"

function makeSession() {
  const events: StreamEvent[] = []
  const session = new AnthropicSession({
    budgetPath: "/budget",
    systemPrompt: "you are capy",
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
    expect(errorEvent).toEqual({ type: "error", message: "rate limited" })
    expect(events.some((e) => e.type === "done")).toBe(false)
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
          name: "render_donut_chart",
          input: {
            title: "Spending",
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
})
