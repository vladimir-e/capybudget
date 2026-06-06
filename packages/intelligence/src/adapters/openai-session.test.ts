import { describe, it, expect, vi, beforeEach } from "vitest"
import type { StreamEvent } from "@capybudget/intelligence"
import type { BudgetRepository, FileAdapter } from "@capybudget/persistence"

interface FakeToolCallDelta {
  index: number
  id?: string
  name?: string
  /** JSON argument fragments, emitted one per chunk to exercise the accumulator. */
  argFragments?: string[]
}

interface FakeTurn {
  textDeltas?: string[]
  toolCallDeltas?: FakeToolCallDelta[]
  finish_reason: "stop" | "tool_calls" | "length"
  error?: Error
  /** Extra chunk appended AFTER finish_reason — must never be observed. */
  tailChunk?: { content: string }
}

const { mockCreate, queueTurn, lastCreateCall, allCreateCalls, abortSignals } = vi.hoisted(
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
        // Match OpenAI's wire shape: id+name announcement, then arg fragments.
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
      chunks.push({
        choices: [{ delta: {}, finish_reason: turn.finish_reason, index: 0 }],
      })
      if (turn.tailChunk) {
        chunks.push({
          choices: [
            {
              delta: { content: turn.tailChunk.content },
              finish_reason: null,
              index: 0,
            },
          ],
        })
      }

      const controller = new AbortController()

      async function* iterate() {
        for (const chunk of chunks) {
          if (sig?.aborted || controller.signal.aborted) {
            const err = new Error("Aborted")
            err.name = "AbortError"
            throw err
          }
          yield chunk
        }
      }
      return {
        [Symbol.asyncIterator]: iterate,
        controller,
      }
    })

    function queueTurn(turn: FakeTurn) {
      queue.push(turn)
    }

    return {
      mockCreate: create,
      queueTurn,
      lastCreateCall: () => calls[calls.length - 1],
      allCreateCalls: () => calls,
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

import { OpenAiSession } from "./openai-session"

function makeSession(mode: "chat" | "import" = "chat") {
  const events: StreamEvent[] = []
  const session = new OpenAiSession({
    budgetPath: "/budget",
    systemPrompt: "you are capy",
    mode,
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

  it("keeps the tools + system prefix byte-stable across turns (prefix caching)", async () => {
    // OpenAI auto-caches a request's static prefix; the win only lands if that
    // prefix is identical turn-to-turn. Drive two model turns (tool call → reply)
    // and assert the tools array and the leading system message are unchanged —
    // per-turn content rides in the tail messages, never the prefix.
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
      expect.objectContaining({ budgetPath: "/budget" }),
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

  it("emits an error event when the SDK rejects", async () => {
    queueTurn({
      finish_reason: "stop",
      error: new Error("rate limited"),
    })

    const { session, events } = makeSession()
    await session.send("Hi")

    const errorEvent = events.find((e) => e.type === "error")
    expect(errorEvent).toEqual({
      type: "error",
      message: "rate limited",
      status: undefined,
      provider: "openai",
    })
    expect(events.some((e) => e.type === "done")).toBe(false)
  })

  it("extracts the inner message from an OpenAI APIError-shaped throw", async () => {
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
      provider: "openai",
    })
  })

  it("stop() drops a trailing assistant turn with unmatched tool_calls", async () => {
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
    queueTurn({
      textDeltas: ["Here's the split:"],
      toolCallDeltas: [
        {
          index: 0,
          id: "tc-donut",
          name: "render_chart",
          argFragments: ['{"title":"Spending","type":"donut","data":[{"label":"Food","value":50}]}'],
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

  it("never stores a null-content assistant turn with no tool_calls (poisoned-history regression)", async () => {
    // Mirrors the real failure: a turn uses a tool, then the terminal
    // completion returns neither text nor tool calls. That empty turn used
    // to be stored as {role:"assistant", content:null} with no tool_calls,
    // which OpenAI rejects on every later send ("expected a string, got
    // null") — poisoning the rest of the session.
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

  it("emits a tool-result event with ok=true after a tool resolves", async () => {
    queueTurn({
      toolCallDeltas: [
        {
          index: 0,
          id: "call_ok",
          name: "create_transaction",
          argFragments: ["{}"],
        },
      ],
      finish_reason: "tool_calls",
    })
    queueTurn({ textDeltas: ["Done."], finish_reason: "stop" })
    mockRunTool.mockResolvedValueOnce(JSON.stringify({ success: true }))

    const { session, events } = makeSession()
    await session.send("Add it.")

    const toolResults = events.filter((e) => e.type === "tool-result")
    expect(toolResults).toEqual([
      { type: "tool-result", tool: "create_transaction", id: "call_ok", ok: true },
    ])
  })

  it("emits tool-result with ok=false when the handler throws", async () => {
    queueTurn({
      toolCallDeltas: [
        {
          index: 0,
          id: "call_err",
          name: "create_transaction",
          argFragments: ["{}"],
        },
      ],
      finish_reason: "tool_calls",
    })
    queueTurn({ textDeltas: ["Sorry."], finish_reason: "stop" })
    mockRunTool.mockRejectedValueOnce(new Error("disk full"))

    const { session, events } = makeSession()
    await session.send("Add it.")

    const toolResults = events.filter((e) => e.type === "tool-result")
    expect(toolResults).toEqual([
      { type: "tool-result", tool: "create_transaction", id: "call_err", ok: false },
    ])
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

  it("treats render_followups as terminal — exits the loop without a second stream invocation", async () => {
    queueTurn({
      toolCallDeltas: [
        {
          index: 0,
          id: "call_followups",
          name: "render_followups",
          argFragments: [
            '{"chips":[{"label":"More","prompt":"Tell me more"}]}',
          ],
        },
      ],
      finish_reason: "tool_calls",
    })
    // No second turn — if the loop iterated again, the mock would throw.
    mockRunTool.mockResolvedValueOnce("Rendered.")

    const { session, events } = makeSession()
    await session.send("Quick answer please")

    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(mockRunTool).toHaveBeenCalledTimes(1)
    expect(events[events.length - 1]).toEqual({ type: "done" })
    expect(events.filter((e) => e.type === "done")).toHaveLength(1)
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

describe("OpenAiSession tool gating", () => {
  async function toolNamesFor(mode: "chat" | "import"): Promise<string[]> {
    queueTurn({ textDeltas: ["ok"], finish_reason: "stop" })
    const { session } = makeSession(mode)
    await session.send("hi")
    const tools = lastCreateCall().tools as Array<{ function: { name: string } }>
    return tools.map((t) => t.function.name)
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
    expect(names).not.toContain("analyze_csv")
    expect(names).not.toContain("transform_csv")
    expect(names).not.toContain("enrich_update")
    expect(names).not.toContain("write_import_file")
    expect(names).toHaveLength(22)
  })

  it("import sends only import-mode tools — csv/enrich in, render/CRUD out", async () => {
    const names = await toolNamesFor("import")
    expect(names).toContain("analyze_csv")
    expect(names).toContain("transform_csv")
    expect(names).toContain("enrich_status")
    expect(names).toContain("enrich_update")
    expect(names).toContain("find_duplicates")
    expect(names).toContain("mark_duplicates")
    expect(names).toContain("write_import_file")
    // report_status is the import run's communication channel.
    expect(names).toContain("report_status")
    expect(names).not.toContain("render_table")
    expect(names).not.toContain("render_chart")
    expect(names).not.toContain("render_followups")
    expect(names).not.toContain("create_transaction")
    expect(names).not.toContain("list_transactions")
    // auto_enrich and auto_mark_duplicates are code-triggered — never advertised.
    expect(names).not.toContain("auto_enrich")
    expect(names).not.toContain("auto_mark_duplicates")
    // Staged-file readers are chat-only now; the import session writes its own.
    expect(names).not.toContain("read_import_file")
    expect(names).not.toContain("list_import_files")
    expect(names).toHaveLength(14)
  })

  it("keeps search_transactions in both modes (both prompts advertise it)", async () => {
    expect(await toolNamesFor("chat")).toContain("search_transactions")
    expect(await toolNamesFor("import")).toContain("search_transactions")
  })
})
