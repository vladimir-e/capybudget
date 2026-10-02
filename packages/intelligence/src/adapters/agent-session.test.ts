import { describe, it, expect, vi, beforeEach } from "vitest"
import type { CurrencySettings } from "@capybudget/core"
import type { BudgetRepository, FileAdapter } from "@capybudget/persistence"
import type { ApiProvider } from "../config"
import type { ApiAdapterOptions } from "../factory"
import { REPLY_TOOL_CALL_BUDGET, getToolDefinitions } from "../tools"
import type { StreamEvent } from "../types"
import { MAX_OUTPUT_TOKENS, STOPPED_MARKER, STOPPED_RESULT, UNANSWERED_RESULT } from "./agent-turn"
import { FakeAnthropic, anthropicApiError, anthropicSdk } from "./test-doubles/anthropic-sdk"
import { FakeOpenAI, chatApiError, chatSdk, responsesApiError, responsesSdk } from "./test-doubles/openai-sdk"
import { blockingTools, lastBlocks, mockRunTool } from "./test-doubles/harness"
import { API_ADAPTERS } from "."

vi.mock("@anthropic-ai/sdk", async () => ({ default: (await import("./test-doubles/anthropic-sdk")).FakeAnthropic }))
vi.mock("openai", async () => ({ default: (await import("./test-doubles/openai-sdk")).FakeOpenAI }))
vi.mock("../tools", async (importOriginal) => (await import("./test-doubles/harness")).toolsWithMockedRun(importOriginal))

type Entry = { user: string } | { assistant: string } | { call: string } | { result: string; output: string }

interface ToolCall {
  id: string
  name: string
  input?: Record<string, unknown>
}

type Wire = Record<string, unknown>

/** Drives one adapter through its SDK fake, and reads its wire history back as provider-neutral entries. */
interface AdapterDriver {
  provider: ApiProvider
  reply(...deltas: string[]): void
  callTools(calls: readonly ToolCall[], leadingText?: string[]): void
  cutOff(text: string): void
  reject(err: Error): void
  failMidStream(text: string[], calls: readonly ToolCall[], err: Error): void
  structured(json: string): void
  apiError(status: number, message: string): Error
  connectionError(): Error
  capError(limit: number): Error
  requests(): number
  lastOutputCap(): number | undefined
  lastToolNames(): string[]
  signals(): AbortSignal[]
  sent(): Entry[]
  seedOpenCalls(history: Wire[], question: string, calls: readonly ToolCall[]): void
  transcript(history: readonly Wire[]): Entry[]
}

const argsOf = (call: ToolCall) => JSON.stringify(call.input ?? {})

function textParts(content: unknown, part: string): string[] {
  if (typeof content === "string") return [content]
  return (content as Wire[]).filter((p) => p.type === part).map((p) => p.text as string)
}

const anthropic: AdapterDriver = {
  provider: "anthropic",
  reply: (...textDeltas) => anthropicSdk.queueTurn({ textDeltas, stop_reason: "end_turn" }),
  callTools: (calls, textDeltas) =>
    anthropicSdk.queueTurn({
      textDeltas,
      toolUses: calls.map((c) => ({ id: c.id, name: c.name, input: c.input ?? {} })),
      stop_reason: "tool_use",
    }),
  cutOff: (text) => anthropicSdk.queueTurn({ textDeltas: [text], stop_reason: "max_tokens" }),
  reject: (error) => anthropicSdk.queueTurn({ stop_reason: null, error }),
  failMidStream: (textDeltas, calls, failAfter) =>
    anthropicSdk.queueTurn({
      textDeltas,
      toolUses: calls.map((c) => ({ id: c.id, name: c.name, input: c.input ?? {} })),
      stop_reason: null,
      failAfter,
    }),
  structured: (json) => anthropicSdk.queueTurn({ textDeltas: [json], stop_reason: "end_turn" }),
  apiError: anthropicApiError,
  connectionError: () => new FakeAnthropic.APIConnectionError("Connection error."),
  capError: (limit) =>
    anthropicApiError(400, `max_tokens: 32000 > ${limit}, which is the maximum allowed number of output tokens for claude-haiku`),
  requests: () => anthropicSdk.stream.mock.calls.length,
  lastOutputCap: () => anthropicSdk.lastStreamCall().max_tokens as number,
  lastToolNames: () => (anthropicSdk.lastStreamCall().tools as Wire[]).map((t) => t.name as string),
  signals: () => anthropicSdk.abortSignals,
  sent: () => anthropic.transcript(anthropicSdk.lastStreamCall().messages as Wire[]),
  seedOpenCalls: (history, question, calls) =>
    history.push(
      { role: "user", content: [{ type: "text", text: question }] },
      { role: "assistant", content: calls.map((c) => ({ type: "tool_use", id: c.id, name: c.name, input: c.input ?? {} })) },
    ),
  transcript: (history) =>
    history.flatMap((message): Entry[] => {
      const blocks: Wire[] = typeof message.content === "string" ? [{ type: "text", text: message.content }] : (message.content as Wire[])
      return blocks.flatMap((b): Entry[] => {
        if (b.type === "tool_use") return [{ call: b.id as string }]
        if (b.type === "tool_result") return [{ result: b.tool_use_id as string, output: b.content as string }]
        if (b.type !== "text") return []
        return [message.role === "user" ? { user: b.text as string } : { assistant: b.text as string }]
      })
    }),
}

