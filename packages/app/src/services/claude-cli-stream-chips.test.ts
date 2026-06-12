import { describe, it, expect } from "vitest"
import { parseStreamLine } from "@/services/claude-cli-stream"

function toolActivityFallback(tool: string) {
  return [{ type: "content", blocks: [{ type: "tool-activity", tool }] }]
}

describe("parseStreamLine", () => {
  describe("render tool input validation", () => {
    it("falls back to tool-activity for render_table with missing headers", () => {
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
      expect(parseStreamLine(line)).toEqual(toolActivityFallback("render_table"))
    })

    it("falls back to tool-activity for render_table with missing rows", () => {
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
      expect(parseStreamLine(line)).toEqual(toolActivityFallback("render_table"))
    })

    it("falls back to tool-activity for render_table with empty headers and rows", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "render_table",
              input: { headers: [], rows: [] },
            },
          ],
        },
      })
      expect(parseStreamLine(line)).toEqual(toolActivityFallback("render_table"))
    })

    it("falls back to tool-activity for render_chart with missing title", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "render_chart",
              input: { type: "bar", data: [{ label: "X", value: 1 }] },
            },
          ],
        },
      })
      expect(parseStreamLine(line)).toEqual(toolActivityFallback("render_chart"))
    })

    it("falls back to tool-activity for render_chart with missing data", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "render_chart",
              input: { title: "Test", type: "donut" },
            },
          ],
        },
      })
      expect(parseStreamLine(line)).toEqual(toolActivityFallback("render_chart"))
    })

    it("falls back to tool-activity for render_chart with empty data", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "render_chart",
              input: { title: "Test", type: "donut", data: [] },
            },
          ],
        },
      })
      expect(parseStreamLine(line)).toEqual(toolActivityFallback("render_chart"))
    })

    it("falls back to tool-activity for render_chart with an unknown type", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "render_chart",
              input: { title: "Test", type: "pie", data: [{ label: "X", value: 1 }] },
            },
          ],
        },
      })
      expect(parseStreamLine(line)).toEqual(toolActivityFallback("render_chart"))
    })

    it("falls back to tool-activity for render_followups with empty chips array", () => {
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
      expect(parseStreamLine(line)).toEqual(toolActivityFallback("render_followups"))
    })

    it("falls back to tool-activity for render_followups with an invented payload", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "render_followups",
              input: { followups: '[{"label":"a","prompt":"b"}]' },
            },
          ],
        },
      })
      expect(parseStreamLine(line)).toEqual(toolActivityFallback("render_followups"))
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
})
