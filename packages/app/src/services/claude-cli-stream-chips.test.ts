import { describe, it, expect } from "vitest"
import { parseStreamLine } from "@/services/claude-cli-stream"

describe("parseStreamLine", () => {
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
})