const openai: AdapterDriver = {
  provider: "openai",
  reply: (...textDeltas) => responsesSdk.queueTurn({ textDeltas, status: "completed" }),
  callTools: (calls, textDeltas) =>
    responsesSdk.queueTurn({
      textDeltas,
      calls: calls.map((c) => ({ id: c.id, name: c.name, argFragments: [argsOf(c)] })),
      status: "completed",
    }),
  cutOff: (text) => responsesSdk.queueTurn({ textDeltas: [text], status: "incomplete", incompleteReason: "max_output_tokens" }),
  reject: (error) => responsesSdk.queueTurn({ status: null, error }),
  failMidStream: (textDeltas, calls, failAfter) =>
    responsesSdk.queueTurn({
      textDeltas,
      calls: calls.map((c) => ({ id: c.id, name: c.name, argFragments: [argsOf(c)] })),
      status: null,
      failAfter,
    }),
  structured: (text) => responsesSdk.queueStructured({ text }),
  apiError: (status, message) => responsesApiError(status, message, null),
  connectionError: () => new FakeOpenAI.APIConnectionError("Connection error."),
  capError: (limit) =>
    responsesApiError(
      400,
      `max_output_tokens is too large: 32000. This model supports at most ${limit} output tokens, whereas you provided 32000.`,
    ),
  requests: () => responsesSdk.create.mock.calls.length,
  lastOutputCap: () => responsesSdk.lastCall().max_output_tokens,
  lastToolNames: () => responsesSdk.lastCall().tools!.map((t) => t.name as string),
  signals: () => responsesSdk.abortSignals,
  sent: () => openai.transcript(responsesSdk.lastCall().input),
  seedOpenCalls: (history, question, calls) =>
    history.push(
      { role: "user", content: question },
      ...calls.map((c) => ({ type: "function_call", call_id: c.id, name: c.name, arguments: argsOf(c) })),
    ),
  transcript: (history) =>
    history.flatMap((item): Entry[] => {
      if (item.type === "function_call") return [{ call: item.call_id as string }]
      if (item.type === "function_call_output") return [{ result: item.call_id as string, output: item.output as string }]
      if (item.type === "message") return textParts(item.content, "output_text").map((assistant) => ({ assistant }))
      if (item.role === "user") return textParts(item.content, "input_text").map((user) => ({ user }))
      if (item.role === "assistant") return [{ assistant: item.content as string }]
      return []
    }),
}

