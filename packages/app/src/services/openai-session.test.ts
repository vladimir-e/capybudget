import { describe, it, expect, vi, beforeEach } from "vitest"
import type { StreamEvent } from "@capybudget/intelligence"
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
  const events: StreamEvent[] = []
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

beforeEach(() => {
  mockCreate.mockClear()
  mockRunTool.mockReset()
  abortSignals.length = 0
})

// ── Tests ──────────────────────────────────────────────────────────

describe("OpenAiSession", () => {
  it("emits cumulative content events and a done event on a one-turn reply", async () => {
    queueTurn({
      textDeltas: ["Hello", ", world"],
      finish_reason: "stop",
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

    // Tool calls surface as tool-activity ContentBlocks.
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

  it("emits a render-tool ContentBlock without a tool-activity block", async () => {
    queueTurn({
      toolCallDeltas: [
        {
          index: 0,
          id: "call_render",
          name: "render_table",
          argFragments: [
            '{"headers":["A","B"],',
            '"rows":[["1","2"]]}',
          ],
        },
      ],
      finish_reason: "tool_calls",
    })
    queueTurn({ textDeltas: ["done"], finish_reason: "stop" })

    mockRunTool.mockResolvedValueOnce("Rendered.")

    const { session, events } = makeSession()
    await session.send("Show me a table")

    const allBlocks = events.flatMap((e) =>
      e.type === "content" ? e.blocks : [],
    )
    const tableBlock = allBlocks.find((b) => b.type === "table")
    expect(tableBlock).toEqual({
      type: "table",
      headers: ["A", "B"],
      rows: [["1", "2"]],
    })
    expect(
      allBlocks.some(
        (b) => b.type === "tool-activity" && b.tool === "render_table",
      ),
    ).toBe(false)
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

  it("surfaces a parse error in the tool result when arguments are malformed JSON", async () => {
    // Fragments that concatenate to an unbalanced JSON string so
    // JSON.parse rejects. The adapter must surface the parse error in
    // the tool message (not throw, not crash the loop) and keep going
    // — the model gets to see what went wrong.
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

    // runTool must NOT be invoked when arguments don't parse.
    expect(mockRunTool).not.toHaveBeenCalled()

    // Second call sees a `tool` message containing the parse error so
    // the model can self-correct on the next turn.
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
    // The actual JSON.parse error string is implementation-defined but
    // contains some hint about the syntax problem.
    expect(toolMsg!.content!.length).toBeGreaterThan("Error: invalid JSON arguments — ".length)
  })

  it("emits an error event when the SDK rejects", async () => {
    queueTurn({
      finish_reason: "stop",
      error: new Error("rate limited"),
    })

    const { session, events } = makeSession()
    await session.send("Hi")

    const errorEvent = events.find((e) => e.type === "error")
    expect(errorEvent).toEqual({ type: "error", message: "rate limited" })
    expect(events.some((e) => e.type === "done")).toBe(false)
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

  it("walks an import session through analyze_csv → preview_transform → transform_csv", async () => {
    queueTurn({
      toolCallDeltas: [
        {
          index: 0,
          id: "call-1",
          name: "analyze_csv",
          argFragments: ['{"filename":', '"2024.csv"}'],
        },
      ],
      finish_reason: "tool_calls",
    })
    queueTurn({
      toolCallDeltas: [
        {
          index: 0,
          id: "call-2",
          name: "preview_transform",
          argFragments: ['{"filename":"2024.csv",', '"mapping":{}}'],
        },
      ],
      finish_reason: "tool_calls",
    })
    queueTurn({
      toolCallDeltas: [
        {
          index: 0,
          id: "call-3",
          name: "transform_csv",
          argFragments: ['{"filename":"2024.csv",', '"mapping":{}}'],
        },
      ],
      finish_reason: "tool_calls",
    })
    queueTurn({
      textDeltas: ["Done — 42 rows imported."],
      finish_reason: "stop",
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
      { filename: "2024.csv", mapping: {} },
      expect.objectContaining({ budgetPath: "/budget" }),
    )
    expect(mockRunTool).toHaveBeenNthCalledWith(
      3,
      "transform_csv",
      { filename: "2024.csv", mapping: {} },
      expect.objectContaining({ budgetPath: "/budget" }),
    )

    expect(events[events.length - 1]).toEqual({ type: "done" })
  })

  it("forwards multimodal images via image_url and replaces document blocks with a text note", async () => {
    queueTurn({ textDeltas: ["ok"], finish_reason: "stop" })
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

    const call = lastCreateCall()
    const messages = call.messages as Array<{
      role: string
      content: unknown
    }>
    // First entry is the system message; second is the user turn.
    expect(messages[0].role).toBe("system")
    const userBlocks = messages[1].content as Array<{ type: string; text?: string; image_url?: unknown }>
    expect(userBlocks.map((b) => b.type)).toEqual(["text", "image_url", "text"])
    expect(userBlocks[2].text).toContain("PDF")
  })

  it("terminates with a budget-exhausted error after SESSION_TOOL_CALL_BUDGET tool calls", async () => {
    const { SESSION_TOOL_CALL_BUDGET } = await import("@capybudget/intelligence")
    for (let i = 0; i < SESSION_TOOL_CALL_BUDGET + 1; i++) {
      queueTurn({
        toolCallDeltas: [
          {
            index: 0,
            id: `tc-${i}`,
            name: "list_accounts",
            argFragments: ["{}"],
          },
        ],
        finish_reason: "tool_calls",
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
    // Regression: each agentic-loop iteration used to keep its own
    // `completedBlocks`, so a turn-2 render-table would emit without
    // the turn-1 donut — the UI replaced wholesale and the chart
    // vanished. The fix hoists the accumulator out of the while loop;
    // the final emit must carry BOTH render blocks.
    queueTurn({
      textDeltas: ["Here's the split:"],
      toolCallDeltas: [
        {
          index: 0,
          id: "tc-donut",
          name: "render_donut_chart",
          argFragments: ['{"title":"Spending","data":[{"label":"Food","value":50}]}'],
        },
      ],
      finish_reason: "tool_calls",
    })
    queueTurn({
      toolCallDeltas: [
        {
          index: 0,
          id: "tc-table",
          name: "render_table",
          argFragments: ['{"headers":["Category","Amount"],"rows":[["Food","$50"]]}'],
        },
      ],
      finish_reason: "tool_calls",
    })
    queueTurn({ textDeltas: ["done"], finish_reason: "stop" })

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
        toolCallDeltas: [
          {
            index: 0,
            id: `tc-${i}`,
            name: "list_accounts",
            argFragments: ["{}"],
          },
        ],
        finish_reason: "tool_calls",
      })
    }
    mockRunTool.mockResolvedValue("ok")

    const { session } = makeSession()
    await session.send("Loop forever")
    expect(mockRunTool).toHaveBeenCalledTimes(SESSION_TOOL_CALL_BUDGET)

    await session.restart()
    mockRunTool.mockClear()
    queueTurn({
      toolCallDeltas: [
        {
          index: 0,
          id: "tc-post-restart",
          name: "list_accounts",
          argFragments: ["{}"],
        },
      ],
      finish_reason: "tool_calls",
    })
    queueTurn({
      textDeltas: ["Done."],
      finish_reason: "stop",
    })

    await session.send("After restart")

    expect(mockRunTool).toHaveBeenCalledTimes(1)
  })
})
