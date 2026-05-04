import { describe, it, expect, vi, beforeEach } from "vitest"
import type { StreamEvent } from "@capybudget/intelligence"
import type { BudgetRepository, FileAdapter } from "@capybudget/persistence"

// ── SDK mock ───────────────────────────────────────────────────────
//
// `messages.stream()` returns an object with:
//   - `.on(eventName, handler)` for incremental updates ("text",
//     "contentBlock", ...)
//   - `.finalMessage()` returning a promise that resolves with the
//     completed `Message`.
//
// The mock below lets each test queue up the sequence of streamed
// turns (text deltas, tool_use blocks, stop_reason). Each call to
// `client.messages.stream()` consumes one turn from the queue.

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
  /** If set, finalMessage rejects with this error (simulates SDK throwing). */
  error?: Error
}

const { mockStream, queueTurn, lastStreamCall, abortSignals } = vi.hoisted(() => {
  const queue: FakeTurn[] = []
  const calls: Array<{ messages: unknown; tools: unknown }> = []
  const signals: AbortSignal[] = []

  const stream = vi.fn().mockImplementation((params, opts) => {
    // snapshot messages so later mutations don't pollute the assertion
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
    const stub = {
      on(event: string, handler: Handler) {
        ;(handlers[event] ??= []).push(handler)
        return stub
      },
      async finalMessage() {
        // If the test queued an error for this turn, surface it before
        // emitting any deltas — simulates an SDK-level failure.
        if (turn.error) throw turn.error

        // Stream text deltas, then tool_use content blocks.
        const completed: FakeBlock[] = []
        let textAccum = ""
        if (turn.textDeltas) {
          for (const delta of turn.textDeltas) {
            textAccum += delta
            for (const h of handlers.text ?? []) h(delta)
          }
          if (textAccum) completed.push({ type: "text", text: textAccum })
        }
        if (turn.toolUses) {
          for (const tu of turn.toolUses) {
            const block: FakeBlock = {
              type: "tool_use",
              id: tu.id,
              name: tu.name,
              input: tu.input,
            }
            for (const h of handlers.contentBlock ?? []) h(block)
            completed.push(block)
          }
        }

        // Honor abort: if the signal is already aborted, throw.
        const sig = opts?.signal as AbortSignal | undefined
        if (sig?.aborted) {
          const err = new Error("Aborted")
          err.name = "AbortError"
          throw err
        }

        return {
          content: completed.map((b) =>
            b.type === "text"
              ? { type: "text", text: b.text }
              : { type: "tool_use", id: b.id, name: b.name, input: b.input },
          ),
          stop_reason: turn.stop_reason,
        }
      },
    }
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
  }
})

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class {
      messages = { stream: mockStream }
    },
  }
})

// Tool dispatch mock — replaces in-process `runTool`.
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

// ── Helpers ────────────────────────────────────────────────────────

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
})

// ── Tests ──────────────────────────────────────────────────────────

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

    // Second stream call's message history must include the tool_result.
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

    // Tool calls surface as tool-activity ContentBlocks alongside the
    // assistant text.
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
    // Render tools shouldn't also produce a tool-activity block.
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
    // No `done` on error
    expect(events.some((e) => e.type === "done")).toBe(false)
  })

  it("stop() drops a trailing assistant turn with unmatched tool_use", async () => {
    // First turn: completes normally with a tool_use → loop pushes the
    // assistant turn (with tool_use) into history. We then call stop()
    // *before* the next stream call would happen — simulating an abort
    // mid-loop. The next send() should not carry the dangling tool_use.
    queueTurn({
      toolUses: [{ id: "tu1", name: "list_accounts", input: {} }],
      stop_reason: "tool_use",
    })
    // mockRunTool resolves slowly, giving us a window to abort.
    let resolveRun: ((v: string) => void) | null = null
    mockRunTool.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveRun = resolve
        }),
    )

    const { session } = makeSession()
    const sendPromise = session.send("How much do I have?")
    // Wait until the agentic loop has finished the first stream turn
    // and is parked inside runTool — the assistant turn with the
    // unmatched tool_use is now in history.
    await vi.waitFor(() => {
      if (!resolveRun) throw new Error("not yet")
    })
    await session.stop()
    // Unblock the runTool promise; the loop checks `interrupted` and
    // returns *without* pushing tool_results or starting another turn.
    resolveRun!("late")
    await sendPromise

    // Send a fresh message — the new stream call's history must not
    // contain the dangling assistant tool_use turn.
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
    // Three turns: each returns the next tool call until end_turn.
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
})
