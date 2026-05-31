import { describe, it, expect } from "vitest"
import { parseStreamLine } from "@/services/claude-cli-stream"

describe("parseStreamLine", () => {
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
})
