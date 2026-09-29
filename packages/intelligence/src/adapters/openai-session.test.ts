import { describe, it, expect, vi, beforeEach } from "vitest"
import type { StreamEvent } from "@capybudget/intelligence"
import type { CurrencySettings } from "@capybudget/core"
import type { BudgetRepository, FileAdapter } from "@capybudget/persistence"
import { getToolDefinitions } from "../tools"

interface FakeCall {
  id: string
  name: string
  /** JSON argument fragments, one `function_call_arguments.delta` each. */
  argFragments?: string[]
}

interface FakeTurn {
  reasoning?: { id: string; encrypted: string }
  textDeltas?: string[]
  /** A second message item, streamed after the calls. */
  trailingTextDeltas?: string[]
  refusalDeltas?: string[]
  calls?: FakeCall[]
  /** Null ends the stream without a terminal event. */
  status: "completed" | "incomplete" | null
  incompleteReason?: "max_output_tokens" | "content_filter"
  /** Rejects `create()` itself. */
  error?: Error
  /** Ends the stream with `response.failed` carrying this message. */
  failure?: string
  /** Ends the stream with an `error` event carrying this message. */
  errorEvent?: string
  /** A text delta queued after the terminal event — must never be observed. */
  tailDelta?: string
}

interface StructuredReply {
  text: string
  status?: "completed" | "incomplete"
  incompleteReason?: "max_output_tokens" | "content_filter"
  refusal?: string
}

interface RecordedCall {
  input: Array<Record<string, unknown>>
  instructions?: string
  tools?: Array<Record<string, unknown>>
  include?: string[]
  store?: boolean
  text?: unknown
  stream?: boolean
  max_output_tokens?: number
  previous_response_id?: string
}

type Item = Record<string, unknown>
type Event = Record<string, unknown>

const { mockCreate, queueTurn, queueStructured, lastCreateCall, allCreateCalls, abortSignals } = vi.hoisted(
  () => {
    const queue: Array<FakeTurn> = []
    const structuredQueue: Array<StructuredReply | { error: Error }> = []
    const calls: RecordedCall[] = []
    const signals: AbortSignal[] = []

    function messageItem(id: string, content: Item[]): Item {
      return { type: "message", id, role: "assistant", status: "completed", content }
    }

    function outputText(output: Item[]): string {
      return output
        .filter((item) => item.type === "message")
        .flatMap((item) => item.content as Item[])
        .filter((part) => part.type === "output_text")
        .map((part) => part.text)
        .join("")
    }

    function response(status: string, output: Item[], reason?: string): Item {
      return {
        object: "response",
        status,
        incomplete_details: reason ? { reason } : null,
        error: null,
        output,
        output_text: outputText(output),
      }
    }

    function streamEvents(turn: FakeTurn): Event[] {
      const events: Event[] = []
      const output: Item[] = []
      const done = (item: Item) => {
        events.push({ type: "response.output_item.done", output_index: output.length, item })
        output.push(item)
      }
      const message = (id: string, deltas: string[]) => {
        events.push({ type: "response.output_item.added", output_index: output.length, item: messageItem(id, []) })
        for (const delta of deltas) {
          events.push({ type: "response.output_text.delta", item_id: id, output_index: output.length, content_index: 0, delta })
        }
        done(messageItem(id, [{ type: "output_text", text: deltas.join(""), annotations: [] }]))
      }

      if (turn.reasoning) {
        done({ type: "reasoning", id: turn.reasoning.id, summary: [], encrypted_content: turn.reasoning.encrypted })
      }
      if (turn.textDeltas) message("msg_1", turn.textDeltas)
      if (turn.refusalDeltas) {
        for (const delta of turn.refusalDeltas) {
          events.push({ type: "response.refusal.delta", item_id: "msg_r", output_index: output.length, content_index: 0, delta })
        }
        done(messageItem("msg_r", [{ type: "refusal", refusal: turn.refusalDeltas.join("") }]))
      }
      for (const call of turn.calls ?? []) {
        const item = { type: "function_call", id: `fc_${call.id}`, call_id: call.id, name: call.name, status: "in_progress" }
        events.push({ type: "response.output_item.added", output_index: output.length, item: { ...item, arguments: "" } })
        for (const delta of call.argFragments ?? []) {
          events.push({ type: "response.function_call_arguments.delta", item_id: item.id, output_index: output.length, delta })
        }
        done({ ...item, status: "completed", arguments: (call.argFragments ?? []).join("") })
      }
      if (turn.trailingTextDeltas) message("msg_2", turn.trailingTextDeltas)

      if (turn.failure) {
        events.push({ type: "response.failed", response: { ...response("failed", output), error: { code: "server_error", message: turn.failure } } })
      } else if (turn.errorEvent) {
        events.push({ type: "error", code: null, message: turn.errorEvent, param: null })
      } else if (turn.status) {
        events.push({ type: `response.${turn.status}`, response: response(turn.status, output, turn.incompleteReason) })
      }
      if (turn.tailDelta) {
        events.push({ type: "response.output_text.delta", item_id: "msg_tail", output_index: output.length, content_index: 0, delta: turn.tailDelta })
      }
      return events
    }

    const create = vi.fn().mockImplementation(async (params, opts) => {
      calls.push({
        ...JSON.parse(JSON.stringify(params)),
        tools: params.tools,
      })

      if (!params.stream) {
        const next = structuredQueue.shift()
        if (!next) throw new Error("Test bug: no structured response queued")
        if ("error" in next) throw next.error
        const content = next.refusal
          ? [{ type: "refusal", refusal: next.refusal }]
          : [{ type: "output_text", text: next.text, annotations: [] }]
        return response(next.status ?? "completed", [messageItem("msg_s", content)], next.incompleteReason)
      }

      if (opts?.signal) signals.push(opts.signal as AbortSignal)
      const turn = queue.shift()
      if (!turn) throw new Error("Test bug: no turn queued for responses.create()")
      if (turn.error) throw turn.error

      const sig = opts?.signal as AbortSignal | undefined
      const events = streamEvents(turn)
      const controller = new AbortController()
      async function* iterate() {
        for (const event of events) {
          if (sig?.aborted || controller.signal.aborted) {
            const err = new Error("Aborted")
            err.name = "AbortError"
            throw err
          }
          yield event
        }
      }
      return { [Symbol.asyncIterator]: iterate, controller }
    })

    return {
      mockCreate: create,
      queueTurn: (turn: FakeTurn) => queue.push(turn),
      queueStructured: (next: StructuredReply | { error: Error }) => structuredQueue.push(next),
      lastCreateCall: () => calls[calls.length - 1],
      allCreateCalls: () => calls,
      abortSignals: signals,
    }
  },
)

