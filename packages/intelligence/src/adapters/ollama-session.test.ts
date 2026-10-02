import { describe, it, expect, vi, beforeEach } from "vitest"
import type { StreamEvent } from "@capybudget/intelligence"
import type { CurrencySettings } from "@capybudget/core"
import type { BudgetRepository, FileAdapter } from "@capybudget/persistence"
import { getToolDefinitions } from "../tools"

interface FakeToolCallDelta {
  /** Omitted to mimic Ollama's /v1 stream. */
  index?: number
  id?: string
  name?: string
  /** Sent whole in the announcement chunk, as Ollama does. */
  arguments?: string
  /** JSON argument fragments, emitted one per chunk to exercise the accumulator. */
  argFragments?: string[]
}

interface FakeTurn {
  textDeltas?: string[]
  refusalDeltas?: string[]
  toolCallDeltas?: FakeToolCallDelta[]
  /** Null ends the stream without a finish chunk. */
  finish_reason: "stop" | "tool_calls" | "length" | "content_filter" | null
  error?: Error
  /** Fails the stream with this error after its content chunks. */
  failAfter?: Error
  /** Extra chunk appended AFTER finish_reason — must never be observed. */
  tailChunk?: { content: string }
}

interface StructuredReply {
  content: string
  finish_reason?: string
  refusal?: string
}

