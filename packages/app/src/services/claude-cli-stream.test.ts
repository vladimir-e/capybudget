import { describe, it, expect } from "vitest"
import { parseStreamLine } from "@/services/claude-cli-stream"

describe("parseStreamLine", () => {
  describe("empty / invalid input", () => {
    it("returns [] for empty string", () => {
      expect(parseStreamLine("")).toEqual([])
    })

    it("returns [] for whitespace-only string", () => {
      expect(parseStreamLine("   \t\n  ")).toEqual([])
    })

    it("returns [] for invalid JSON", () => {
      expect(parseStreamLine("not json at all")).toEqual([])
    })

    it("returns [] for unknown event type", () => {
      expect(parseStreamLine(JSON.stringify({ type: "ping" }))).toEqual([])
    })
  })

  describe("assistant text blocks", () => {
    it("parses a text block into a content event", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Hello there" }],
        },
      })

      expect(parseStreamLine(line)).toEqual([
        {
          type: "content",
          blocks: [{ type: "text", content: "Hello there" }],
        },
      ])
    })

    it("cumulative text replaces — parser just relays full blocks", () => {
      const first = JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Hel" }],
        },
      })
      const second = JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Hello world" }],
        },
      })

      expect(parseStreamLine(first)).toEqual([
        { type: "content", blocks: [{ type: "text", content: "Hel" }] },
      ])
      expect(parseStreamLine(second)).toEqual([
        { type: "content", blocks: [{ type: "text", content: "Hello world" }] },
      ])
    })
  })

  describe("render tools — unprefixed names", () => {
    it("maps render_table to a table ContentBlock", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "render_table",
              input: {
                headers: ["Account", "Balance"],
                rows: [["Checking", "$1,000.00"]],
              },
            },
          ],
        },
      })

      expect(parseStreamLine(line)).toEqual([
        {
          type: "content",
          blocks: [
            {
              type: "table",
              headers: ["Account", "Balance"],
              rows: [["Checking", "$1,000.00"]],
            },
          ],
        },
      ])
    })

    it("maps render_bar_chart to a bar-chart ContentBlock", () => {
      const data = [
        { label: "Food", value: 450 },
        { label: "Rent", value: 1200 },
      ]
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "render_bar_chart",
              input: { title: "Spending by Category", data },
            },
          ],
        },
      })

      expect(parseStreamLine(line)).toEqual([
        {
          type: "content",
          blocks: [{ type: "bar-chart", title: "Spending by Category", data }],
        },
      ])
    })

    it("maps render_donut_chart to a donut-chart ContentBlock", () => {
      const data = [
        { label: "Fixed", value: 60 },
        { label: "Variable", value: 40 },
      ]
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "render_donut_chart",
              input: { title: "Budget Split", data },
            },
          ],
        },
      })

      expect(parseStreamLine(line)).toEqual([
        {
          type: "content",
          blocks: [{ type: "donut-chart", title: "Budget Split", data }],
        },
      ])
    })

    it("maps render_followups to a followups ContentBlock", () => {
      const chips = [
        { label: "Compare to 2023", prompt: "How does that compare to 2023?" },
        { label: "Monthly breakdown", prompt: "Show me the monthly breakdown." },
      ]
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "render_followups",
              input: { chips },
            },
          ],
        },
      })

      expect(parseStreamLine(line)).toEqual([
        {
          type: "content",
          blocks: [{ type: "followups", chips }],
        },
      ])
    })
  })

  describe("render tools — MCP-prefixed names", () => {
    it("strips mcp__capy__ prefix from render_table", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "mcp__capy__render_table",
              input: {
                headers: ["Month", "Total"],
                rows: [["Jan", "$500"]],
              },
            },
          ],
        },
      })

      expect(parseStreamLine(line)).toEqual([
        {
          type: "content",
          blocks: [
            {
              type: "table",
              headers: ["Month", "Total"],
              rows: [["Jan", "$500"]],
            },
          ],
        },
      ])
    })
  })

  describe("non-render tool_use → tool-activity block", () => {
    it("emits tool-activity block for a non-render tool with MCP prefix", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "mcp__capy__list_accounts",
              input: {},
            },
          ],
        },
      })

      expect(parseStreamLine(line)).toEqual([
        {
          type: "content",
          blocks: [{ type: "tool-activity", tool: "list_accounts" }],
        },
      ])
    })

    it("emits tool-activity block for a non-render tool without prefix", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "get_transactions",
              input: { accountId: "abc" },
            },
          ],
        },
      })

      expect(parseStreamLine(line)).toEqual([
        {
          type: "content",
          blocks: [{ type: "tool-activity", tool: "get_transactions" }],
        },
      ])
    })
  })

  describe("multiple content blocks — preserved in order", () => {
    it("preserves text + render blocks together", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Here's your spending:" },
            {
              type: "tool_use",
              name: "mcp__capy__render_table",
              input: {
                headers: ["Category", "Amount"],
                rows: [["Food", "$200"]],
              },
            },
          ],
        },
      })

      const events = parseStreamLine(line)
      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({
        type: "content",
        blocks: [
          { type: "text", content: "Here's your spending:" },
          {
            type: "table",
            headers: ["Category", "Amount"],
            rows: [["Food", "$200"]],
          },
        ],
      })
    })

    it("preserves text before and after tool calls", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Pretty light last week." },
            {
              type: "tool_use",
              name: "mcp__capy__list_transactions",
              input: {},
            },
            { type: "text", text: "Here are the details:" },
          ],
        },
      })

      const events = parseStreamLine(line)
      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({
        type: "content",
        blocks: [
          { type: "text", content: "Pretty light last week." },
          { type: "tool-activity", tool: "list_transactions" },
          { type: "text", content: "Here are the details:" },
        ],
      })
    })

    it("handles tool-activity + render blocks together", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "mcp__capy__list_accounts",
              input: {},
            },
            {
              type: "tool_use",
              name: "mcp__capy__render_bar_chart",
              input: {
                title: "Balances",
                data: [{ label: "Checking", value: 5000 }],
              },
            },
          ],
        },
      })

      const events = parseStreamLine(line)
      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({
        type: "content",
        blocks: [
          { type: "tool-activity", tool: "list_accounts" },
          {
            type: "bar-chart",
            title: "Balances",
            data: [{ label: "Checking", value: 5000 }],
          },
        ],
      })
    })
  })

  describe("result event", () => {
    it("does NOT emit done on a clean result without cycleState (no safety net wired)", () => {
      const line = JSON.stringify({ type: "result" })
      expect(parseStreamLine(line)).toEqual([])
    })

    it("does NOT emit a duplicate done when the assistant stop_reason already fired one", () => {
      const cycleState = { doneEmitted: false }
      const assistantEvents = parseStreamLine(
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "All done." }],
            stop_reason: "end_turn",
          },
        }),
        undefined,
        cycleState,
      )
      expect(assistantEvents).toContainEqual({ type: "done" })
      expect(cycleState.doneEmitted).toBe(true)

      const resultEvents = parseStreamLine(
        JSON.stringify({ type: "result" }),
        undefined,
        cycleState,
      )
      expect(resultEvents).toEqual([])
    })

    it("emits done off the result line as a safety net when no stop_reason fired", () => {
      const cycleState = { doneEmitted: false }
      parseStreamLine(
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "partial" }] },
        }),
        undefined,
        cycleState,
      )
      expect(cycleState.doneEmitted).toBe(false)

      const resultEvents = parseStreamLine(
        JSON.stringify({ type: "result" }),
        undefined,
        cycleState,
      )
      expect(resultEvents).toEqual([{ type: "done" }])
      expect(cycleState.doneEmitted).toBe(true)
    })

    it("emits error when the result carries is_error (no safety-net done)", () => {
      const cycleState = { doneEmitted: false }
      const line = JSON.stringify({
        type: "result",
        subtype: "error_max_turns",
        is_error: true,
        errors: ["Reached maximum number of turns (100)"],
      })
      expect(parseStreamLine(line, undefined, cycleState)).toEqual([
        { type: "error", message: "Reached maximum number of turns (100)" },
      ])
      expect(cycleState.doneEmitted).toBe(false)
    })

    it("falls back to a generic message when is_error has no details", () => {
      const line = JSON.stringify({ type: "result", is_error: true })
      expect(parseStreamLine(line)).toEqual([
        { type: "error", message: "Session terminated with an error." },
      ])
    })
  })

  describe("assistant stop_reason → done", () => {
    it("emits done after content when the assistant turn has stop_reason: end_turn", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "All done." }],
          stop_reason: "end_turn",
        },
      })
      expect(parseStreamLine(line)).toEqual([
        { type: "content", blocks: [{ type: "text", content: "All done." }] },
        { type: "done" },
      ])
    })

    it("does not emit done when stop_reason is tool_use (more turns coming)", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "mcp__capy__list_accounts",
              input: {},
            },
          ],
          stop_reason: "tool_use",
        },
      })
      expect(parseStreamLine(line)).toEqual([
        {
          type: "content",
          blocks: [{ type: "tool-activity", tool: "list_accounts" }],
        },
      ])
    })

    it("emits done for any terminal stop_reason (e.g. max_tokens)", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Cut off." }],
          stop_reason: "max_tokens",
        },
      })
      expect(parseStreamLine(line)).toEqual([
        { type: "content", blocks: [{ type: "text", content: "Cut off." }] },
        { type: "done" },
      ])
    })
  })

  describe("error event", () => {
    it("emits error with message", () => {
      const line = JSON.stringify({
        type: "error",
        error: { message: "Rate limit exceeded" },
      })

      expect(parseStreamLine(line)).toEqual([
        { type: "error", message: "Rate limit exceeded" },
      ])
    })

    it("falls back to 'Unknown error' when message is missing", () => {
      const line = JSON.stringify({
        type: "error",
        error: {},
      })

      expect(parseStreamLine(line)).toEqual([
        { type: "error", message: "Unknown error" },
      ])
    })

    it("falls back to 'Unknown error' when error object is missing", () => {
      const line = JSON.stringify({ type: "error" })

      expect(parseStreamLine(line)).toEqual([
        { type: "error", message: "Unknown error" },
      ])
    })
  })

  describe("render tool input validation", () => {
    it("skips render_table with missing headers", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "render_table",
              input: { rows: [["a"]] },
            },
          ],
        },
      })
      expect(parseStreamLine(line)).toEqual([])
    })

    it("skips render_table with missing rows", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "render_table",
              input: { headers: ["A"] },
            },
          ],
        },
      })
      expect(parseStreamLine(line)).toEqual([])
    })

    it("skips render_bar_chart with missing title", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "render_bar_chart",
              input: { data: [{ label: "X", value: 1 }] },
            },
          ],
        },
      })
      expect(parseStreamLine(line)).toEqual([])
    })

    it("skips render_donut_chart with missing data", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "render_donut_chart",
              input: { title: "Test" },
            },
          ],
        },
      })
      expect(parseStreamLine(line)).toEqual([])
    })

    it("skips render_followups with empty chips array", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "render_followups",
              input: { chips: [] },
            },
          ],
        },
      })
      expect(parseStreamLine(line)).toEqual([])
    })

    it("filters malformed chips and keeps the valid ones", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "render_followups",
              input: {
                chips: [
                  { label: "Good chip", prompt: "Good prompt" },
                  { label: "", prompt: "missing label" },
                  { label: "missing prompt" },
                  null,
                  { label: "Another good", prompt: "Another good prompt" },
                ],
              },
            },
          ],
        },
      })
      expect(parseStreamLine(line)).toEqual([
        {
          type: "content",
          blocks: [
            {
              type: "followups",
              chips: [
                { label: "Good chip", prompt: "Good prompt" },
                { label: "Another good", prompt: "Another good prompt" },
              ],
            },
          ],
        },
      ])
    })
  })

  describe("messageId propagation", () => {
    it("attaches message.id to the content event when present", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          id: "msg_abc123",
          content: [{ type: "text", text: "Hello" }],
        },
      })

      expect(parseStreamLine(line)).toEqual([
        {
          type: "content",
          blocks: [{ type: "text", content: "Hello" }],
          messageId: "msg_abc123",
        },
      ])
    })

    it("omits messageId when the assistant event has no message.id", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Hello" }],
        },
      })

      const events = parseStreamLine(line)
      expect(events).toHaveLength(1)
      expect(events[0]).not.toHaveProperty("messageId")
    })
  })

  describe("tool_result → tool-result event", () => {
    it("emits a tool-result event from a user message carrying a tool_result block", () => {
      const registry = new Map<string, string>()
      parseStreamLine(
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: "toolu_01",
                name: "mcp__capy__create_transaction",
                input: {},
              },
            ],
          },
        }),
        registry,
      )

      const events = parseStreamLine(
        JSON.stringify({
          type: "user",
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_01",
                content: "{ \"success\": true }",
              },
            ],
          },
        }),
        registry,
      )

      expect(events).toEqual([
        { type: "tool-result", tool: "create_transaction", id: "toolu_01", ok: true },
      ])
    })

    it("marks tool-result as not-ok when is_error is set", () => {
      const registry = new Map<string, string>([["toolu_02", "create_transaction"]])
      const events = parseStreamLine(
        JSON.stringify({
          type: "user",
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_02",
                is_error: true,
                content: "Error: nope",
              },
            ],
          },
        }),
        registry,
      )
      expect(events).toEqual([
        { type: "tool-result", tool: "create_transaction", id: "toolu_02", ok: false },
      ])
    })

    it("skips tool_result with an unknown tool_use_id (no registry entry)", () => {
      const registry = new Map<string, string>()
      const events = parseStreamLine(
        JSON.stringify({
          type: "user",
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_ghost",
                content: "stale",
              },
            ],
          },
        }),
        registry,
      )
      expect(events).toEqual([])
    })

    it("registry is optional — no tool-result emitted without one", () => {
      const events = parseStreamLine(
        JSON.stringify({
          type: "user",
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_03",
                content: "ok",
              },
            ],
          },
        }),
      )
      expect(events).toEqual([])
    })
  })

  describe("assistant with empty / missing content", () => {
    it("returns [] when message has no content array", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {},
      })
      expect(parseStreamLine(line)).toEqual([])
    })

    it("returns [] when message is missing", () => {
      const line = JSON.stringify({ type: "assistant" })
      expect(parseStreamLine(line)).toEqual([])
    })

    it("returns [] when content array is empty", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: { content: [] },
      })
      expect(parseStreamLine(line)).toEqual([])
    })
  })
})

