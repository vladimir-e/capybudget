import { describe, it, expect } from "vitest";
import { parseStreamLine } from "@/services/capy-stream";

describe("parseStreamLine", () => {
  describe("empty / invalid input", () => {
    it("returns [] for empty string", () => {
      expect(parseStreamLine("")).toEqual([]);
    });

    it("returns [] for whitespace-only string", () => {
      expect(parseStreamLine("   \t\n  ")).toEqual([]);
    });

    it("returns [] for invalid JSON", () => {
      expect(parseStreamLine("not json at all")).toEqual([]);
    });

    it("returns [] for unknown event type", () => {
      expect(parseStreamLine(JSON.stringify({ type: "ping" }))).toEqual([]);
    });
  });

  describe("assistant text blocks", () => {
    it("parses a text block", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Hello there" }],
        },
      });

      expect(parseStreamLine(line)).toEqual([
        { type: "text", text: "Hello there" },
      ]);
    });

    it("passes text through as-is (cumulative — parser just relays)", () => {
      const first = JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Hel" }],
        },
      });
      const second = JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Hello world" }],
        },
      });

      expect(parseStreamLine(first)).toEqual([
        { type: "text", text: "Hel" },
      ]);
      expect(parseStreamLine(second)).toEqual([
        { type: "text", text: "Hello world" },
      ]);
    });
  });

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
      });

      expect(parseStreamLine(line)).toEqual([
        {
          type: "render",
          block: {
            type: "table",
            headers: ["Account", "Balance"],
            rows: [["Checking", "$1,000.00"]],
          },
        },
      ]);
    });

    it("maps render_bar_chart to a bar-chart ContentBlock", () => {
      const data = [
        { label: "Food", value: 450 },
        { label: "Rent", value: 1200 },
      ];
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
      });

      expect(parseStreamLine(line)).toEqual([
        {
          type: "render",
          block: { type: "bar-chart", title: "Spending by Category", data },
        },
      ]);
    });

    it("maps render_donut_chart to a donut-chart ContentBlock", () => {
      const data = [
        { label: "Fixed", value: 60 },
        { label: "Variable", value: 40 },
      ];
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
      });

      expect(parseStreamLine(line)).toEqual([
        {
          type: "render",
          block: { type: "donut-chart", title: "Budget Split", data },
        },
      ]);
    });
  });

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
      });

      expect(parseStreamLine(line)).toEqual([
        {
          type: "render",
          block: {
            type: "table",
            headers: ["Month", "Total"],
            rows: [["Jan", "$500"]],
          },
        },
      ]);
    });

    it("strips mcp__capy__ prefix from render_bar_chart", () => {
      const data = [{ label: "March", value: 800 }];
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "mcp__capy__render_bar_chart",
              input: { title: "Monthly Totals", data },
            },
          ],
        },
      });

      expect(parseStreamLine(line)).toEqual([
        {
          type: "render",
          block: { type: "bar-chart", title: "Monthly Totals", data },
        },
      ]);
    });

    it("strips mcp__capy__ prefix from render_donut_chart", () => {
      const data = [
        { label: "Needs", value: 50 },
        { label: "Wants", value: 30 },
        { label: "Savings", value: 20 },
      ];
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "mcp__capy__render_donut_chart",
              input: { title: "50/30/20 Rule", data },
            },
          ],
        },
      });

      expect(parseStreamLine(line)).toEqual([
        {
          type: "render",
          block: { type: "donut-chart", title: "50/30/20 Rule", data },
        },
      ]);
    });
  });

  describe("non-render tool_use → tool-activity", () => {
    it("emits tool-activity for a non-render tool with MCP prefix", () => {
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
      });

      expect(parseStreamLine(line)).toEqual([
        { type: "tool-activity", tool: "list_accounts" },
      ]);
    });

    it("emits tool-activity for a non-render tool without prefix", () => {
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
      });

      expect(parseStreamLine(line)).toEqual([
        { type: "tool-activity", tool: "get_transactions" },
      ]);
    });
  });

  describe("multiple content blocks", () => {
    it("returns multiple events for text + tool_use blocks", () => {
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
      });

      const events = parseStreamLine(line);
      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({
        type: "text",
        text: "Here's your spending:",
      });
      expect(events[1]).toEqual({
        type: "render",
        block: {
          type: "table",
          headers: ["Category", "Amount"],
          rows: [["Food", "$200"]],
        },
      });
    });

    it("handles multiple tool_use blocks in one message", () => {
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
      });

      const events = parseStreamLine(line);
      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({
        type: "tool-activity",
        tool: "list_accounts",
      });
      expect(events[1]).toEqual({
        type: "render",
        block: {
          type: "bar-chart",
          title: "Balances",
          data: [{ label: "Checking", value: 5000 }],
        },
      });
    });
  });

  describe("result event", () => {
    it("emits done", () => {
      const line = JSON.stringify({ type: "result" });
      expect(parseStreamLine(line)).toEqual([{ type: "done" }]);
    });
  });

  describe("error event", () => {
    it("emits error with message", () => {
      const line = JSON.stringify({
        type: "error",
        error: { message: "Rate limit exceeded" },
      });

      expect(parseStreamLine(line)).toEqual([
        { type: "error", message: "Rate limit exceeded" },
      ]);
    });

    it("falls back to 'Unknown error' when message is missing", () => {
      const line = JSON.stringify({
        type: "error",
        error: {},
      });

      expect(parseStreamLine(line)).toEqual([
        { type: "error", message: "Unknown error" },
      ]);
    });

    it("falls back to 'Unknown error' when error object is missing", () => {
      const line = JSON.stringify({ type: "error" });

      expect(parseStreamLine(line)).toEqual([
        { type: "error", message: "Unknown error" },
      ]);
    });
  });

  describe("assistant with empty / missing content", () => {
    it("returns [] when message has no content array", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {},
      });
      expect(parseStreamLine(line)).toEqual([]);
    });

    it("returns [] when message is missing", () => {
      const line = JSON.stringify({ type: "assistant" });
      expect(parseStreamLine(line)).toEqual([]);
    });

    it("returns [] when content array is empty", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: { content: [] },
      });
      expect(parseStreamLine(line)).toEqual([]);
    });
  });
});
