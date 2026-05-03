import { describe, it, expect, vi, beforeEach } from "vitest"
import type { SessionEvent } from "@capybudget/intelligence"
import type { BudgetRepository, FileAdapter } from "@capybudget/persistence"

// ── SDK mock ───────────────────────────────────────────────────────
//
// `chat.completions.create({ stream: true, ... })` returns an
// async-iterable `Stream<ChatCompletionChunk>`. The mock below lets
// each test queue up a sequence of streamed turns: text deltas plus
// optional tool_call deltas (with arguments JSON sliced across many
// chunks to exercise the per-index accumulator), terminated with a
// `finish_reason`. Each call to `chat.completions.create` consumes
// one turn from the queue.
//
// A turn can also be queued with `error: true` to simulate an SDK
// rejection. `aborts: true` queues an AbortError thrown mid-iteration
// (used by the stop test).

interface FakeToolCallDelta {
  index: number
  id?: string
  name?: string
  /** Argument fragment(s) to emit, in order — the test simulates
   *  arguments JSON arriving sliced across chunks. */
  argFragments?: string[]
}

interface FakeTurn {
  textDeltas?: string[]
  toolCallDeltas?: FakeToolCallDelta[]
  finish_reason: "stop" | "tool_calls" | "length"
  /** If set, the create() call rejects with this error. */
  error?: Error
}

const { mockCreate, queueTurn, lastCreateCall, abortSignals } = vi.hoisted(
  () => {
    const queue: FakeTurn[] = []
    const calls: Array<{ messages: unknown; tools: unknown }> = []
    const signals: AbortSignal[] = []

    const create = vi.fn().mockImplementation(async (params, opts) => {
      calls.push({
        messages: JSON.parse(JSON.stringify(params.messages)),
        tools: params.tools,
      })
      if (opts?.signal) signals.push(opts.signal as AbortSignal)
      const turn = queue.shift()
      if (!turn) {
        throw new Error("Test bug: no turn queued for chat.completions.create()")
      }
      if (turn.error) throw turn.error

      const sig = opts?.signal as AbortSignal | undefined

      // Build the chunk sequence. Every fragment becomes its own chunk
      // so the per-index accumulator gets exercised. Final chunk
      // carries `finish_reason`.
      type Chunk = {
        choices: Array<{
          delta: {
            content?: string
            tool_calls?: Array<{
              index: number
              id?: string
              type?: "function"
              function?: { name?: string; arguments?: string }
            }>
          }
          finish_reason: string | null
          index: number
        }>
      }
      const chunks: Chunk[] = []
      if (turn.textDeltas) {
        for (const d of turn.textDeltas) {
          chunks.push({
            choices: [{ delta: { content: d }, finish_reason: null, index: 0 }],
          })
        }
      }
      if (turn.toolCallDeltas) {
        // First, a chunk for each tool call announcing id+name with
        // empty args (matches OpenAI's wire shape).
        for (const tc of turn.toolCallDeltas) {
          chunks.push({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: tc.index,
                      id: tc.id,
                      type: "function",
                      function: { name: tc.name, arguments: "" },
                    },
                  ],
                },
                finish_reason: null,
                index: 0,
              },
            ],
          })
        }
        // Then, one chunk per argument fragment per tool — the order
        // matches what OpenAI does in the wild (interleaved).
        const maxFrags = Math.max(
          0,
          ...turn.toolCallDeltas.map((t) => t.argFragments?.length ?? 0),
        )
        for (let i = 0; i < maxFrags; i++) {
          for (const tc of turn.toolCallDeltas) {
            const frag = tc.argFragments?.[i]
            if (frag === undefined) continue
            chunks.push({
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: tc.index,
                        function: { arguments: frag },
                      },
                    ],
                  },
                  finish_reason: null,
                  index: 0,
                },
              ],
            })
          }
        }
      }
      // Terminal chunk with finish_reason.
      chunks.push({
        choices: [{ delta: {}, finish_reason: turn.finish_reason, index: 0 }],
      })

      async function* iterate() {
        for (const chunk of chunks) {
          // Honor abort: if the signal is aborted, throw AbortError.
          if (sig?.aborted) {
            const err = new Error("Aborted")
            err.name = "AbortError"
            throw err
          }
          yield chunk
        }
      }
      return iterate()
    })

    function queueTurn(turn: FakeTurn) {
      queue.push(turn)
    }

    return {
      mockCreate: create,
      queueTurn,
      lastCreateCall: () => calls[calls.length - 1],
      abortSignals: signals,
    }
  },
)

