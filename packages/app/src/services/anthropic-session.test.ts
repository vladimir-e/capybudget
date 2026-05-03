import { describe, it, expect, vi, beforeEach } from "vitest"
import type { SessionEvent } from "@capybudget/intelligence"
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
  const events: SessionEvent[] = []
  const session = new AnthropicSession({
    budgetPath: "/budget",
    systemPrompt: "you are capy",
    apiKey: "sk-ant-test",
    model: "claude-sonnet-4-5",
    onEvent: (e) => events.push(e),
    repo: {} as BudgetRepository,
    fileAdapter: {} as FileAdapter,
  })
  return { session, events }
}

function stdoutLines(events: SessionEvent[]): string[] {
  return events.flatMap((e) => (e.type === "stdout" ? [e.line] : []))
}

beforeEach(() => {
  mockStream.mockClear()
  mockRunTool.mockReset()
  abortSignals.length = 0
})

// ── Tests ──────────────────────────────────────────────────────────

describe("AnthropicSession", () => {
  it("emits cumulative assistant text and a result line on a one-turn reply", async () => {
    queueTurn({
      textDeltas: ["Hello", ", world"],
      stop_reason: "end_turn",
    })

    const { session, events } = makeSession()
    await session.send("Hi")

    const lines = stdoutLines(events).map((l) => JSON.parse(l))
    // assistant lines should carry cumulative text
    const textLines = lines.filter((l) => l.type === "assistant")
    expect(textLines).toHaveLength(2)
    expect(textLines[0].message.content[0].text).toBe("Hello")
    expect(textLines[1].message.content[0].text).toBe("Hello, world")
    // last line is the result
    expect(lines[lines.length - 1]).toEqual({ type: "result" })
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

    // Final result line
    const lines = stdoutLines(events).map((l) => JSON.parse(l))
    expect(lines[lines.length - 1]).toEqual({ type: "result" })
  })

  it("emits an error line when the SDK throws", async () => {
    queueTurn({
      stop_reason: "end_turn",
      error: new Error("rate limited"),
    })

    const { session, events } = makeSession()
    await session.send("Hi")

    const lines = stdoutLines(events).map((l) => JSON.parse(l))
    const errorLine = lines.find((l) => l.type === "error")
    expect(errorLine).toEqual({ type: "error", error: { message: "rate limited" } })
    // No `result` line on error
    expect(lines.some((l) => l.type === "result")).toBe(false)
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
})