vi.mock("openai", () => {
  return {
    default: class {
      responses = { create: mockCreate }
    },
  }
})

const { mockRunTool } = vi.hoisted(() => ({
  mockRunTool: vi.fn<(name: string, input: Record<string, unknown>, ctx: unknown) => Promise<string>>(),
}))

vi.mock("../tools", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>
  return {
    ...original,
    runTool: mockRunTool,
  }
})

import { OpenAiSession } from "./openai-session"
import { MAX_OUTPUT_TOKENS, STOPPED_MARKER, STOPPED_RESULT, UNANSWERED_RESULT } from "./agent-turn"
import { CutOffError, RefusedError } from "../structured"

function makeSession(onEvent?: (e: StreamEvent, session: OpenAiSession) => void) {
  const events: StreamEvent[] = []
  const session: OpenAiSession = new OpenAiSession({
    budgetPath: "/budget",
    systemPrompt: "you are capy",
    apiKey: "sk-openai-test",
    model: "gpt-6-astra",
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

function history(session: OpenAiSession): Item[] {
  return (session as unknown as { messages: Item[] }).messages
}

function outputs(input: Item[]): Array<{ call_id: unknown; output: unknown }> {
  return input
    .filter((item) => item.type === "function_call_output")
    .map((item) => ({ call_id: item.call_id, output: item.output }))
}

function lastBlocks(events: StreamEvent[]) {
  const last = events.filter((e) => e.type === "content").pop()
  if (last?.type !== "content") throw new Error("expected content event")
  return last.blocks
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

function apiError(status: number, message: string, param: string | null = "max_output_tokens"): Error {
  const err = new Error(`${status} ${message}`) as Error & { status: number; error: unknown }
  err.status = status
  err.error = { type: "invalid_request_error", code: null, message, param }
  return err
}

beforeEach(() => {
  mockCreate.mockClear()
  mockRunTool.mockReset()
  abortSignals.length = 0
})

describe("OpenAiSession", () => {
  it("emits cumulative content events and a done event on a one-turn reply", async () => {
    queueTurn({ textDeltas: ["Hello", ", world"], status: "completed" })

    const { session, events } = makeSession()
    await session.send("Hi")

    expect(events.filter((e) => e.type === "content")).toEqual([
      { type: "content", blocks: [{ type: "text", content: "Hello" }] },
      { type: "content", blocks: [{ type: "text", content: "Hello, world" }] },
    ])
    expect(events.at(-1)).toEqual({ type: "done" })
  })

  it("sends the system prompt as instructions and keeps no server-side state", async () => {
    queueTurn({ textDeltas: ["ok"], status: "completed" })
    const { session } = makeSession()
    await session.send("Hi")

    const call = lastCreateCall()
    expect(call.instructions).toBe("you are capy")
    expect(call.store).toBe(false)
    expect(call.previous_response_id).toBeUndefined()
    expect(call.include).toEqual(["reasoning.encrypted_content"])
    expect(call.input).toEqual([{ role: "user", content: "Hi" }])
  })

  it("replays the full input each turn, the stored reply included", async () => {
    queueTurn({ textDeltas: ["Hello"], status: "completed" })
    queueTurn({ textDeltas: ["Again"], status: "completed" })
    const { session } = makeSession()
    await session.send("Hi")
    await session.send("More")

    expect(lastCreateCall().input).toEqual([
      { role: "user", content: "Hi" },
      {
        type: "message",
        id: "msg_1",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: "Hello", annotations: [] }],
      },
      { role: "user", content: "More" },
    ])
  })

  it("keeps the tools + instructions prefix byte-stable across turns (prefix caching)", async () => {
    queueTurn({ calls: [{ id: "call_1", name: "list_accounts", argFragments: ["{}"] }], status: "completed" })
    queueTurn({ textDeltas: ["Done."], status: "completed" })
    mockRunTool.mockResolvedValueOnce("ok")

    const { session } = makeSession()
    await session.send("How much do I have?")

    const [turn1, turn2] = allCreateCalls().slice(-2)
    expect(turn1.tools).toEqual(turn2.tools)
    expect(turn1.instructions).toBe("you are capy")
    expect(turn2.instructions).toBe(turn1.instructions)
  })

  it("defines tools as flat, non-strict function tools", async () => {
    queueTurn({ textDeltas: ["ok"], status: "completed" })
    const { session } = makeSession()
    await session.send("hi")

    const tool = lastCreateCall().tools!.find((t) => t.name === "list_accounts")
    expect(tool).toMatchObject({ type: "function", name: "list_accounts", strict: false })
    expect(tool).toHaveProperty("parameters")
    expect(tool).toHaveProperty("description")
  })

  it("reads currencies live at tool-run time, so a rate edit lands without a session rebuild", async () => {
    const liveCurrencies: { ref: Record<string, CurrencySettings> } = {
      ref: { USD: { decimals: 2, symbolPosition: "before" } },
    }
    queueTurn({ calls: [{ id: "call_1", name: "create_transaction", argFragments: ["{}"] }], status: "completed" })
    queueTurn({ textDeltas: ["Added."], status: "completed" })
    mockRunTool.mockResolvedValueOnce(JSON.stringify({ success: true }))

    const session = new OpenAiSession({
      budgetPath: "/budget",
      systemPrompt: "you are capy",
      apiKey: "sk-openai-test",
      model: "gpt-6-astra",
      onEvent: () => {},
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

  it("dispatches a tool call (arguments arrive across many deltas), answers it by call_id, and continues the loop", async () => {
    queueTurn({
      textDeltas: ["Looking up..."],
      calls: [{ id: "call_abc", name: "list_transactions", argFragments: ['{"', "limit", '":', " 5", "}"] }],
      status: "completed",
    })
    queueTurn({ textDeltas: ["Found 5 transactions."], status: "completed" })
    mockRunTool.mockResolvedValueOnce("5 transactions found")

    const { session, events } = makeSession()
    await session.send("Show recent")

    expect(mockRunTool).toHaveBeenCalledWith(
      "list_transactions",
      { limit: 5 },
      expect.objectContaining({ budgetPath: "/budget", currency: "USD" }),
    )
    const input = lastCreateCall().input
    expect(input.map((item) => item.type ?? item.role)).toEqual([
      "user",
      "message",
      "function_call",
      "function_call_output",
    ])
    expect(input[2]).toMatchObject({ call_id: "call_abc", name: "list_transactions", arguments: '{"limit": 5}' })
    expect(input[3]).toEqual({ type: "function_call_output", call_id: "call_abc", output: "5 transactions found" })
    expect(lastBlocks(events)).toEqual([
      { type: "text", content: "Looking up..." },
      { type: "tool-activity", tool: "list_transactions" },
      { type: "text", content: "Found 5 transactions." },
    ])
    expect(events.at(-1)).toEqual({ type: "done" })
  })

  it("shows a call's card as soon as its item finishes streaming", async () => {
    let cardShownBeforeRun = false
    mockRunTool.mockImplementation(async () => {
      cardShownBeforeRun = true
      return "ok"
    })
    queueTurn({ calls: [{ id: "call_a", name: "list_accounts", argFragments: ["{}"] }], status: "completed" })
    queueTurn({ textDeltas: ["Done."], status: "completed" })

    const { session, events } = makeSession()
    await session.send("hi")

    const firstCard = events.findIndex(
      (e) => e.type === "content" && e.blocks.some((b) => b.type === "tool-activity"),
    )
    expect(firstCard).toBeGreaterThanOrEqual(0)
    expect(cardShownBeforeRun).toBe(true)
  })

  it("emits a render-tool ContentBlock without a tool-activity block", async () => {
    queueTurn({
      calls: [{ id: "call_render", name: "render_table", argFragments: ['{"headers":["A","B"],', '"rows":[["1","2"]]}'] }],
      status: "completed",
    })
    queueTurn({ textDeltas: ["done"], status: "completed" })
    mockRunTool.mockResolvedValueOnce("Rendered.")

    const { session, events } = makeSession()
    await session.send("Show me a table")

    const allBlocks = events.flatMap((e) => (e.type === "content" ? e.blocks : []))
    expect(allBlocks.find((b) => b.type === "table")).toEqual({ type: "table", headers: ["A", "B"], rows: [["1", "2"]] })
    expect(allBlocks.some((b) => b.type === "tool-activity" && b.tool === "render_table")).toBe(false)
  })

  it("surfaces a parse error in the tool result when arguments are malformed JSON", async () => {
    queueTurn({ calls: [{ id: "call_bad", name: "create_transaction", argFragments: ['{"limit', ": 5"] }], status: "completed" })
    queueTurn({ textDeltas: ["Sorry, I'll try again."], status: "completed" })

    const { session, events } = makeSession()
    await session.send("Show recent")

    expect(mockRunTool).not.toHaveBeenCalled()
    const [reply] = outputs(lastCreateCall().input)
    expect(reply.call_id).toBe("call_bad")
    expect(reply.output).toMatch(/invalid JSON arguments/i)
    expect(events.filter((e) => e.type === "tool-result")).toEqual([
      { type: "tool-result", tool: "create_transaction", id: "call_bad", ok: false },
    ])
  })

  it("emits an error event when the SDK rejects", async () => {
    queueTurn({ status: null, error: new Error("rate limited") })

    const { session, events } = makeSession()
    await session.send("Hi")

    expect(events.find((e) => e.type === "error")).toEqual({
      type: "error",
      message: "rate limited",
      status: undefined,
      provider: "openai",
    })
    expect(events.some((e) => e.type === "done")).toBe(false)
  })

  it("extracts the inner message from an OpenAI APIError-shaped throw", async () => {
    const err = new Error("429 You exceeded your current quota") as Error & { status: number; error: unknown }
    err.status = 429
    err.error = {
      type: "insufficient_quota",
      code: "insufficient_quota",
      message: "You exceeded your current quota, please check your plan and billing details.",
      param: null,
    }
    queueTurn({ status: null, error: err })

    const { session, events } = makeSession()
    await session.send("Hi")

    expect(events.find((e) => e.type === "error")).toEqual({
      type: "error",
      message: "You exceeded your current quota, please check your plan and billing details.",
      status: 429,
      provider: "openai",
    })
  })

  it.each([
    ["a response.failed event", { failure: "The server had an error." }],
    ["an error event", { errorEvent: "The server had an error." }],
  ])("reports %s as an error, not as a cut-off", async (_label, ending) => {
    queueTurn({ textDeltas: ["Let me"], status: null, ...ending })

    const { session, events } = makeSession()
    await session.send("Hi")

    expect(events.at(-1)).toEqual({ type: "error", message: "The server had an error.", provider: "openai" })
  })

  it("stop() mid-batch finishes the running tool, runs no more, and keeps the round answered", async () => {
    queueTurn({
      calls: [
        { id: "call_a", name: "create_transaction", argFragments: ["{}"] },
        { id: "call_b", name: "create_transaction", argFragments: ["{}"] },
        { id: "call_c", name: "create_transaction", argFragments: ["{}"] },
      ],
      status: "completed",
    })
    const tools = blockingTools()

    const { session, events } = makeSession()
    const sending = session.send("Add these")
    await tools.started()
    await session.stop()
    tools.resolvers[0]("created a")
    await sending

    expect(mockRunTool).toHaveBeenCalledTimes(1)
    expect(events.some((e) => e.type === "done" || e.type === "error")).toBe(false)

    queueTurn({ textDeltas: ["ok"], status: "completed" })
    await session.send("Hi again")
    const input = lastCreateCall().input
    expect(outputs(input)).toEqual([
      { call_id: "call_a", output: "created a" },
      { call_id: "call_b", output: STOPPED_RESULT },
      { call_id: "call_c", output: STOPPED_RESULT },
    ])
    expect(input.at(-1)).toEqual({ role: "user", content: "Hi again" })
  })

  it("answers a trailing turn's unanswered calls before appending the next user message", async () => {
    const { session } = makeSession()
    history(session).push(
      { role: "user", content: "Add it" },
      { type: "function_call", call_id: "call_a", name: "create_transaction", arguments: "{}" },
      { type: "function_call", call_id: "call_b", name: "create_transaction", arguments: "{}" },
      { type: "function_call_output", call_id: "call_a", output: "created" },
    )

    queueTurn({ textDeltas: ["ok"], status: "completed" })
    await session.send("Hello?")

    expect(lastCreateCall().input.slice(3)).toEqual([
      { type: "function_call_output", call_id: "call_a", output: "created" },
      { type: "function_call_output", call_id: "call_b", output: UNANSWERED_RESULT },
      { role: "user", content: "Hello?" },
    ])
  })

  it("streams the agent loop with the raised output cap", async () => {
    queueTurn({ textDeltas: ["ok"], status: "completed" })
    const { session } = makeSession()
    await session.send("Hi")
    expect(lastCreateCall().max_output_tokens).toBe(MAX_OUTPUT_TOKENS)
  })

  it("kill() flips isAlive false", async () => {
    queueTurn({ textDeltas: ["typing"], status: "completed" })
    const { session } = makeSession()
    await session.send("Hi")
    expect(session.isAlive).toBe(true)
    await session.kill()
    expect(session.isAlive).toBe(false)
  })

  it("walks a multi-turn tool loop, threading each result back to the model", async () => {
    queueTurn({ calls: [{ id: "call-1", name: "search_transactions", argFragments: ['{"query":', '"Apple"}'] }], status: "completed" })
    queueTurn({
      calls: [{ id: "call-2", name: "group_transactions", argFragments: ['{"groupBy":["merchant"],', '"metrics":["sum"]}'] }],
      status: "completed",
    })
    queueTurn({ textDeltas: ["You spent $312 across 8 Apple charges."], status: "completed" })
    mockRunTool
      .mockResolvedValueOnce(JSON.stringify({ rows: [{ id: "t-1" }] }))
      .mockResolvedValueOnce(JSON.stringify({ groups: [{ key: "Apple", sum: -31200 }] }))

    const { session, events } = makeSession()
    await session.send("How much have I spent at Apple?")

    expect(mockRunTool).toHaveBeenNthCalledWith(1, "search_transactions", { query: "Apple" }, expect.anything())
    expect(mockRunTool).toHaveBeenNthCalledWith(
      2,
      "group_transactions",
      { groupBy: ["merchant"], metrics: ["sum"] },
      expect.anything(),
    )
    expect(outputs(lastCreateCall().input).map((o) => o.call_id)).toEqual(["call-1", "call-2"])
    expect(events.at(-1)).toEqual({ type: "done" })
  })

  it("forwards images as input_image and PDFs as input_file", async () => {
    queueTurn({ textDeltas: ["ok"], status: "completed" })
    const { session } = makeSession()
    await session.send([
      { type: "text", text: "Receipt extraction" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
      {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: "BBBB" },
        filename: "statement.pdf",
      },
    ])

    expect(lastCreateCall().input[0]).toEqual({
      role: "user",
      content: [
        { type: "input_text", text: "Receipt extraction" },
        { type: "input_image", image_url: "data:image/png;base64,AAAA", detail: "auto" },
        { type: "input_file", filename: "statement.pdf", file_data: "data:application/pdf;base64,BBBB" },
      ],
    })
  })

  it("falls back to document.pdf when a document block carries no filename", async () => {
    queueTurn({ textDeltas: ["ok"], status: "completed" })
    const { session } = makeSession()
    await session.send([{ type: "document", source: { type: "base64", media_type: "application/pdf", data: "CCCC" } }])

    const content = lastCreateCall().input[0].content as Item[]
    expect(content[0]).toMatchObject({ type: "input_file", filename: "document.pdf" })
  })

  it("terminates with a budget-exhausted error after SESSION_TOOL_CALL_BUDGET tool calls", async () => {
    const { SESSION_TOOL_CALL_BUDGET } = await import("@capybudget/intelligence")
    for (let i = 0; i < SESSION_TOOL_CALL_BUDGET + 1; i++) {
      queueTurn({ calls: [{ id: `tc-${i}`, name: "list_accounts", argFragments: ["{}"] }], status: "completed" })
    }
    mockRunTool.mockResolvedValue("ok")

    const { session, events } = makeSession()
    await session.send("Loop forever")

    expect(mockRunTool).toHaveBeenCalledTimes(SESSION_TOOL_CALL_BUDGET)
    const errorEvent = events.find((e) => e.type === "error")
    expect(errorEvent).toMatchObject({ code: "budgetExhausted" })
    expect(events.some((e) => e.type === "done")).toBe(false)
  })

  it("accumulates render blocks across agentic-loop iterations", async () => {
    queueTurn({
      textDeltas: ["Here's the split:"],
      calls: [
        {
          id: "tc-donut",
          name: "render_chart",
          argFragments: ['{"title":"Spending","type":"donut","data":[{"label":"Food","value":50}]}'],
        },
      ],
      status: "completed",
    })
    queueTurn({
      calls: [{ id: "tc-table", name: "render_table", argFragments: ['{"headers":["Category","Amount"],"rows":[["Food","$50"]]}'] }],
      status: "completed",
    })
    queueTurn({ textDeltas: ["done"], status: "completed" })
    mockRunTool.mockResolvedValue("Rendered.")

    const { session, events } = makeSession()
    await session.send("Breakdown please")

    const types = lastBlocks(events).map((b) => b.type)
    expect(types).toContain("donut-chart")
    expect(types).toContain("table")
  })

  it("stores nothing for a completed response that carries no message or call", async () => {
    queueTurn({ calls: [{ id: "tc-1", name: "list_accounts", argFragments: ["{}"] }], status: "completed" })
    queueTurn({ reasoning: { id: "rs_empty", encrypted: "enc-empty" }, status: "completed" })
    mockRunTool.mockResolvedValue("ok")

    const { session, events } = makeSession()
    await session.send("how am I doing?")

    expect(history(session).some((item) => item.id === "rs_empty")).toBe(false)
    expect(events.at(-1)).toEqual({ type: "done" })
  })

  it("returns at the terminal event without consuming anything after it", async () => {
    queueTurn({ textDeltas: ["visible"], status: "completed", tailDelta: "INVISIBLE" })

    const { session, events } = makeSession()
    await session.send("Hi")

    expect(lastBlocks(events)).toEqual([{ type: "text", content: "visible" }])
  })

  it("restart() resets the budget counter so the next session starts fresh", async () => {
    const { SESSION_TOOL_CALL_BUDGET } = await import("@capybudget/intelligence")
    for (let i = 0; i < SESSION_TOOL_CALL_BUDGET + 1; i++) {
      queueTurn({ calls: [{ id: `tc-${i}`, name: "list_accounts", argFragments: ["{}"] }], status: "completed" })
    }
    mockRunTool.mockResolvedValue("ok")

    const { session } = makeSession()
    await session.send("Loop forever")
    await session.restart()
    mockRunTool.mockClear()
    queueTurn({ calls: [{ id: "tc-post-restart", name: "list_accounts", argFragments: ["{}"] }], status: "completed" })
    queueTurn({ textDeltas: ["Done."], status: "completed" })

    await session.send("After restart")

    expect(mockRunTool).toHaveBeenCalledTimes(1)
  })

  it("emits a tool-result event with ok=true after a tool resolves, ok=false when it throws", async () => {
    queueTurn({
      calls: [
        { id: "call_ok", name: "create_transaction", argFragments: ["{}"] },
        { id: "call_err", name: "create_transaction", argFragments: ["{}"] },
      ],
      status: "completed",
    })
    queueTurn({ textDeltas: ["Done."], status: "completed" })
    mockRunTool.mockResolvedValueOnce(JSON.stringify({ success: true })).mockRejectedValueOnce(new Error("disk full"))

    const { session, events } = makeSession()
    await session.send("Add it.")

    expect(events.filter((e) => e.type === "tool-result")).toEqual([
      { type: "tool-result", tool: "create_transaction", id: "call_ok", ok: true },
      { type: "tool-result", tool: "create_transaction", id: "call_err", ok: false },
    ])
  })

  it("treats render_followups as terminal — exits the loop without a second request", async () => {
    queueTurn({
      calls: [{ id: "call_followups", name: "render_followups", argFragments: ['{"chips":[{"label":"More","prompt":"Tell me more"}]}'] }],
      status: "completed",
    })
    mockRunTool.mockResolvedValueOnce("Rendered.")

    const { session, events } = makeSession()
    await session.send("Quick answer please")

    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(events.at(-1)).toEqual({ type: "done" })
  })

  it("continues the loop when render_followups fails validation, so the model can recover", async () => {
    queueTurn({ calls: [{ id: "call_bad_followups", name: "render_followups", argFragments: ['{"chips":[]}'] }], status: "completed" })
    queueTurn({ textDeltas: ["Here's a recap instead."], status: "completed" })
    mockRunTool.mockRejectedValueOnce(new Error("Invalid input: render_followups expects at least one chip."))

    const { session, events } = makeSession()
    await session.send("Quick answer please")

    expect(mockCreate).toHaveBeenCalledTimes(2)
    expect(outputs(lastCreateCall().input)[0].output).toContain("Invalid input")
    expect(lastBlocks(events)).toContainEqual({ type: "text", content: "Here's a recap instead." })
    expect(events.at(-1)).toEqual({ type: "done" })
  })
})

describe("OpenAiSession reasoning", () => {
  it("replays reasoning items, encrypted content intact, ahead of the calls they led to", async () => {
    queueTurn({
      reasoning: { id: "rs_1", encrypted: "gAAAA-opaque" },
      calls: [{ id: "call_a", name: "list_accounts", argFragments: ["{}"] }],
      status: "completed",
    })
    queueTurn({ reasoning: { id: "rs_2", encrypted: "gAAAA-second" }, textDeltas: ["Done."], status: "completed" })
    mockRunTool.mockResolvedValueOnce("ok")

    const { session } = makeSession()
    await session.send("Balances?")

    const input = lastCreateCall().input
    expect(input.map((item) => item.type ?? item.role)).toEqual(["user", "reasoning", "function_call", "function_call_output"])
    expect(input[1]).toEqual({ type: "reasoning", id: "rs_1", summary: [], encrypted_content: "gAAAA-opaque" })
    expect(input[2]).toMatchObject({ type: "function_call", id: "fc_call_a", call_id: "call_a" })

    queueTurn({ textDeltas: ["ok"], status: "completed" })
    await session.send("Thanks")
    expect(lastCreateCall().input.find((item) => item.id === "rs_2")).toEqual({
      type: "reasoning",
      id: "rs_2",
      summary: [],
      encrypted_content: "gAAAA-second",
    })
  })

  it("drops the reasoning include for the session when the model rejects encrypted content", async () => {
    queueTurn({ status: null, error: apiError(400, "Encrypted content is not supported with this model.", "include") })
    queueTurn({ textDeltas: ["ok"], status: "completed" })
    queueTurn({ textDeltas: ["again"], status: "completed" })

    const { session, events } = makeSession()
    await session.send("Hi")
    expect(events.at(-1)).toEqual({ type: "done" })
    expect(lastCreateCall().include).toBeUndefined()

    await session.send("More")
    expect(mockCreate).toHaveBeenCalledTimes(3)
    expect(lastCreateCall().include).toBeUndefined()
  })
})

describe("OpenAiSession endings", () => {
  it.each([
    ["incomplete with max_output_tokens", "max_output_tokens" as const, "cutOff"],
    ["incomplete with content_filter", "content_filter" as const, "refused"],
  ])("never runs calls from a response %s, keeps only its text, and reports %s", async (_label, reason, code) => {
    queueTurn({
      textDeltas: ["Let me check"],
      calls: [{ id: "call_1", name: "list_transactions", argFragments: ['{"lim'] }],
      status: "incomplete",
      incompleteReason: reason,
    })

    const { session, events } = makeSession()
    await session.send("hi")
    expect(mockRunTool).not.toHaveBeenCalled()
    expect(events.at(-1)).toMatchObject({ type: "error", code })
    expect(lastBlocks(events)).toEqual([{ type: "text", content: "Let me check" }])

    queueTurn({ textDeltas: ["ok"], status: "completed" })
    await session.send("again")
    const input = lastCreateCall().input
    expect(input.some((item) => item.type === "function_call")).toBe(false)
    expect(input).toContainEqual({ role: "assistant", content: "Let me check" })
  })

  it("reports a stream with no terminal event as cutOff, keeping its text", async () => {
    queueTurn({ textDeltas: ["A long answer that"], status: null })

    const { session, events } = makeSession()
    await session.send("Explain")

    expect(events.at(-1)).toMatchObject({ type: "error", code: "cutOff" })
    expect(history(session).at(-1)).toEqual({ role: "assistant", content: "A long answer that" })
  })

  it("keeps only the text streamed before the first call when a response is cut off", async () => {
    queueTurn({
      textDeltas: ["Checking"],
      calls: [{ id: "call_1", name: "list_accounts", argFragments: ["{}"] }],
      trailingTextDeltas: ["and more"],
      status: "incomplete",
      incompleteReason: "max_output_tokens",
    })

    const { session, events } = makeSession()
    await session.send("hi")

    expect(lastBlocks(events)).toEqual([{ type: "text", content: "Checking" }])
    expect(history(session).slice(1)).toEqual([{ role: "assistant", content: "Checking" }])
  })

  it("reports a streamed refusal as refused, storing nothing", async () => {
    queueTurn({ refusalDeltas: ["I can't ", "help with that."], status: "completed" })

    const { session, events } = makeSession()
    await session.send("hi")

    expect(events.at(-1)).toMatchObject({ type: "error", code: "refused" })
    expect(events.some((e) => e.type === "done")).toBe(false)
    expect(history(session).some((item) => item.role === "assistant" || item.type === "message")).toBe(false)
  })

  it.each([
    ["incomplete with max_output_tokens", "incomplete" as const, "max_output_tokens" as const, "cutOff"],
    ["incomplete with content_filter", "incomplete" as const, "content_filter" as const, "refused"],
    ["cut short of a terminal event", null, undefined, "cutOff"],
  ])("reports a text-less response %s as %s instead of an empty reply", async (_label, status, reason, code) => {
    queueTurn({
      calls: [{ id: "call_1", name: "list_transactions", argFragments: ['{"lim'] }],
      status,
      incompleteReason: reason,
    })

    const { session, events } = makeSession()
    await session.send("hi")

    expect(events.find((e) => e.type === "error")).toMatchObject({ type: "error", code })
    expect(events.some((e) => e.type === "done")).toBe(false)
    expect(lastBlocks(events)).toEqual([])
    expect(history(session)).toEqual([{ role: "user", content: "hi" }])
  })

  it("stays silent when stop() lands as a text-less response is cut off", async () => {
    const { session, events } = makeSession()
    mockCreate.mockImplementationOnce(async () => ({
      async *[Symbol.asyncIterator]() {
        yield {
          type: "response.output_item.added",
          output_index: 0,
          item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "list_transactions", arguments: "" },
        }
        await session.stop()
      },
    }))

    await session.send("hi")

    expect(events.some((e) => e.type === "error" || e.type === "done")).toBe(false)
  })
})

describe("OpenAiSession tool surface", () => {
  it("the agent loop sends the full tool surface, byte-identical to the MCP surface", async () => {
    queueTurn({ textDeltas: ["ok"], status: "completed" })
    const { session } = makeSession()
    await session.send("hi")
    const names = lastCreateCall().tools!.map((t) => t.name)
    expect(new Set(names)).toEqual(new Set(getToolDefinitions().map((t) => t.name)))
  })
})

describe("OpenAiSession.structured", () => {
  const SCHEMA = {
    type: "object" as const,
    properties: { ok: { type: "boolean" as const } },
    required: ["ok"],
  }

  it("makes one constrained, tool-free, stateless call and returns the parsed result", async () => {
    queueStructured({ text: '{"ok": true}' })

    const { session } = makeSession()
    const result = await session.structured<{ ok: boolean }>([{ role: "user", content: "extract" }], SCHEMA)

    expect(result).toEqual({ ok: true })
    expect(mockCreate).toHaveBeenCalledTimes(1)
    const call = lastCreateCall()
    expect(call.tools).toBeUndefined()
    expect(call.store).toBe(false)
    expect(call.instructions).toBe("you are capy")
    expect(call.text).toEqual({
      format: { type: "json_schema", name: "structured_output", schema: SCHEMA, strict: false },
    })
  })

  it("sends strict on the format wrapper, not inside the schema, for a strict schema", async () => {
    queueStructured({ text: '{"ok": true}' })
    const STRICT_SCHEMA = {
      type: "object" as const,
      additionalProperties: false,
      strict: true,
      properties: { ok: { type: "boolean" as const } },
      required: ["ok"],
    }

    const { session } = makeSession()
    await session.structured([{ role: "user", content: "x" }], STRICT_SCHEMA)

    const { format } = lastCreateCall().text as { format: { strict: boolean; schema: Record<string, unknown> } }
    expect(format.strict).toBe(true)
    expect(format.schema).not.toHaveProperty("strict")
    expect(format.schema).toMatchObject({ additionalProperties: false })
  })

  it("forwards images as input_image and PDFs as input_file", async () => {
    queueStructured({ text: '{"ok": true}' })

    const { session } = makeSession()
    await session.structured(
      [
        {
          role: "user",
          content: [
            { type: "text", text: "read this receipt" },
            { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: "BBBB" },
              filename: "receipt.pdf",
            },
          ],
        },
      ],
      SCHEMA,
    )

    const content = lastCreateCall().input[0].content as Item[]
    expect(content.map((part) => part.type)).toEqual(["input_text", "input_image", "input_file"])
    expect(content[2]).toEqual({
      type: "input_file",
      filename: "receipt.pdf",
      file_data: "data:application/pdf;base64,BBBB",
    })
  })

  it("rejects when the model returns output that violates the schema", async () => {
    queueStructured({ text: '{"ok": "not a boolean"}' })

    const { session } = makeSession()
    await expect(session.structured([{ role: "user", content: "x" }], SCHEMA)).rejects.toThrowError(/boolean/i)
  })

  it("passes an assistant turn through as plain text content", async () => {
    queueStructured({ text: '{"ok": true}' })

    const { session } = makeSession()
    await session.structured(
      [
        { role: "user", content: "extract" },
        { role: "assistant", content: '{"ok": false}' },
        { role: "user", content: "redo it" },
      ],
      SCHEMA,
    )

    expect(lastCreateCall().input).toEqual([
      { role: "user", content: "extract" },
      { role: "assistant", content: '{"ok": false}' },
      { role: "user", content: "redo it" },
    ])
  })

  it("streams when onText is set, surfacing accumulated (not per-delta) text", async () => {
    queueTurn({ textDeltas: ['{"ok"', ": true}"], status: "completed" })
    const onText = vi.fn()

    const { session } = makeSession()
    const result = await session.structured<{ ok: boolean }>([{ role: "user", content: "extract" }], SCHEMA, { onText })

    expect(result).toEqual({ ok: true })
    expect(onText.mock.calls.map((c) => c[0])).toEqual(['{"ok"', '{"ok": true}'])
    const call = lastCreateCall()
    expect(call.stream).toBe(true)
    expect(call.text).toEqual({
      format: { type: "json_schema", name: "structured_output", schema: SCHEMA, strict: false },
    })
  })

  it("resolves the streaming call to the same value as the non-streaming path", async () => {
    const { session } = makeSession()
    queueTurn({ textDeltas: ['{"ok":', " true}"], status: "completed" })
    const streamed = await session.structured([{ role: "user", content: "extract" }], SCHEMA, { onText: () => {} })
    queueStructured({ text: '{"ok": true}' })
    const plain = await session.structured([{ role: "user", content: "extract" }], SCHEMA)

    expect(streamed).toEqual(plain)
  })

  it("rejects the streaming call when the request errors", async () => {
    queueTurn({ status: null, error: new Error("rate limited") })

    const { session } = makeSession()
    await expect(
      session.structured([{ role: "user", content: "x" }], SCHEMA, { onText: () => {} }),
    ).rejects.toThrow("rate limited")
  })

  it("rejects the streaming call when the stream aborts mid-iteration", async () => {
    queueTurn({ textDeltas: ['{"ok"', ": true}"], status: "completed" })

    const { session } = makeSession()
    const promise = session.structured([{ role: "user", content: "x" }], SCHEMA, { onText: () => {} })
    const results = mockCreate.mock.results
    const stream = (await results[results.length - 1].value) as { controller: AbortController }
    stream.controller.abort()
    await expect(promise).rejects.toThrow(/aborted/i)
  })

  it("reports a truncated reply as cut off, not as a parse error", async () => {
    const { session } = makeSession()
    queueStructured({ text: '{"ok": tr', status: "incomplete", incompleteReason: "max_output_tokens" })
    await expect(session.structured([{ role: "user", content: "x" }], SCHEMA)).rejects.toBeInstanceOf(CutOffError)

    queueTurn({ textDeltas: ['{"ok": tr'], status: "incomplete", incompleteReason: "max_output_tokens" })
    await expect(
      session.structured([{ role: "user", content: "x" }], SCHEMA, { onText: () => {} }),
    ).rejects.toBeInstanceOf(CutOffError)
  })

  it("reports a content filter as refused, not as cut off", async () => {
    const { session } = makeSession()
    queueStructured({ text: "", status: "incomplete", incompleteReason: "content_filter" })
    await expect(session.structured([{ role: "user", content: "x" }], SCHEMA)).rejects.toBeInstanceOf(RefusedError)

    queueTurn({ status: "incomplete", incompleteReason: "content_filter" })
    await expect(
      session.structured([{ role: "user", content: "x" }], SCHEMA, { onText: () => {} }),
    ).rejects.toBeInstanceOf(RefusedError)
  })

  it("reports a refusal as refused, not as a parse error", async () => {
    const { session } = makeSession()
    queueStructured({ text: "", refusal: "I can't help with that." })
    await expect(session.structured([{ role: "user", content: "x" }], SCHEMA)).rejects.toBeInstanceOf(RefusedError)

    queueTurn({ refusalDeltas: ["I can't ", "help with that."], status: "completed" })
    await expect(
      session.structured([{ role: "user", content: "x" }], SCHEMA, { onText: () => {} }),
    ).rejects.toBeInstanceOf(RefusedError)
  })
})

describe("OpenAiSession lifecycle", () => {
  it("a send issued while a stopped round winds down waits for it before touching history", async () => {
    queueTurn({ calls: [{ id: "call_a", name: "create_transaction", argFragments: ["{}"] }], status: "completed" })
    const tools = blockingTools()

    const { session } = makeSession()
    const first = session.send("Add it")
    await tools.started()
    await session.stop()
    queueTurn({ textDeltas: ["ok"], status: "completed" })
    const second = session.send("Next")
    tools.resolvers[0]("created")
    await Promise.all([first, second])

    expect(lastCreateCall().input.slice(2)).toEqual([
      { type: "function_call_output", call_id: "call_a", output: "created" },
      { role: "user", content: "Next" },
    ])
  })

  it("stop() mid-batch retracts the cards of calls that never run and reports only the run call", async () => {
    queueTurn({
      calls: [
        { id: "call_a", name: "create_transaction", argFragments: ["{}"] },
        { id: "call_b", name: "list_accounts", argFragments: ["{}"] },
        { id: "call_c", name: "list_categories", argFragments: ["{}"] },
      ],
      status: "completed",
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
      { type: "tool-result", tool: "create_transaction", id: "call_a", ok: true },
    ])
  })

  it("stop() in the tool phase leaves the finished stream un-aborted", async () => {
    queueTurn({ calls: [{ id: "call_a", name: "create_transaction", argFragments: ["{}"] }], status: "completed" })
    const tools = blockingTools()

    const { session } = makeSession()
    const sending = session.send("Add it")
    await tools.started()
    await session.stop()
    tools.resolvers[0]("created")
    await sending

    expect(abortSignals[0].aborted).toBe(false)
  })

  it("kill() during the tool loop answers the rest with STOPPED and emits nothing more", async () => {
    queueTurn({
      calls: [
        { id: "call_a", name: "create_transaction", argFragments: ["{}"] },
        { id: "call_b", name: "create_transaction", argFragments: ["{}"] },
      ],
      status: "completed",
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
    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(history(session).slice(-2)).toEqual([
      { type: "function_call_output", call_id: "call_a", output: "created" },
      { type: "function_call_output", call_id: "call_b", output: STOPPED_RESULT },
    ])
  })

  it("restart() waits for an in-flight tool before clearing history", async () => {
    queueTurn({ calls: [{ id: "call_a", name: "create_transaction", argFragments: ["{}"] }], status: "completed" })
    const tools = blockingTools()

    const { session } = makeSession()
    const sending = session.send("Add it")
    await tools.started()
    const restarting = session.restart()
    tools.resolvers[0]("created")
    await Promise.all([sending, restarting])

    expect(history(session)).toEqual([])
    queueTurn({ textDeltas: ["ok"], status: "completed" })
    await session.send("Fresh")
    expect(lastCreateCall().input).toEqual([{ role: "user", content: "Fresh" }])
  })

  it("Stop mid-text keeps the streamed text, marked as stopped, and drops the calls that never arrived", async () => {
    queueTurn({
      textDeltas: ["Let me", " check", " that"],
      calls: [{ id: "call_a", name: "list_transactions", argFragments: ["{}"] }],
      status: "completed",
    })

    const { session, events } = makeSession((e, s) => {
      if (e.type === "content" && JSON.stringify(e.blocks).includes("Let me check")) void s.stop()
    })
    await session.send("Hi")

    expect(mockRunTool).not.toHaveBeenCalled()
    expect(events.some((e) => e.type === "done" || e.type === "error")).toBe(false)
    expect(lastBlocks(events)).toEqual([{ type: "text", content: "Let me check" }])

    queueTurn({ textDeltas: ["ok"], status: "completed" })
    await session.send("Go on")
    expect(lastCreateCall().input).toEqual([
      { role: "user", content: "Hi" },
      { role: "assistant", content: `Let me check${STOPPED_MARKER}` },
      { role: "user", content: "Go on" },
    ])
  })

  it("a send whose content can't be converted reports an error and doesn't wedge the session", async () => {
    const { session, events } = makeSession()
    await session.send([42] as unknown as string)
    expect(events.at(-1)).toMatchObject({ type: "error", provider: "openai" })

    queueTurn({ textDeltas: ["ok"], status: "completed" })
    await session.send("Hi")
    expect(events.at(-1)).toEqual({ type: "done" })
  })
})

describe("OpenAiSession output cap", () => {
  const SCHEMA = {
    type: "object" as const,
    properties: { ok: { type: "boolean" as const } },
    required: ["ok"],
  }
  const CAP_ERROR =
    "max_output_tokens is too large: 32000. This model supports at most 16384 output tokens, whereas you provided 32000."

  it("retries once with the limit a max_output_tokens 400 names, and keeps it for the session", async () => {
    queueTurn({ status: null, error: apiError(400, CAP_ERROR) })
    queueTurn({ textDeltas: ["ok"], status: "completed" })

    const { session, events } = makeSession()
    await session.send("Hi")
    expect(lastCreateCall().max_output_tokens).toBe(16384)
    expect(events.at(-1)).toEqual({ type: "done" })

    queueStructured({ text: '{"ok": true}' })
    await session.structured([{ role: "user", content: "x" }], SCHEMA)
    expect(mockCreate).toHaveBeenCalledTimes(3)
    expect(lastCreateCall().max_output_tokens).toBe(16384)
  })

  it("a retry that 400s again surfaces the error and leaves the cap unchanged", async () => {
    queueTurn({ status: null, error: apiError(400, CAP_ERROR) })
    queueTurn({ status: null, error: apiError(400, "Invalid 'input[0].content'", "input") })

    const { session, events } = makeSession()
    await session.send("Hi")
    expect(mockCreate).toHaveBeenCalledTimes(2)
    expect(events.at(-1)).toMatchObject({ type: "error", status: 400, message: "Invalid 'input[0].content'" })

    queueTurn({ textDeltas: ["ok"], status: "completed" })
    await session.send("Again")
    expect(lastCreateCall().max_output_tokens).toBe(MAX_OUTPUT_TOKENS)
  })

  it("surfaces an unrelated 400 without retrying", async () => {
    queueTurn({ status: null, error: apiError(400, "Invalid 'input[0].content'", "input") })

    const { session, events } = makeSession()
    await session.send("Hi")
    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(events.at(-1)).toMatchObject({ type: "error", status: 400 })
  })

  it("structured() retries a cap 400 on both the plain and the streaming path", async () => {
    const { session } = makeSession()
    queueStructured({ error: apiError(400, CAP_ERROR) })
    queueStructured({ text: '{"ok": true}' })
    expect(await session.structured([{ role: "user", content: "x" }], SCHEMA)).toEqual({ ok: true })
    expect(lastCreateCall().max_output_tokens).toBe(16384)

    const fresh = makeSession().session
    queueTurn({ status: null, error: apiError(400, CAP_ERROR) })
    queueTurn({ textDeltas: ['{"ok": true}'], status: "completed" })
    expect(await fresh.structured([{ role: "user", content: "x" }], SCHEMA, { onText: () => {} })).toEqual({ ok: true })
    expect(lastCreateCall().max_output_tokens).toBe(16384)
  })
})