const ollama: AdapterDriver = {
  provider: "ollama",
  reply: (...textDeltas) => chatSdk.queueTurn({ textDeltas, finish_reason: "stop" }),
  callTools: (calls, textDeltas) =>
    chatSdk.queueTurn({
      textDeltas,
      toolCallDeltas: calls.map((c, index) => ({ index, id: c.id, name: c.name, argFragments: [argsOf(c)] })),
      finish_reason: "tool_calls",
    }),
  cutOff: (text) => chatSdk.queueTurn({ textDeltas: [text], finish_reason: "length" }),
  reject: (error) => chatSdk.queueTurn({ finish_reason: null, error }),
  failMidStream: (textDeltas, calls, failAfter) =>
    chatSdk.queueTurn({
      textDeltas,
      toolCallDeltas: calls.map((c, index) => ({ index, id: c.id, name: c.name, argFragments: [argsOf(c)] })),
      finish_reason: null,
      failAfter,
    }),
  structured: (content) => chatSdk.queueStructured({ content }),
  apiError: chatApiError,
  connectionError: () => new FakeOpenAI.APIConnectionError("Connection error."),
  capError: (limit) =>
    chatApiError(400, `max_tokens is too large: 32000. This model supports at most ${limit} completion tokens, whereas you provided 32000.`),
  requests: () => chatSdk.create.mock.calls.length,
  lastOutputCap: () => chatSdk.lastCall().max_completion_tokens,
  lastToolNames: () => (chatSdk.lastCall().tools as Array<{ function: { name: string } }>).map((t) => t.function.name),
  signals: () => chatSdk.abortSignals,
  sent: () => ollama.transcript(chatSdk.lastCall().messages as Wire[]),
  seedOpenCalls: (history, question, calls) =>
    history.push(
      { role: "user", content: question },
      {
        role: "assistant",
        content: null,
        tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: argsOf(c) } })),
      },
    ),
  transcript: (history) =>
    history.flatMap((message): Entry[] => {
      if (message.role === "tool") return [{ result: message.tool_call_id as string, output: message.content as string }]
      if (message.role === "user") return textParts(message.content, "text").map((user) => ({ user }))
      if (message.role !== "assistant") return []
      const text: Entry[] = typeof message.content === "string" ? [{ assistant: message.content }] : []
      const calls = ((message.tool_calls ?? []) as Wire[]).map((c) => ({ call: c.id as string }))
      return [...text, ...calls]
    }),
}

const SCHEMA = { type: "object" as const, properties: { ok: { type: "boolean" as const } }, required: ["ok"] }
const FOLLOWUPS = { chips: [{ label: "More", prompt: "Tell me more" }] }

function wireHistory(session: object): Wire[] {
  return (session as { messages: Wire[] }).messages
}

beforeEach(() => {
  anthropicSdk.reset()
  responsesSdk.reset()
  chatSdk.reset()
  mockRunTool.mockReset()
})