vi.mock("openai", () => {
  return {
    default: class {
      chat = {
        completions: { create: mockCreate },
      }
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

import { OpenAiSession } from "./openai-session"

// ── Helpers ────────────────────────────────────────────────────────

function makeSession() {
  const events: SessionEvent[] = []
  const session = new OpenAiSession({
    budgetPath: "/budget",
    systemPrompt: "you are capy",
    apiKey: "sk-openai-test",
    model: "gpt-4o",
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
  mockCreate.mockClear()
  mockRunTool.mockReset()
  abortSignals.length = 0
})

// ── Tests ──────────────────────────────────────────────────────────

describe("OpenAiSession", () => {
  it("emits cumulative assistant text and a result line on a one-turn reply", async () => {
    queueTurn({
      textDeltas: ["Hello", ", world"],
      finish_reason: "stop",
    })

    const { session, events } = makeSession()
    await session.send("Hi")

    const lines = stdoutLines(events).map((l) => JSON.parse(l))
    const textLines = lines.filter((l) => l.type === "assistant")
    expect(textLines).toHaveLength(2)
    expect(textLines[0].message.content[0].text).toBe("Hello")
    expect(textLines[1].message.content[0].text).toBe("Hello, world")
    expect(lines[lines.length - 1]).toEqual({ type: "result" })
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

  it("dispatches a tool call (arguments arrive across many deltas), threads tool_call_id, and continues the loop", async () => {
    // Arguments split across many fragments to exercise the
    // per-index accumulator.
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
      expect.objectContaining({ budgetPath: "/budget" }),
    )

    // Second create() call: messages = system, user, assistant (with
    // tool_calls), tool (with tool_call_id).
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

    const lines = stdoutLines(events).map((l) => JSON.parse(l))
    expect(lines[lines.length - 1]).toEqual({ type: "result" })
  })

  it("accumulates tool arguments across multiple deltas before parsing", async () => {
    // Arguments split into many fragments — the test asserts that the
    // adapter sees the assembled JSON, not partial chunks.
    queueTurn({
      toolCallDeltas: [
        {
          index: 0,
          id: "call_xyz",
          name: "spending_summary",
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
    await session.send("Spending in Jan 2025?")
    expect(mockRunTool).toHaveBeenCalledWith(
      "spending_summary",
      { startDate: "2025-01-01" },
      expect.anything(),
    )
  })

  it("emits an error line when the SDK rejects", async () => {
    queueTurn({
      finish_reason: "stop",
      error: new Error("rate limited"),
    })

    const { session, events } = makeSession()
    await session.send("Hi")

    const lines = stdoutLines(events).map((l) => JSON.parse(l))
    const errorLine = lines.find((l) => l.type === "error")
    expect(errorLine).toEqual({ type: "error", error: { message: "rate limited" } })
    expect(lines.some((l) => l.type === "result")).toBe(false)
  })

  it("stop() drops a trailing assistant turn with unmatched tool_calls", async () => {
    // First turn: completes with a tool_call → loop pushes the
    // assistant turn (with tool_calls) into history. We then call
    // stop() *before* the next create() would happen — simulating an
    // abort mid-loop. The next send() should not carry the dangling
    // tool_call.
    queueTurn({
      toolCallDeltas: [
        {
          index: 0,
          id: "call_aaa",
          name: "list_accounts",
          argFragments: ["{", "}"],
        },
      ],
      finish_reason: "tool_calls",
    })
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

    queueTurn({ textDeltas: ["ok"], finish_reason: "stop" })
    await session.send("Hi again")
    const last = lastCreateCall()
    const messages = last.messages as Array<{
      role: string
      tool_calls?: Array<unknown>
    }>
    // No assistant turn carrying tool_calls should survive.
    expect(
      messages.some((m) => m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0),
    ).toBe(false)
  })

  it("kill() flips isAlive false and aborts in-flight requests", async () => {
    queueTurn({
      textDeltas: ["typing"],
      finish_reason: "stop",
    })
    const { session } = makeSession()
    await session.send("Hi")
    expect(session.isAlive).toBe(true)
    await session.kill()
    expect(session.isAlive).toBe(false)
  })
})