const { mockCreate, queueTurn, queueStructured, lastCreateCall, allCreateCalls, abortSignals, streams } = vi.hoisted(
  () => {
    const queue: FakeTurn[] = []
    const streamList: Array<{ controller: AbortController; drained: boolean }> = []
    const calls: Array<{
      messages: unknown
      tools: unknown
      response_format?: unknown
      max_completion_tokens?: number
    }> = []
    const signals: AbortSignal[] = []

    // Non-streaming completions for the structured() path, keyed off the
    // absence of `stream: true`. Kept separate from the streaming turn queue
    // so the two request shapes don't share state.
    const structuredQueue: Array<StructuredReply | { error: Error }> = []

    const create = vi.fn().mockImplementation(async (params, opts) => {
      if (!params.stream) {
        calls.push({
          messages: JSON.parse(JSON.stringify(params.messages)),
          tools: params.tools,
          response_format: params.response_format,
          max_completion_tokens: params.max_completion_tokens,
        })
        const next = structuredQueue.shift()
        if (!next) {
          throw new Error("Test bug: no structured completion queued")
        }
        if ("error" in next) throw next.error
        return {
          choices: [
            {
              message: { role: "assistant", content: next.content, refusal: next.refusal ?? null },
              finish_reason: next.finish_reason ?? "stop",
            },
          ],
        }
      }
      calls.push({
        messages: JSON.parse(JSON.stringify(params.messages)),
        tools: params.tools,
        max_completion_tokens: params.max_completion_tokens,
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
            refusal?: string | null
            tool_calls?: Array<{
              index?: number
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
      for (const r of turn.refusalDeltas ?? []) {
        chunks.push({
          choices: [{ delta: { refusal: r }, finish_reason: null, index: 0 }],
        })
      }
      if (turn.toolCallDeltas) {
        // Chat Completions wire shape: id+name announcement, then arg fragments.
        for (const tc of turn.toolCallDeltas) {
          chunks.push({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      ...(tc.index === undefined ? {} : { index: tc.index }),
                      id: tc.id,
                      type: "function",
                      function: { name: tc.name, arguments: tc.arguments ?? "" },
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
                        ...(tc.index === undefined ? {} : { index: tc.index }),
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
      if (turn.finish_reason) {
        chunks.push({
          choices: [{ delta: {}, finish_reason: turn.finish_reason, index: 0 }],
        })
      }
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
      const record = { controller, drained: false }
      const failAfter = turn.failAfter
      streamList.push(record)

      // Mirrors the SDK: leaving the iterator before the end aborts the request.
      async function* iterate() {
        try {
          for (const chunk of chunks) {
            if (sig?.aborted || controller.signal.aborted) {
              const err = new Error("Aborted")
              err.name = "AbortError"
              throw err
            }
            yield chunk
          }
          if (failAfter) throw failAfter
          record.drained = true
        } finally {
          if (!record.drained) controller.abort()
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

    function queueStructured(next: StructuredReply | { error: Error }) {
      structuredQueue.push(next)
    }

    return {
      mockCreate: create,
      queueTurn,
      queueStructured,
      lastCreateCall: () => calls[calls.length - 1],
      allCreateCalls: () => calls,
      abortSignals: signals,
      streams: streamList,
    }
  },
)

const { clientConfigs } = vi.hoisted(() => ({
  clientConfigs: [] as Array<{ apiKey: string; baseURL?: string }>,
}))

vi.mock("openai", () => {
  return {
    default: class {
      chat = {
        completions: { create: mockCreate },
      }
      constructor(config: { apiKey: string; baseURL?: string }) {
        clientConfigs.push(config)
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

import { OllamaSession } from "./ollama-session"
import { MAX_OUTPUT_TOKENS, STOPPED_MARKER, STOPPED_RESULT, UNANSWERED_RESULT } from "./agent-turn"
import { CutOffError, RefusedError } from "../structured"

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

beforeEach(() => {
  mockCreate.mockClear()
  mockRunTool.mockReset()
  abortSignals.length = 0
  streams.length = 0
})

describe("OllamaSession", () => {
  it("points the client at the configured local endpoint", () => {
    clientConfigs.length = 0
    makeSession(undefined, "http://127.0.0.1:9999/v1")
    expect(clientConfigs).toEqual([{ apiKey: "ollama", baseURL: "http://127.0.0.1:9999/v1", dangerouslyAllowBrowser: true }])
  })

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

  it("reads currencies live at tool-run time, so a rate edit lands without a session rebuild", async () => {
    // Mirrors the Anthropic adapter: the live `getCurrencies` getter wins over
    // the construction-time snapshot, so a manual rate edit reaches the next
    // tool call without rebuilding the session.
    const liveCurrencies: { ref: Record<string, CurrencySettings> } = {
      ref: { USD: { decimals: 2, symbolPosition: "before" } },
    }

    queueTurn({
      toolCallDeltas: [
        { index: 0, id: "call_1", name: "create_transaction", argFragments: ["{}"] },
      ],
      finish_reason: "tool_calls",
    })
    queueTurn({ textDeltas: ["Added."], finish_reason: "stop" })
    mockRunTool.mockResolvedValueOnce(JSON.stringify({ success: true }))

    const events: StreamEvent[] = []
    const session = new OllamaSession({
      budgetPath: "/budget",
      systemPrompt: "you are capy",
      apiKey: "ollama",
      model: "qwen3",
      onEvent: (e) => events.push(e),
      repo: {} as BudgetRepository,
      fileAdapter: {} as FileAdapter,
      currency: "EUR",
      currencies: { EUR: { decimals: 2, symbolPosition: "before" } },
      getCurrencies: () => liveCurrencies.ref,
    })

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
      provider: "ollama",
    })
    expect(events.some((e) => e.type === "done")).toBe(false)
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

  it("stop() mid-batch finishes the running tool, runs no more, and keeps the round answered", async () => {
    queueTurn({
      toolCallDeltas: [
        { index: 0, id: "call_a", name: "create_transaction", argFragments: ["{}"] },
        { index: 1, id: "call_b", name: "create_transaction", argFragments: ["{}"] },
        { index: 2, id: "call_c", name: "create_transaction", argFragments: ["{}"] },
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

    queueTurn({ textDeltas: ["ok"], finish_reason: "stop" })
    await session.send("Hi again")
    const messages = lastCreateCall().messages as Array<Record<string, unknown>>
    expect(messages.slice(3)).toEqual([
      { role: "tool", tool_call_id: "call_a", content: "created a" },
      { role: "tool", tool_call_id: "call_b", content: STOPPED_RESULT },
      { role: "tool", tool_call_id: "call_c", content: STOPPED_RESULT },
      { role: "user", content: "Hi again" },
    ])
  })

  it("answers a trailing turn's unanswered tool calls before appending the next user message", async () => {
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

  it("streams the agent loop with the raised output cap", async () => {
    queueTurn({ textDeltas: ["ok"], finish_reason: "stop" })
    const { session } = makeSession()
    await session.send("Hi")
    expect(lastCreateCall().max_completion_tokens).toBe(MAX_OUTPUT_TOKENS)
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

  it("walks a multi-turn tool loop, threading each result back to the model", async () => {
    queueTurn({
      toolCallDeltas: [
        {
          index: 0,
          id: "call-1",
          name: "search_transactions",
          argFragments: ['{"query":', '"Apple"}'],
        },
      ],
      finish_reason: "tool_calls",
    })
    queueTurn({
      toolCallDeltas: [
        {
          index: 0,
          id: "call-2",
          name: "group_transactions",
          argFragments: ['{"groupBy":["merchant"],', '"metrics":["sum"]}'],
        },
      ],
      finish_reason: "tool_calls",
    })
    queueTurn({
      textDeltas: ["You spent $312 across 8 Apple charges."],
      finish_reason: "stop",
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
      { groupBy: ["merchant"], metrics: ["sum"] },
      expect.objectContaining({ budgetPath: "/budget" }),
    )

    expect(events[events.length - 1]).toEqual({ type: "done" })
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

  it("terminates with a budget-exhausted error after REPLY_TOOL_CALL_BUDGET tool calls", async () => {
    const { REPLY_TOOL_CALL_BUDGET } = await import("@capybudget/intelligence")
    for (let i = 0; i < REPLY_TOOL_CALL_BUDGET + 1; i++) {
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

    expect(mockRunTool).toHaveBeenCalledTimes(REPLY_TOOL_CALL_BUDGET)
    const errorEvent = events.find((e) => e.type === "error")
    expect(errorEvent).toMatchObject({ code: "budgetExhausted" })
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

  it("the next send starts with a fresh tool-call budget", async () => {
    const { REPLY_TOOL_CALL_BUDGET } = await import("@capybudget/intelligence")
    for (let i = 0; i < REPLY_TOOL_CALL_BUDGET + 1; i++) {
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
    expect(mockRunTool).toHaveBeenCalledTimes(REPLY_TOOL_CALL_BUDGET)

    mockRunTool.mockClear()
    queueTurn({
      toolCallDeltas: [
        {
          index: 0,
          id: "tc-next-send",
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

    await session.send("Keep going")

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

  it("continues the loop when render_followups fails validation, so the model can recover", async () => {
    queueTurn({
      toolCallDeltas: [
        {
          index: 0,
          id: "call_bad_followups",
          name: "render_followups",
          argFragments: ['{"chips":[]}'],
        },
      ],
      finish_reason: "tool_calls",
    })
    // The retry turn — if the failed call were treated as terminal, the loop
    // would exit without requesting it and the user would see nothing.
    queueTurn({ textDeltas: ["Here's a recap instead."], finish_reason: "stop" })
    mockRunTool.mockRejectedValueOnce(
      new Error("Invalid input: render_followups expects {chips: [{label, prompt}, ...]} with at least one chip. Nothing was rendered."),
    )

    const { session, events } = makeSession()
    await session.send("Quick answer please")

    expect(mockCreate).toHaveBeenCalledTimes(2)
    expect(events).toContainEqual({
      type: "tool-result",
      tool: "render_followups",
      id: "call_bad_followups",
      ok: false,
    })

    // The error tool message reached the model on the retry request.
    const second = lastCreateCall()
    const messages = second.messages as Array<{ role: string; content?: string }>
    const errorResultSent = messages.some(
      (m) => m.role === "tool" && m.content?.includes("Invalid input"),
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

describe("OllamaSession tool surface", () => {
  async function loopToolNames(): Promise<string[]> {
    queueTurn({ textDeltas: ["ok"], finish_reason: "stop" })
    const { session } = makeSession()
    await session.send("hi")
    const tools = lastCreateCall().tools as Array<{ function: { name: string } }>
    return tools.map((t) => t.function.name)
  }

  it("the agent loop sends the full tool surface, byte-identical to the MCP surface", async () => {
    const names = await loopToolNames()
    expect(new Set(names)).toEqual(new Set(getToolDefinitions().map((t) => t.name)))
    expect(names).toContain("render_table")
    expect(names).toContain("create_transaction")
    expect(names).toContain("start_import")
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

function apiError(status: number, message: string): Error {
  const err = new Error(`${status} ${message}`) as Error & { status: number; error: unknown }
  err.status = status
  err.error = { type: "invalid_request_error", code: null, message, param: "max_tokens" }
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

function history(session: OllamaSession): Array<Record<string, unknown>> {
  return (session as unknown as { messages: Array<Record<string, unknown>> }).messages
}

function lastBlocks(events: StreamEvent[]) {
  const last = events.filter((e) => e.type === "content").pop()
  if (last?.type !== "content") throw new Error("expected content event")
  return last.blocks
}

const CAP_ERROR =
  "max_tokens is too large: 32000. This model supports at most 16384 completion tokens, whereas you provided 32000."

describe("OllamaSession lifecycle", () => {
  it("a send issued while a stopped round winds down waits for it before touching history", async () => {
    queueTurn({
      toolCallDeltas: [{ index: 0, id: "call_a", name: "create_transaction", argFragments: ["{}"] }],
      finish_reason: "tool_calls",
    })
    const tools = blockingTools()

    const { session } = makeSession()
    const first = session.send("Add it")
    await tools.started()
    await session.stop()
    queueTurn({ textDeltas: ["ok"], finish_reason: "stop" })
    const second = session.send("Next")
    tools.resolvers[0]("created")
    await Promise.all([first, second])

    expect((lastCreateCall().messages as unknown[]).slice(3)).toEqual([
      { role: "tool", tool_call_id: "call_a", content: "created" },
      { role: "user", content: "Next" },
    ])
  })

  it("stop() mid-batch retracts the cards of calls that never run and reports only the run call", async () => {
    queueTurn({
      toolCallDeltas: [
        { index: 0, id: "call_a", name: "create_transaction", argFragments: ["{}"] },
        { index: 1, id: "call_b", name: "list_accounts", argFragments: ["{}"] },
        { index: 2, id: "call_c", name: "list_categories", argFragments: ["{}"] },
      ],
      finish_reason: "tool_calls",
    })
    const tools = blockingTools()

    const { session, events } = makeSession()
    const sending = session.send("Add these")
    await tools.started()
    await session.stop()
    const afterStop = events.length
    tools.resolvers[0]("created")
    await sending

    expect(lastBlocks(events)).toEqual([{ type: "tool-activity", tool: "create_transaction", status: "running" }])
    expect(events.slice(afterStop)).toEqual([
      { type: "tool-result", tool: "create_transaction", id: "call_a", ok: true },
    ])
    expect(events.filter((e) => e.type === "tool-result")).toHaveLength(1)
  })

  it("stop() in the tool phase leaves the finished stream un-aborted", async () => {
    queueTurn({
      toolCallDeltas: [{ index: 0, id: "call_a", name: "create_transaction", argFragments: ["{}"] }],
      finish_reason: "tool_calls",
    })
    const tools = blockingTools()

    const { session } = makeSession()
    const sending = session.send("Add it")
    await tools.started()
    await session.stop()
    tools.resolvers[0]("created")
    await sending

    expect(abortSignals[0].aborted).toBe(false)
  })

  it("kill() during the tool loop answers the rest with STOPPED and emits only the running call's tool-result", async () => {
    queueTurn({
      toolCallDeltas: [
        { index: 0, id: "call_a", name: "create_transaction", argFragments: ["{}"] },
        { index: 1, id: "call_b", name: "create_transaction", argFragments: ["{}"] },
      ],
      finish_reason: "tool_calls",
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

    expect(events.slice(afterKill)).toEqual([{ type: "tool-result", tool: "create_transaction", id: "call_a", ok: true }])
    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(history(session).slice(-2)).toEqual([
      { role: "tool", tool_call_id: "call_a", content: "created" },
      { role: "tool", tool_call_id: "call_b", content: STOPPED_RESULT },
    ])
  })

  it("restart() waits for an in-flight tool before clearing history", async () => {
    queueTurn({
      toolCallDeltas: [{ index: 0, id: "call_a", name: "create_transaction", argFragments: ["{}"] }],
      finish_reason: "tool_calls",
    })
    const tools = blockingTools()

    const { session } = makeSession()
    const sending = session.send("Add it")
    await tools.started()
    const restarting = session.restart()
    tools.resolvers[0]("created")
    await Promise.all([sending, restarting])

    expect(history(session)).toEqual([])
    queueTurn({ textDeltas: ["ok"], finish_reason: "stop" })
    await session.send("Fresh")
    expect(lastCreateCall().messages).toEqual([
      { role: "system", content: "you are capy" },
      { role: "user", content: "Fresh" },
    ])
  })

  it("Stop mid-text keeps the streamed text, marked as stopped, and drops the calls that never arrived", async () => {
    queueTurn({
      textDeltas: ["Let me", " check", " that"],
      toolCallDeltas: [{ index: 0, id: "call_a", name: "list_transactions", argFragments: ["{}"] }],
      finish_reason: "tool_calls",
    })

    const { session, events } = makeSession((e, s) => {
      if (e.type === "content" && JSON.stringify(e.blocks).includes("Let me check")) void s.stop()
    })
    await session.send("Hi")

    expect(mockRunTool).not.toHaveBeenCalled()
    expect(events.some((e) => e.type === "done" || e.type === "error")).toBe(false)
    expect(lastBlocks(events)).toEqual([{ type: "text", content: "Let me check" }])

    queueTurn({ textDeltas: ["ok"], finish_reason: "stop" })
    await session.send("Go on")
    expect((lastCreateCall().messages as unknown[]).slice(1)).toEqual([
      { role: "user", content: "Hi" },
      { role: "assistant", content: `Let me check${STOPPED_MARKER}` },
      { role: "user", content: "Go on" },
    ])
  })

  it("Stop mid-stream aborts the request and reports stopped, not the abort", async () => {
    queueTurn({ textDeltas: ["One", " two", " three"], finish_reason: "stop" })

    const { session, events } = makeSession((e, s) => {
      if (e.type === "content") void s.stop()
    })
    await session.send("Hi")

    expect(abortSignals[0].aborted).toBe(true)
    expect(events.filter((e) => e.type !== "content")).toEqual([])
    expect(lastBlocks(events)).toEqual([{ type: "text", content: "One" }])
  })

  it("a second Stop cancels a send queued behind the stopped round", async () => {
    queueTurn({
      toolCallDeltas: [{ index: 0, id: "call_a", name: "create_transaction", argFragments: ["{}"] }],
      finish_reason: "tool_calls",
    })
    const tools = blockingTools()

    const { session, events } = makeSession()
    const first = session.send("Add it")
    await tools.started()
    await session.stop()
    const queued = session.send("Next")
    expect(session.hasQueuedSend).toBe(true)
    await session.stop()
    expect(session.hasQueuedSend).toBe(false)
    tools.resolvers[0]("created")
    await Promise.all([first, queued])

    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(events.some((e) => e.type === "done" || e.type === "error")).toBe(false)
    expect(history(session).at(-1)).toEqual({ role: "tool", tool_call_id: "call_a", content: "created" })
  })

  it("a send whose content can't be converted reports an error and doesn't wedge the session", async () => {
    const { session, events } = makeSession()
    await session.send([42] as unknown as string)
    expect(events.at(-1)).toMatchObject({ type: "error", provider: "ollama" })

    queueTurn({ textDeltas: ["ok"], finish_reason: "stop" })
    await session.send("Hi")
    expect(events.at(-1)).toEqual({ type: "done" })
  })
})

describe("OllamaSession output cap", () => {
  const SCHEMA = {
    type: "object" as const,
    properties: { ok: { type: "boolean" as const } },
    required: ["ok"],
  }

  it("retries once with the limit a max_tokens 400 names, and keeps it for the session", async () => {
    queueTurn({ finish_reason: null, error: apiError(400, CAP_ERROR) })
    queueTurn({ textDeltas: ["ok"], finish_reason: "stop" })

    const { session, events } = makeSession()
    await session.send("Hi")
    expect(lastCreateCall().max_completion_tokens).toBe(16384)
    expect(events.at(-1)).toEqual({ type: "done" })

    queueStructured({ content: '{"ok": true}' })
    await session.structured([{ role: "user", content: "x" }], SCHEMA)
    expect(mockCreate).toHaveBeenCalledTimes(3)
    expect(lastCreateCall().max_completion_tokens).toBe(16384)
  })

  it("a retry that 400s again surfaces the error and leaves the cap unchanged", async () => {
    queueTurn({ finish_reason: null, error: apiError(400, CAP_ERROR) })
    queueTurn({ finish_reason: null, error: apiError(400, "Invalid 'messages[1].content'") })

    const { session, events } = makeSession()
    await session.send("Hi")
    expect(mockCreate).toHaveBeenCalledTimes(2)
    expect(events.at(-1)).toMatchObject({ type: "error", status: 400, message: "Invalid 'messages[1].content'" })

    queueTurn({ textDeltas: ["ok"], finish_reason: "stop" })
    await session.send("Again")
    expect(lastCreateCall().max_completion_tokens).toBe(MAX_OUTPUT_TOKENS)
  })

  it("surfaces an unrelated 400 without retrying", async () => {
    queueTurn({ finish_reason: null, error: apiError(400, "Invalid 'messages[1].content'") })

    const { session, events } = makeSession()
    await session.send("Hi")
    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(events.at(-1)).toMatchObject({ type: "error", status: 400 })
  })

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
  it("a request that fails before any reply leaves no trace in history", async () => {
    queueTurn({ finish_reason: null, error: apiError(400, "this model does not support images") })

    const { session, events } = makeSession()
    await session.send([
      { type: "text", text: "what's on this receipt?" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
    ])
    expect(events.at(-1)).toMatchObject({ type: "error", status: 400, provider: "ollama", rolledBack: true })
    expect(history(session)).toEqual([])

    queueTurn({ textDeltas: ["Hi"], finish_reason: "stop" })
    await session.send("hello")
    expect((lastCreateCall().messages as unknown[]).slice(1)).toEqual([{ role: "user", content: "hello" }])
  })

  it.each([
    ["a 429", apiError(429, "too many requests")],
    ["a 5xx", apiError(500, "server error")],
    ["a dropped connection", new Error("network lost")],
  ])("keeps the question in history after %s, so the next send carries it", async (_, error) => {
    queueTurn({ finish_reason: null, error })

    const { session, events } = makeSession()
    await session.send("first")
    expect(events.at(-1)).toMatchObject({ type: "error" })
    expect(events.at(-1)).not.toHaveProperty("rolledBack")

    queueTurn({ textDeltas: ["ok"], finish_reason: "stop" })
    await session.send("again")
    expect((lastCreateCall().messages as unknown[]).slice(1)).toEqual([
      { role: "user", content: "first" },
      { role: "user", content: "again" },
    ])
  })

  it("a failure after a stored reply never rolls history back", async () => {
    queueTurn({
      toolCallDeltas: [{ index: 0, id: "call_a", name: "list_accounts", argFragments: ["{}"] }],
      finish_reason: "tool_calls",
    })
    queueTurn({ finish_reason: null, error: apiError(500, "server error") })
    mockRunTool.mockResolvedValue("accounts")

    const { session } = makeSession()
    await session.send("accounts?")

    expect(history(session).map((m) => m.role)).toEqual(["user", "assistant", "tool"])
  })

  it("an error mid-stream keeps the streamed text in history and on screen", async () => {
    queueTurn({
      textDeltas: ["Partial ", "answer"],
      toolCallDeltas: [{ index: 0, id: "call_a", name: "create_transaction", argFragments: ["{}"] }],
      finish_reason: null,
      failAfter: new Error("network lost"),
    })

    const { session, events } = makeSession()
    await session.send("q")

    expect(history(session).at(-1)).toEqual({ role: "assistant", content: "Partial answer" })
    expect(lastBlocks(events)).toEqual([{ type: "text", content: "Partial answer" }])
    expect(events.at(-1)).toMatchObject({ type: "error", message: "network lost", provider: "ollama" })
    expect(mockRunTool).not.toHaveBeenCalled()
  })

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

  it("reports a 429 as rateLimited, stamped with the provider", async () => {
    queueTurn({ finish_reason: null, error: apiError(429, "too many requests") })

    const { session, events } = makeSession()
    await session.send("hi")

    expect(events.at(-1)).toMatchObject({ type: "error", code: "rateLimited", status: 429, provider: "ollama" })
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

  it("stamps the provider on a cut-off reply's error", async () => {
    queueTurn({ textDeltas: ["Half"], finish_reason: "length" })

    const { session, events } = makeSession()
    await session.send("hi")

    expect(events.at(-1)).toMatchObject({ type: "error", code: "cutOff", provider: "ollama" })
  })

  it("marks a call whose tool throws as failed on its card", async () => {
    queueTurn({
      toolCallDeltas: [{ index: 0, id: "call_a", name: "create_transaction", argFragments: ["{}"] }],
      finish_reason: "tool_calls",
    })
    queueTurn({ textDeltas: ["That didn't work."], finish_reason: "stop" })
    mockRunTool.mockRejectedValue(new Error("bad input"))

    const { session, events } = makeSession()
    await session.send("add it")

    expect(lastBlocks(events)).toEqual([
      { type: "tool-activity", tool: "create_transaction", status: "failed" },
      { type: "text", content: "That didn't work." },
    ])
  })
})