describe.each([anthropic, openai, ollama])("$provider session contract", (d) => {
  function open(overrides: Partial<ApiAdapterOptions> = {}, onEvent?: (e: StreamEvent, stop: () => void) => void) {
    const events: StreamEvent[] = []
    const session = API_ADAPTERS[d.provider]({
      budgetPath: "/budget",
      systemPrompt: "you are capy",
      apiKey: "test-key",
      model: "test-model",
      onEvent: (e) => {
        events.push(e)
        onEvent?.(e, () => void session.stop())
      },
      repo: {} as BudgetRepository,
      fileAdapter: {} as FileAdapter,
      currency: "USD",
      ...overrides,
    })
    return { session, events, history: () => d.transcript(wireHistory(session)) }
  }

  describe("a turn", () => {
    it("streams cumulative content and ends with done", async () => {
      d.reply("Hello", ", world")

      const { session, events } = open()
      await session.send("Hi")

      expect(events).toEqual([
        { type: "content", blocks: [{ type: "text", content: "Hello" }] },
        { type: "content", blocks: [{ type: "text", content: "Hello, world" }] },
        { type: "done" },
      ])
    })

    it("streams with the raised output cap", async () => {
      d.reply("ok")
      const { session } = open()
      await session.send("Hi")
      expect(d.lastOutputCap()).toBe(MAX_OUTPUT_TOKENS)
    })

    it("sends the full tool surface, the same one the MCP server serves", async () => {
      d.reply("ok")
      const { session } = open()
      await session.send("hi")

      const names = d.lastToolNames()
      expect(new Set(names)).toEqual(new Set(getToolDefinitions().map((t) => t.name)))
      expect(names).toEqual(expect.arrayContaining(["render_table", "create_transaction", "start_import"]))
    })
  })

  describe("tool rounds", () => {
    it("walks a multi-turn tool loop, threading each result back to the model", async () => {
      d.callTools([{ id: "call_search", name: "search_transactions", input: { query: "Apple" } }])
      d.callTools([{ id: "call_group", name: "group_transactions", input: { groupBy: ["merchant"], metrics: ["sum"] } }])
      d.reply("You spent $312 across 8 Apple charges.")
      mockRunTool.mockResolvedValueOnce("rows").mockResolvedValueOnce("groups")

      const { session, events } = open()
      await session.send("How much have I spent at Apple?")

      expect(mockRunTool).toHaveBeenNthCalledWith(
        1,
        "search_transactions",
        { query: "Apple" },
        expect.objectContaining({ budgetPath: "/budget", currency: "USD" }),
      )
      expect(mockRunTool).toHaveBeenNthCalledWith(2, "group_transactions", { groupBy: ["merchant"], metrics: ["sum"] }, expect.anything())
      expect(d.sent()).toEqual([
        { user: "How much have I spent at Apple?" },
        { call: "call_search" },
        { result: "call_search", output: "rows" },
        { call: "call_group" },
        { result: "call_group", output: "groups" },
      ])
      expect(events.at(-1)).toEqual({ type: "done" })
    })

    it("reads currencies live at tool-run time, so a rate edit lands without a session rebuild", async () => {
      let live: Record<string, CurrencySettings> = { EUR: { decimals: 2, symbolPosition: "before" } }
      d.callTools([{ id: "call_add", name: "create_transaction" }])
      d.reply("Added.")
      mockRunTool.mockResolvedValueOnce("{}")

      const { session } = open({
        currency: "EUR",
        currencies: { EUR: { decimals: 2, symbolPosition: "before" } },
        getCurrencies: () => live,
      })
      live = { ...live, RUB: { decimals: 0, symbolPosition: "after", rate: 0.0125, rateSource: "manual" } }
      await session.send("Add a RUB expense")

      expect(mockRunTool).toHaveBeenCalledWith("create_transaction", {}, expect.objectContaining({ currencies: live }))
    })

    it("reports each call's outcome and marks its card done or failed", async () => {
      d.callTools([
        { id: "call_ok", name: "create_transaction" },
        { id: "call_err", name: "create_transaction" },
      ])
      d.reply("Sorry.")
      mockRunTool.mockResolvedValueOnce("{}").mockRejectedValueOnce(new Error("disk full"))

      const { session, events } = open()
      await session.send("Add these")

      expect(events.filter((e) => e.type === "tool-result")).toEqual([
        { type: "tool-result", tool: "create_transaction", id: "call_ok", ok: true },
        { type: "tool-result", tool: "create_transaction", id: "call_err", ok: false },
      ])
      expect(lastBlocks(events)).toEqual([
        { type: "tool-activity", tool: "create_transaction", status: "done", id: "call_ok" },
        { type: "tool-activity", tool: "create_transaction", status: "failed", id: "call_err" },
        { type: "text", content: "Sorry." },
      ])
      expect(d.sent()).toContainEqual({ result: "call_err", output: "Error: disk full" })
    })

    it("shows a render tool's block instead of an activity card", async () => {
      d.callTools([{ id: "call_table", name: "render_table", input: { headers: ["A", "B"], rows: [["1", "2"]] } }])
      d.reply("done")
      mockRunTool.mockResolvedValueOnce("Rendered.")

      const { session, events } = open()
      await session.send("Show me a table")

      const blocks = events.flatMap((e) => (e.type === "content" ? e.blocks : []))
      expect(blocks).toContainEqual({ type: "table", headers: ["A", "B"], rows: [["1", "2"]] })
      expect(blocks.some((b) => b.type === "tool-activity")).toBe(false)
    })

    it("accumulates render blocks across loop iterations", async () => {
      d.callTools(
        [{ id: "call_donut", name: "render_chart", input: { title: "Spending", type: "donut", data: [{ label: "Food", value: 50 }] } }],
        ["Here's the split:"],
      )
      d.callTools([{ id: "call_table", name: "render_table", input: { headers: ["Category", "Amount"], rows: [["Food", "$50"]] } }])
      d.reply("done")
      mockRunTool.mockResolvedValue("Rendered.")

      const { session, events } = open()
      await session.send("Breakdown please")

      expect(lastBlocks(events).map((b) => b.type)).toEqual(["text", "donut-chart", "table", "text"])
    })

    it("treats render_followups as terminal and keeps its call answered", async () => {
      d.callTools([{ id: "call_followups", name: "render_followups", input: FOLLOWUPS }], ["Done."])
      mockRunTool.mockResolvedValueOnce("Rendered.")

      const { session, events } = open()
      await session.send("How much did I spend?")

      expect(d.requests()).toBe(1)
      expect(events.filter((e) => e.type === "done")).toHaveLength(1)
      expect(events.at(-1)).toEqual({ type: "done" })

      d.reply("next")
      await session.send("Next question")
      expect(d.sent()).toContainEqual({ result: "call_followups", output: "Rendered." })
    })

    it("continues the loop when render_followups fails validation, so the model can recover", async () => {
      d.callTools([{ id: "call_followups", name: "render_followups", input: { chips: [] } }])
      d.reply("Here's a recap instead.")
      mockRunTool.mockRejectedValueOnce(new Error("Invalid input: render_followups expects at least one chip."))

      const { session, events } = open()
      await session.send("How much did I spend?")

      expect(d.requests()).toBe(2)
      expect(events).toContainEqual({ type: "tool-result", tool: "render_followups", id: "call_followups", ok: false })
      expect(d.sent()).toContainEqual({
        result: "call_followups",
        output: "Error: Invalid input: render_followups expects at least one chip.",
      })
      expect(lastBlocks(events)).toContainEqual({ type: "text", content: "Here's a recap instead." })
      expect(events.at(-1)).toEqual({ type: "done" })
    })

    it("runs an action tool bundled with render_followups, then exits once", async () => {
      d.callTools([
        { id: "call_action", name: "list_accounts" },
        { id: "call_followups", name: "render_followups", input: FOLLOWUPS },
      ])
      mockRunTool.mockResolvedValueOnce("checking $1.00").mockResolvedValueOnce("Rendered.")

      const { session, events } = open()
      await session.send("Show me balances")

      expect(d.requests()).toBe(1)
      expect(mockRunTool.mock.calls.map(([name]) => name)).toEqual(["list_accounts", "render_followups"])
      expect(events.filter((e) => e.type === "tool-result").map((e) => e.type === "tool-result" && e.id)).toEqual([
        "call_action",
        "call_followups",
      ])
      expect(events.filter((e) => e.type === "done")).toHaveLength(1)
    })
  })

  describe("the per-reply tool budget", () => {
    function loopForever() {
      for (let i = 0; i <= REPLY_TOOL_CALL_BUDGET; i++) d.callTools([{ id: `call_${i}`, name: "list_accounts" }])
      mockRunTool.mockResolvedValue("ok")
    }

    it("ends the reply as budgetExhausted once it is spent", async () => {
      loopForever()

      const { session, events, history } = open()
      await session.send("Loop forever")

      expect(mockRunTool).toHaveBeenCalledTimes(REPLY_TOOL_CALL_BUDGET)
      expect(events.at(-1)).toMatchObject({ type: "error", code: "budgetExhausted", message: expect.stringMatching(/budget exhausted/i) })
      expect(events.some((e) => e.type === "done")).toBe(false)
      expect(history().at(-1)).toEqual({ result: `call_${REPLY_TOOL_CALL_BUDGET}`, output: expect.stringMatching(/budget exhausted/i) })
    })

    it("refills for the next send", async () => {
      loopForever()
      const { session } = open()
      await session.send("Loop forever")
      mockRunTool.mockClear()

      d.callTools([{ id: "call_next", name: "list_accounts" }])
      d.reply("Done.")
      await session.send("Keep going")

      expect(mockRunTool).toHaveBeenCalledTimes(1)
    })
  })

  describe("stop and kill", () => {
    it("stop() mid-batch finishes the running tool, runs no more, and keeps the round answered", async () => {
      d.callTools([
        { id: "call_a", name: "create_transaction" },
        { id: "call_b", name: "create_transaction" },
        { id: "call_c", name: "create_transaction" },
      ])
      const tools = blockingTools()

      const { session, events } = open()
      const sending = session.send("Add these")
      await tools.started()
      await session.stop()
      tools.resolvers[0]("created a")
      await sending

      expect(mockRunTool).toHaveBeenCalledTimes(1)
      expect(events.some((e) => e.type === "done" || e.type === "error")).toBe(false)

      d.reply("ok")
      await session.send("Hi again")
      expect(d.sent()).toEqual([
        { user: "Add these" },
        { call: "call_a" },
        { call: "call_b" },
        { call: "call_c" },
        { result: "call_a", output: "created a" },
        { result: "call_b", output: STOPPED_RESULT },
        { result: "call_c", output: STOPPED_RESULT },
        { user: "Hi again" },
      ])
    })

    it("stop() mid-batch retracts the cards of calls that never run and reports only the run call", async () => {
      d.callTools([
        { id: "call_a", name: "create_transaction" },
        { id: "call_b", name: "list_accounts" },
        { id: "call_c", name: "list_categories" },
      ])
      const tools = blockingTools()

      const { session, events } = open()
      const sending = session.send("Add these")
      await tools.started()
      await session.stop()
      const afterStop = events.length
      tools.resolvers[0]("created")
      await sending

      expect(lastBlocks(events)).toEqual([{ type: "tool-activity", tool: "create_transaction", status: "running", id: "call_a" }])
      expect(events.slice(afterStop)).toEqual([{ type: "tool-result", tool: "create_transaction", id: "call_a", ok: true }])
    })

    it("stop() in the tool phase leaves the finished stream un-aborted", async () => {
      d.callTools([{ id: "call_a", name: "create_transaction" }])
      const tools = blockingTools()

      const { session } = open()
      const sending = session.send("Add it")
      await tools.started()
      await session.stop()
      tools.resolvers[0]("created")
      await sending

      expect(d.signals()[0].aborted).toBe(false)
    })

    it("stop() mid-stream aborts the request and reports nothing — no done, no abort error", async () => {
      d.reply("One", " two", " three")

      const { session, events } = open({}, (e, stop) => {
        if (e.type === "content") stop()
      })
      await session.send("Hi")

      expect(d.signals()[0].aborted).toBe(true)
      expect(events.filter((e) => e.type !== "content")).toEqual([])
      expect(lastBlocks(events)).toEqual([{ type: "text", content: "One" }])
    })

    it("stop() mid-text keeps the streamed text, marked as stopped, and drops the calls that never arrived", async () => {
      d.callTools([{ id: "call_a", name: "list_transactions" }], ["Let me", " check", " that"])

      const { session, events } = open({}, (e, stop) => {
        if (e.type === "content" && JSON.stringify(e.blocks).includes("Let me check")) stop()
      })
      await session.send("Hi")

      expect(mockRunTool).not.toHaveBeenCalled()
      expect(events.some((e) => e.type === "done" || e.type === "error")).toBe(false)
      expect(lastBlocks(events)).toEqual([{ type: "text", content: "Let me check" }])

      d.reply("ok")
      await session.send("Go on")
      expect(d.sent()).toEqual([{ user: "Hi" }, { assistant: `Let me check${STOPPED_MARKER}` }, { user: "Go on" }])
    })

    it("a send issued while a stopped round winds down waits for it before touching history", async () => {
      d.callTools([{ id: "call_a", name: "create_transaction" }])
      const tools = blockingTools()

      const { session } = open()
      const first = session.send("Add it")
      await tools.started()
      await session.stop()
      d.reply("ok")
      const second = session.send("Next")
      tools.resolvers[0]("created")
      await Promise.all([first, second])

      expect(d.sent()).toEqual([{ user: "Add it" }, { call: "call_a" }, { result: "call_a", output: "created" }, { user: "Next" }])
    })

    it("a second stop() cancels a send queued behind the stopped round", async () => {
      d.callTools([{ id: "call_a", name: "create_transaction" }])
      const tools = blockingTools()

      const { session, events, history } = open()
      const first = session.send("Add it")
      await tools.started()
      expect(session.hasQueuedSend).toBe(false)
      await session.stop()
      const queued = session.send("Next")
      expect(session.hasQueuedSend).toBe(true)
      await session.stop()
      expect(session.hasQueuedSend).toBe(false)
      tools.resolvers[0]("created")
      await Promise.all([first, queued])

      expect(d.requests()).toBe(1)
      expect(events.some((e) => e.type === "done" || e.type === "error")).toBe(false)
      expect(history().at(-1)).toEqual({ result: "call_a", output: "created" })
    })

    it("kill() mid-batch answers the rest with STOPPED, emits only the running call's tool-result, and drops the queued send", async () => {
      d.callTools([
        { id: "call_a", name: "create_transaction" },
        { id: "call_b", name: "create_transaction" },
      ])
      const tools = blockingTools()

      const { session, events, history } = open()
      const sending = session.send("Add these")
      await tools.started()
      const queued = session.send("And another")
      await session.kill()
      const afterKill = events.length
      tools.resolvers[0]("created")
      await Promise.all([sending, queued])

      expect(events.slice(afterKill)).toEqual([{ type: "tool-result", tool: "create_transaction", id: "call_a", ok: true }])
      expect(d.requests()).toBe(1)
      expect(history().slice(-2)).toEqual([
        { result: "call_a", output: "created" },
        { result: "call_b", output: STOPPED_RESULT },
      ])
    })
  })

  describe("failures", () => {
    it("reports a failed request as an error stamped with the provider, never done", async () => {
      d.reject(new Error("boom"))

      const { session, events } = open()
      await session.send("Hi")

      expect(events).toEqual([{ type: "error", message: "boom", provider: d.provider }])
    })

    it("reports a 429 as rateLimited", async () => {
      d.reject(d.apiError(429, "Rate limit reached"))

      const { session, events } = open()
      await session.send("hi")

      expect(events.at(-1)).toMatchObject({ type: "error", code: "rateLimited", status: 429, provider: d.provider })
    })

    it("reports a provider it can't reach as unreachable", async () => {
      d.reject(d.connectionError())

      const { session, events } = open()
      await session.send("hi")

      expect(events.at(-1)).toMatchObject({ type: "error", code: "unreachable", provider: d.provider })
    })

    it("stamps the provider on a cut-off reply's error", async () => {
      d.cutOff("Half")

      const { session, events } = open()
      await session.send("hi")

      expect(events.at(-1)).toMatchObject({ type: "error", code: "cutOff", provider: d.provider })
    })

    it("a send whose content can't be converted reports an error and doesn't wedge the session", async () => {
      const { session, events } = open()
      await session.send([42] as unknown as string)
      expect(events.at(-1)).toMatchObject({ type: "error", provider: d.provider })

      d.reply("ok")
      await session.send("Hi")
      expect(events.at(-1)).toEqual({ type: "done" })
    })

    it("an error mid-stream keeps the text before any call, in history and on screen", async () => {
      d.failMidStream(["Partial ", "answer"], [{ id: "call_a", name: "create_transaction" }], new Error("network lost"))

      const { session, events, history } = open()
      await session.send("q")

      expect(history()).toEqual([{ user: "q" }, { assistant: "Partial answer" }])
      expect(lastBlocks(events)).toEqual([{ type: "text", content: "Partial answer" }])
      expect(events.at(-1)).toMatchObject({ type: "error", message: "network lost", provider: d.provider })
      expect(mockRunTool).not.toHaveBeenCalled()
    })
  })

  describe("rollback", () => {
    it("a request the provider rejects before any reply leaves no trace in history", async () => {
      d.reject(d.apiError(400, "Image does not match the provided media type"))

      const { session, events } = open()
      await session.send([
        { type: "text", text: "what's on this receipt?" },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
      ])
      expect(events.at(-1)).toMatchObject({ type: "error", status: 400, provider: d.provider, rolledBack: true })
      expect(wireHistory(session)).toEqual([])

      d.reply("Hi")
      await session.send("hello")
      expect(d.sent()).toEqual([{ user: "hello" }])
    })

    it("a rejected send after a terminal-tool exit restores history exactly", async () => {
      d.callTools([{ id: "call_followups", name: "render_followups", input: FOLLOWUPS }])
      mockRunTool.mockResolvedValueOnce("Rendered.")
      const { session } = open()
      await session.send("First")
      const before = structuredClone(wireHistory(session))

      d.reject(d.apiError(400, "image exceeds 5 MB maximum"))
      await session.send("Poisoned")
      expect(wireHistory(session)).toEqual(before)

      d.reply("Reply")
      await session.send("Second")
      expect(d.sent()).not.toContainEqual({ user: "Poisoned" })
      expect(d.sent().at(-1)).toEqual({ user: "Second" })
    })

    it.each([
      ["a 429", (d: AdapterDriver) => d.apiError(429, "Rate limit reached")],
      ["a 5xx", (d: AdapterDriver) => d.apiError(500, "server error")],
      ["a dropped connection", () => new Error("network lost")],
    ])("keeps the question in history after %s, so the next send carries it", async (_, error) => {
      d.reject(error(d))

      const { session, events } = open()
      await session.send("first")
      expect(events.at(-1)).toMatchObject({ type: "error" })
      expect(events.at(-1)).not.toHaveProperty("rolledBack")

      d.reply("ok")
      await session.send("again")
      expect(d.sent()).toEqual([{ user: "first" }, { user: "again" }])
    })

    it("a failure after a stored reply never rolls history back", async () => {
      d.callTools([{ id: "call_a", name: "list_accounts" }])
      d.reject(d.apiError(500, "server error"))
      mockRunTool.mockResolvedValue("accounts")

      const { session, history } = open()
      await session.send("accounts?")

      expect(history()).toEqual([{ user: "accounts?" }, { call: "call_a" }, { result: "call_a", output: "accounts" }])
    })
  })

  describe("the output cap", () => {
    it("retries once with the limit a cap 400 names, and keeps it for the session", async () => {
      d.reject(d.capError(16384))
      d.reply("ok")

      const { session, events } = open()
      await session.send("Hi")
      expect(d.requests()).toBe(2)
      expect(d.lastOutputCap()).toBe(16384)
      expect(events.at(-1)).toEqual({ type: "done" })

      d.structured('{"ok": true}')
      await session.structured([{ role: "user", content: "x" }], SCHEMA)
      expect(d.requests()).toBe(3)
      expect(d.lastOutputCap()).toBe(16384)
    })

    it("a retry that 400s again surfaces that error and leaves the cap unchanged", async () => {
      d.reject(d.capError(16384))
      d.reject(d.apiError(400, "messages: text content blocks must be non-empty"))

      const { session, events } = open()
      await session.send("Hi")
      expect(d.requests()).toBe(2)
      expect(events.at(-1)).toMatchObject({ type: "error", status: 400, message: "messages: text content blocks must be non-empty" })

      d.reply("ok")
      await session.send("Again")
      expect(d.lastOutputCap()).toBe(MAX_OUTPUT_TOKENS)
    })

    it("surfaces an unrelated 400 without retrying", async () => {
      d.reject(d.apiError(400, "messages: roles must alternate"))

      const { session, events } = open()
      await session.send("Hi")
      expect(d.requests()).toBe(1)
      expect(events.at(-1)).toMatchObject({ type: "error", status: 400 })
    })
  })

  describe("history repair", () => {
    it("answers a trailing turn's unanswered calls before appending the next user message", async () => {
      const { session } = open()
      d.seedOpenCalls(wireHistory(session), "Add it", [
        { id: "call_a", name: "create_transaction" },
        { id: "call_b", name: "create_transaction" },
      ])

      d.reply("ok")
      await session.send("Hello?")

      expect(d.sent()).toEqual([
        { user: "Add it" },
        { call: "call_a" },
        { call: "call_b" },
        { result: "call_a", output: UNANSWERED_RESULT },
        { result: "call_b", output: UNANSWERED_RESULT },
        { user: "Hello?" },
      ])
    })
  })
})
