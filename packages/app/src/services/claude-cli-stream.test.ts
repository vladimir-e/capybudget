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
    it("emits done on a clean result", () => {
      const line = JSON.stringify({ type: "result" })
      expect(parseStreamLine(line)).toEqual([{ type: "done" }])
    })

    it("emits error when the result carries is_error", () => {
      // `--max-turns` produces this shape when the cap trips.
      const line = JSON.stringify({
        type: "result",
        subtype: "error_max_turns",
        is_error: true,
        errors: ["Reached maximum number of turns (100)"],
      })
      expect(parseStreamLine(line)).toEqual([
        { type: "error", message: "Reached maximum number of turns (100)" },
      ])
    })

    it("falls back to a generic message when is_error has no details", () => {
      const line = JSON.stringify({ type: "result", is_error: true })
      expect(parseStreamLine(line)).toEqual([
        { type: "error", message: "Session terminated with an error." },
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

